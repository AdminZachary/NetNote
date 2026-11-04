/**
 * Insight engine: turns a pile of notes into connections and questions worth thinking about.
 *
 * A knowledge base is valuable where ideas meet, so we look for
 *   1. hidden links    notes that talk about the same things / share neighbours but aren't linked
 *   2. bridges         notes that hold different topics together
 *   3. gaps            topics that barely touch although they share vocabulary
 *   4. wanted notes    concepts you keep linking to but never wrote down
 *   5. drifting ideas  notes or small islands cut off from everything else
 * Every result carries its evidence (shared neighbours, shared phrases) so people can judge it.
 * Results are structured data; wording lives in app/i18n so the same engine serves every language.
 */
import type { Vault } from '../vault/vault';
import { betweenness, components, louvain, type Neighbours } from './graph-algorithms';
import { sharedPhrases, snap, tfidf, vocabulary, withoutTemplates, type Doc, type Vector } from './text';

export interface Suggestion {
  a: string;
  b: string;
  score: number;
  /** Phrases both notes use. */
  terms: string[];
  /** Notes both link to / are linked from. */
  shared: string[];
}

export interface Topic {
  id: string;
  name: string;
  hub: string;
  size: number;
  members: string[];
  keywords: string[];
}

export interface Bridge {
  id: string;
  score: number;
  topics: string[];
}

export interface Gap {
  a: string;
  b: string;
  aHub: string;
  bHub: string;
  links: number;
  terms: string[];
  score: number;
}

export interface Wanted {
  id: string;
  name: string;
  refs: number;
  from: string[];
}

export interface Drifting {
  kind: 'orphan' | 'island';
  ids: string[];
  /** Most similar note in the main body: a place to attach it. */
  anchor: string | null;
}

/** Internal model kept for follow-up questions (cluster analysis, related notes). */
export interface InsightModel {
  vecs: Map<string, Vector>;
  nb: Neighbours;
  docs: Map<string, Doc>;
  vocab: string[];
}

export interface Insights {
  version: number;
  suggestions: Suggestion[];
  bridges: Bridge[];
  gaps: Gap[];
  wanted: Wanted[];
  drifting: Drifting[];
  topics: Topic[];
  /** note path -> index into topics */
  topicOf: Map<string, number>;
  model: InsightModel;
}

const pairKey = (a: string, b: string): string => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1);

export function computeInsights(vault: Vault): Insights {
  const graph = vault.graph();
  const raw: Doc[] = [...vault.notes.values()].map((n) => ({
    path: n.path,
    name: n.name,
    title: n.title,
    content: n.content,
    aliases: n.aliases,
    tags: n.tags,
  }));
  const notes = withoutTemplates(raw);
  const docs = new Map(notes.map((n) => [n.path, n]));
  const ids = notes.map((n) => n.path);
  const name = (id: string): string => docs.get(id)?.name ?? id;

  const nb: Neighbours = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const l of graph.links) {
    if (nb.has(l.source) && nb.has(l.target)) {
      nb.get(l.source)!.add(l.target);
      nb.get(l.target)!.add(l.source);
    }
  }

  const vecs = tfidf(notes);
  const vocab = vocabulary(
    raw,
    graph.nodes.map((n) => n.name),
  );
  const postings = new Map<string, string[]>();
  for (const [p, v] of vecs)
    for (const t of v.keys()) {
      const list = postings.get(t);
      if (list) list.push(p);
      else postings.set(t, [p]);
    }

  // ---- 1. hidden links: content similarity + shared neighbours (Adamic–Adar) ----
  interface Pair {
    a: string;
    b: string;
    sim: number;
    aa: number;
    shared: string[];
  }
  const pairs = new Map<string, Pair>();
  for (const [a, va] of vecs) {
    const acc = new Map<string, number>();
    for (const [t, wa] of va) for (const b of postings.get(t) ?? []) if (b !== a) acc.set(b, (acc.get(b) ?? 0) + wa * (vecs.get(b)!.get(t) ?? 0));
    for (const [b, sim] of acc) {
      if (a > b || nb.get(a)!.has(b) || sim < 0.08) continue;
      pairs.set(pairKey(a, b), { a, b, sim, aa: 0, shared: [] });
    }
  }
  for (const z of ids) {
    const list = [...nb.get(z)!];
    if (list.length < 2 || list.length > 60) continue;
    const w = 1 / Math.log(1 + list.length);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (nb.get(a)!.has(b)) continue;
        const k = pairKey(a, b);
        let e = pairs.get(k);
        if (!e) {
          e = { a: a < b ? a : b, b: a < b ? b : a, sim: 0, aa: 0, shared: [] };
          pairs.set(k, e);
        }
        e.aa += w;
        e.shared.push(z);
      }
  }
  const perNote = new Map<string, number>();
  const suggestions: Suggestion[] = [...pairs.values()]
    .map((e) => {
      const va = vecs.get(e.a)!;
      const vb = vecs.get(e.b)!;
      const common = [...va.keys()].filter((t) => vb.has(t));
      const exclude = e.shared.map((z) => name(z).toLowerCase());
      const phrases = sharedPhrases(docs.get(e.a)!.content, common, (t) => (va.get(t) ?? 0) * (vb.get(t) ?? 0)).filter(
        (p) => !exclude.some((x) => x.includes(p) || p.includes(x)) && p !== name(e.a).toLowerCase() && p !== name(e.b).toLowerCase(),
      );
      // a note left with a handful of words (a list of links) looks identical to its siblings: trust it less
      const thin = Math.min(1, Math.min(va.size, vb.size) / 8);
      // two notes in the same folder already sit side by side; a link across folders is the less obvious one
      const near = dirOf(e.a) === dirOf(e.b) ? 0.6 : 1;
      return { ...e, score: (e.sim * 1.4 * thin + Math.min(1, e.aa / 2) * 0.8) * near, terms: phrases.slice(0, 3) };
    })
    .filter((e) => e.score > 0.22 && (e.terms.length >= 2 || e.shared.length >= 2))
    .sort((x, y) => y.score - x.score || (x.a + x.b).localeCompare(y.a + y.b))
    // twelve variations on one note are one idea; the same reason for the tenth time is no discovery
    .filter((e) => {
      const ka = perNote.get(e.a) ?? 0;
      const kb = perNote.get(e.b) ?? 0;
      const why = e.terms.join('|');
      const kw = why ? (perNote.get('\u0000' + why) ?? 0) : 0;
      if (ka >= 2 || kb >= 2 || kw >= 2) return false;
      perNote.set(e.a, ka + 1).set(e.b, kb + 1);
      if (why) perNote.set('\u0000' + why, kw + 1);
      return true;
    })
    .slice(0, Math.max(8, Math.min(60, Math.round(ids.length * 0.6))))
    .map((e) => ({ a: e.a, b: e.b, score: +e.score.toFixed(3), terms: e.terms, shared: e.shared.slice(0, 4) }));

  // ---- topics ----
  // Index notes link to almost everything; left in they glue every community into one and end up
  // naming it. Cluster without them, then let each join the topic most of its neighbours are in.
  const hubCut = Math.max(15, ids.length * 0.2);
  const isHub = (id: string): boolean => nb.get(id)!.size > hubCut;
  const nbT: Neighbours = new Map(ids.map((id) => [id, isHub(id) ? new Set<string>() : new Set([...nb.get(id)!].filter((m) => !isHub(m)))]));
  const label = louvain(ids, nbT);
  for (const id of ids) {
    if (!isHub(id)) continue;
    const votes = new Map<string, number>();
    for (const m of nb.get(id)!) if (!isHub(m)) votes.set(label.get(m)!, (votes.get(label.get(m)!) ?? 0) + 1);
    const best = [...votes].sort((x, y) => y[1] - x[1])[0];
    if (best) label.set(id, best[0]);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const k = label.get(id)!;
    const g = groups.get(k);
    if (g) g.push(id);
    else groups.set(k, [id]);
  }
  interface TopicWork extends Topic {
    core: string[];
    centroid: Map<string, number>;
  }
  const topics: TopicWork[] = [...groups.values()]
    .filter((g) => g.length >= 3)
    .map((members) => {
      const inner = (a: string): number => [...nbT.get(a)!].filter((x) => label.get(x) === label.get(a)).length;
      const hub = [...members].sort((a, b) => inner(b) - inner(a) || nb.get(b)!.size - nb.get(a)!.size || a.localeCompare(b))[0]!;
      const core = members.filter((m) => !isHub(m));
      const basis = core.length ? core : members;
      const centroid = new Map<string, number>();
      for (const m of basis) for (const [t, w] of vecs.get(m)!) centroid.set(t, (centroid.get(t) ?? 0) + w / basis.length);
      return { id: label.get(hub)!, hub, name: name(hub), members, core: basis, centroid, size: members.length, keywords: [] };
    })
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  for (const t of topics) t.keywords = topicKeywords(t, docs, vecs, vocab);
  const topicOf = new Map<string, number>();
  topics.forEach((t, i) => t.members.forEach((m) => topicOf.set(m, i)));

  // ---- 2. bridges: high betweenness AND neighbours in ≥ 2 topics ----
  const bc = betweenness(ids, nb);
  const maxBc = Math.max(1, ...bc.values());
  const bridges: Bridge[] = ids
    .map((id) => {
      const touched = new Set([...nb.get(id)!].map((m) => topicOf.get(m)).filter((x): x is number => x !== undefined));
      return { id, score: bc.get(id)! / maxBc, topics: [...touched].map((i) => topics[i]!.name) };
    })
    .filter((b) => b.topics.length >= 2 && b.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((b) => ({ ...b, score: +b.score.toFixed(3) }));

  // ---- 3. gaps between topics: few links, shared vocabulary → a question to explore ----
  const gaps: Gap[] = [];
  for (let i = 0; i < topics.length; i++)
    for (let j = i + 1; j < topics.length; j++) {
      const A = topics[i]!;
      const B = topics[j]!;
      const setB = new Set(B.members);
      let links = 0;
      for (const m of A.members) for (const x of nb.get(m)!) if (setB.has(x)) links++;
      const density = links / Math.sqrt(A.size * B.size);
      let overlap = 0;
      const sharedW = new Map<string, number>();
      for (const [t, w] of A.centroid) {
        const wb = B.centroid.get(t);
        if (wb) {
          overlap += w * wb;
          sharedW.set(t, w * wb);
        }
      }
      let words: string[] = [];
      if (sharedW.size) {
        const text = [...A.core, ...B.core].map((m) => docs.get(m)?.content ?? '').join('\n');
        const wt = (t: string): number => sharedW.get(t) ?? 0;
        words = snap(sharedPhrases(text, [...sharedW.keys()], wt), vocab, wt).filter((w) => w !== A.name && w !== B.name);
      }
      if (density < 0.35 && (words.length >= 1 || links === 0))
        gaps.push({ a: A.name, b: B.name, aHub: A.hub, bHub: B.hub, links, terms: words.slice(0, 3), score: overlap / (1 + links) });
    }
  gaps.sort((x, y) => y.score - x.score || x.links - y.links);

  // ---- 4. wanted notes: unresolved links ranked by how often they are referenced ----
  const wanted: Wanted[] = graph.nodes
    .filter((n) => n.ghost && n.in >= 1)
    .sort((a, b) => b.in - a.in || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((n) => ({
      id: n.id,
      name: n.name,
      refs: n.in,
      from: graph.links
        .filter((l) => l.target === n.id)
        .map((l) => l.source)
        .slice(0, 5),
    }));

  // ---- 5. drifting ideas: orphans + small islands detached from the main body ----
  const comps = components(ids, nb);
  const main = new Set(comps[0] ?? []);
  /** The note in the main body most similar to `id` (cosine over shared terms). */
  const anchorFor = (id: string): string | null => {
    const acc = new Map<string, number>();
    for (const [t, w] of vecs.get(id) ?? [])
      for (const p of postings.get(t) ?? []) if (main.has(p)) acc.set(p, (acc.get(p) ?? 0) + w * (vecs.get(p)!.get(t) ?? 0));
    let best: string | null = null;
    let bestS = 0;
    for (const [p, s] of acc)
      if (s > bestS || (s === bestS && best !== null && p < best)) {
        best = p;
        bestS = s;
      }
    return best;
  };
  const drifting: Drifting[] = [
    ...comps
      .filter((c) => c.length === 1)
      .slice(0, 12)
      .map((c): Drifting => ({ kind: 'orphan', ids: c, anchor: anchorFor(c[0]!) })),
    ...comps
      .slice(1)
      .filter((c) => c.length > 1)
      .slice(0, 6)
      .map((c): Drifting => ({ kind: 'island', ids: c, anchor: anchorFor(c[0]!) })),
  ];

  return {
    version: vault.version,
    suggestions,
    bridges,
    gaps: gaps.slice(0, 6),
    wanted,
    drifting,
    topics: topics.map(({ id, name: n, hub, size, members, keywords }) => ({ id, name: n, hub, size, members, keywords })),
    topicOf,
    model: { vecs, nb, docs, vocab },
  };
}

function topicKeywords(
  t: { core: string[]; centroid: Map<string, number>; hub: string },
  docs: Map<string, Doc>,
  vecs: Map<string, Vector>,
  vocab: string[],
): string[] {
  const count = new Map<string, number>();
  for (const [term, w] of t.centroid) {
    let k = 0;
    for (const m of t.core) if (vecs.get(m)?.has(term)) k++;
    if (k >= Math.min(2, t.core.length)) count.set(term, w * k);
  }
  const common = [...count.keys()];
  if (!common.length) return [];
  const text = t.core.map((m) => docs.get(m)?.content ?? '').join('\n');
  const hubName = (docs.get(t.hub)?.name ?? '').toLowerCase();
  const wt = (x: string): number => count.get(x) ?? 0;
  return snap(sharedPhrases(text, common, wt), vocab, wt)
    .filter((p) => p.toLowerCase() !== hubName && p.length >= 2)
    .slice(0, 3);
}

/** Related-but-unlinked notes for one note (used by the reading card). */
export function relatedFor(insights: Insights, path: string, limit = 6): (Suggestion & { other: string })[] {
  return insights.suggestions
    .filter((s) => s.a === path || s.b === path)
    .slice(0, limit)
    .map((s) => ({ ...s, other: s.a === path ? s.b : s.a }));
}

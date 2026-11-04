/**
 * A group of notes someone placed together (the thinking wall): what they share, which note looks
 * like the missing piece, and which question to think about. Purely from content + links, no AI.
 */
import type { Insights } from './engine';
import { sharedPhrases, snap } from './text';

export interface ClusterCandidate {
  path: string;
  score: number;
  /** How many group members it already links to. */
  tied: number;
  terms: string[];
}

export type ClusterQuestion =
  | { kind: 'include-named'; candidate: string; keyword: string }
  | { kind: 'missing-piece'; candidate: string; keywords: string[]; tied: number; term: string | null }
  | { kind: 'write-conclusion'; keywords: string[] }
  | { kind: 'linking-ring'; candidate: string; tied: number }
  | { kind: 'why-together' };

export interface ClusterInfo {
  keywords: string[];
  candidates: ClusterCandidate[];
  /** Links among the members. */
  links: number;
  /** Hidden-link suggestions inside the group. */
  hidden: number;
  question: ClusterQuestion | null;
}

export function clusterInfo(insights: Insights, paths: string[]): ClusterInfo {
  const { vecs, nb, docs, vocab } = insights.model;
  const name = (p: string): string => docs.get(p)?.name ?? p;
  const members = [...new Set(paths)].filter((p) => vecs.has(p)).slice(0, 24);
  if (members.length < 2) return { keywords: [], candidates: [], links: 0, hidden: 0, question: null };
  const inGroup = new Set(members);
  // what the group talks about: terms carried by at least half the members (and at least two)
  const need = Math.max(2, Math.ceil(members.length / 2));
  const weight = new Map<string, number>();
  const carriers = new Map<string, number>();
  for (const m of members)
    for (const [t, w] of vecs.get(m)!) {
      weight.set(t, (weight.get(t) ?? 0) + w);
      carriers.set(t, (carriers.get(t) ?? 0) + 1);
    }
  const common = [...weight.keys()].filter((t) => (carriers.get(t) ?? 0) >= need);
  const commonSet = new Set(common);
  const text = members.map((m) => docs.get(m)?.content ?? '').join('\n');
  const names = members.map((m) => name(m).toLowerCase());
  const wt = (t: string): number => weight.get(t) ?? 0;
  const keywords = snap(sharedPhrases(text, common, wt), vocab, wt)
    .filter((p) => !names.includes(p.toLowerCase()))
    .slice(0, 3);

  // the group's centroid; which outside note is closest (content) or tied to several members (links)?
  const centroid = new Map<string, number>();
  for (const [t, w] of weight) centroid.set(t, w / members.length);
  let cn = 0;
  for (const w of centroid.values()) cn += w * w;
  cn = Math.sqrt(cn) || 1;
  const scored: ClusterCandidate[] = [];
  for (const [p, v] of vecs) {
    if (inGroup.has(p)) continue;
    let dot = 0;
    const hits: [string, number][] = [];
    for (const [t, w] of v) {
      const c = centroid.get(t);
      if (!c) continue;
      dot += w * c;
      if (commonSet.has(t)) hits.push([t, w * c]);
    }
    const sim = dot / cn;
    const tied = [...(nb.get(p) ?? [])].filter((x) => inGroup.has(x)).length;
    const score = sim + (tied >= 2 ? 0.15 * tied : 0);
    if (score < 0.12) continue;
    const hw = (t: string): number => hits.find((h) => h[0] === t)?.[1] ?? 0;
    const terms = snap(
      sharedPhrases(
        docs.get(p)?.content ?? '',
        hits.map(([t]) => t),
        hw,
      ),
      vocab,
      hw,
    ).slice(0, 2);
    scored.push({ path: p, score: +score.toFixed(3), tied, terms });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const candidates = scored.slice(0, 3);

  let links = 0;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (nb.get(members[i]!)?.has(members[j]!)) links++;
  const hidden = insights.suggestions.filter((s) => inGroup.has(s.a) && inGroup.has(s.b)).length;

  const c = candidates[0];
  const named = c ? keywords.find((k) => k.toLowerCase() === name(c.path).toLowerCase()) : undefined;
  let question: ClusterQuestion;
  if (c && named) question = { kind: 'include-named', candidate: c.path, keyword: named };
  else if (c && keywords.length)
    question = { kind: 'missing-piece', candidate: c.path, keywords: keywords.slice(0, 2), tied: c.tied, term: c.terms[0] ?? null };
  else if (keywords.length) question = { kind: 'write-conclusion', keywords: keywords.slice(0, 2) };
  else if (c && c.tied >= 2) question = { kind: 'linking-ring', candidate: c.path, tied: c.tied };
  else question = { kind: 'why-together' };
  return { keywords, candidates, links, hidden, question };
}

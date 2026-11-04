/** Graph algorithms used by the insight engine. Inputs are undirected neighbour sets. */

export type Neighbours = Map<string, Set<string>>;

/**
 * Louvain community detection (modularity optimisation, multi-level). Finds "topics" purely from how
 * notes link to each other: the structure the user built, not folders they happened to pick.
 * Deterministic for a given input order.
 */
export function louvain(ids: string[], nb: Neighbours): Map<string, string> {
  const index = new Map(ids.map((id, i) => [id, i]));
  let adj: Map<number, number>[] = ids.map(() => new Map());
  ids.forEach((id, i) => {
    for (const m of nb.get(id) ?? []) {
      const j = index.get(m);
      if (j !== undefined) adj[i]!.set(j, 1);
    }
  });
  let membership = ids.map((_, i) => i);
  for (let level = 0; level < 4; level++) {
    const n = adj.length;
    const k = adj.map((a) => [...a.values()].reduce((s, w) => s + w, 0));
    const m2 = k.reduce((s, x) => s + x, 0);
    if (!m2) break;
    const comm = adj.map((_, i) => i);
    const tot = [...k];
    let moved = true;
    let anyMove = false;
    let guard = 0;
    while (moved && guard++ < 20) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i]!;
        const links = new Map<number, number>();
        for (const [j, w] of adj[i]!) if (j !== i) links.set(comm[j]!, (links.get(comm[j]!) ?? 0) + w);
        tot[ci]! -= k[i]!;
        let best = ci;
        let bestGain = (links.get(ci) ?? 0) - (tot[ci]! * k[i]!) / m2;
        for (const [c, kin] of links) {
          const gain = kin - (tot[c]! * k[i]!) / m2;
          if (gain > bestGain + 1e-12) {
            best = c;
            bestGain = gain;
          }
        }
        tot[best]! += k[i]!;
        if (best !== ci) {
          comm[i] = best;
          moved = anyMove = true;
        }
      }
    }
    if (!anyMove) break;
    const ids2 = [...new Set(comm)];
    const remap = new Map(ids2.map((c, i) => [c, i]));
    const adj2: Map<number, number>[] = ids2.map(() => new Map());
    for (let i = 0; i < n; i++)
      for (const [j, w] of adj[i]!) {
        const a = remap.get(comm[i]!)!;
        const b = remap.get(comm[j]!)!;
        adj2[a]!.set(b, (adj2[a]!.get(b) ?? 0) + w);
      }
    membership = membership.map((sn) => remap.get(comm[sn]!)!);
    adj = adj2;
  }
  return new Map(ids.map((id, i) => [id, 't' + membership[i]]));
}

/** Approximate betweenness centrality (Brandes) on a sample of sources; exact for ≤ 400 nodes. */
export function betweenness(ids: string[], nb: Neighbours): Map<string, number> {
  const bc = new Map(ids.map((id) => [id, 0]));
  const step = Math.ceil(ids.length / 400);
  const sources = ids.length <= 400 ? ids : ids.filter((_, i) => i % step === 0);
  for (const s of sources) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>([[s, 1]]);
    const dist = new Map<string, number>([[s, 0]]);
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++]!;
      stack.push(v);
      for (const w of nb.get(v) ?? []) {
        if (!dist.has(w)) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + sigma.get(v)!);
          const p = pred.get(w);
          if (p) p.push(v);
          else pred.set(w, [v]);
        }
      }
    }
    const delta = new Map<string, number>();
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? []) delta.set(v, (delta.get(v) ?? 0) + (sigma.get(v)! / sigma.get(w)!) * (1 + (delta.get(w) ?? 0)));
      if (w !== s && bc.has(w)) bc.set(w, bc.get(w)! + (delta.get(w) ?? 0));
    }
  }
  return bc;
}

/** Connected components, largest first. */
export function components(ids: string[], nb: Neighbours): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const q = [id];
    seen.add(id);
    while (q.length) {
      const v = q.pop()!;
      comp.push(v);
      for (const w of nb.get(v) ?? [])
        if (!seen.has(w)) {
          seen.add(w);
          q.push(w);
        }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

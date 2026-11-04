/**
 * Ways to wander through your own thinking, as pure functions over the link graph:
 *   - path finder: the shortest chain of links from one note to another ("how are these connected?")
 *   - time machine: notes in the order they were born, so you watch the ideas grow
 *   - auto tour: a slow walk along links, preferring well-connected notes you have not seen yet
 */

export type Neighbours = ReadonlyMap<string, ReadonlySet<string>>;

/** Breadth-first shortest path (by number of links). `null` when the two are not connected. */
export function shortestPath(from: string, to: string, nb: Neighbours, skip?: (id: string) => boolean): string[] | null {
  if (from === to) return [from];
  if (!nb.has(from) || !nb.has(to)) return null;
  const prev = new Map<string, string>([[from, from]]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const m of nb.get(id) ?? []) {
        if (prev.has(m) || (m !== to && skip?.(m))) continue;
        prev.set(m, id);
        if (m === to) {
          const path = [to];
          let cur = to;
          while (cur !== from) path.push((cur = prev.get(cur)!));
          return path.reverse();
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

export interface Born {
  id: string;
  at: number;
}

/** Notes sorted by birth time (ties keep a stable order by id). */
export function timeline(items: readonly Born[]): Born[] {
  return [...items].filter((b) => Number.isFinite(b.at)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** How many entries of a sorted timeline are born at or before `t`. */
export function countAt(sorted: readonly Born[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Playback plan for the time machine: always ~`seconds` long whatever the vault size, stepping by
 * birth order (not wall-clock time), so a burst of notes on one day doesn't flash past.
 */
export function playbackStep(count: number, seconds = 14): { perStep: number; interval: number } {
  if (count <= 0) return { perStep: 1, interval: seconds };
  const interval = Math.max(0.04, Math.min(0.7, seconds / count));
  const perStep = Math.max(1, Math.ceil((count * interval) / seconds));
  return { perStep, interval };
}

/**
 * Next stop of the auto tour: an unvisited neighbour (busier notes a little more likely); if there is
 * none, an unvisited connected note elsewhere; failing that, anything.
 */
export function nextTourStop(
  current: string | null,
  nb: Neighbours,
  degree: (id: string) => number,
  visited: readonly string[],
  rand: () => number = Math.random,
  eligible: (id: string) => boolean = () => true,
): string | null {
  const seen = new Set(visited);
  if (current) seen.add(current);
  const all = [...nb.keys()].filter(eligible);
  let pool = current ? [...(nb.get(current) ?? [])].filter((id) => eligible(id) && !seen.has(id)) : [];
  if (!pool.length) pool = all.filter((id) => !seen.has(id) && degree(id) > 0);
  if (!pool.length) pool = all.filter((id) => id !== current);
  if (!pool.length) return null;
  const total = pool.reduce((s, id) => s + 1 + degree(id), 0);
  let r = rand() * total;
  for (const id of pool) if ((r -= 1 + degree(id)) <= 0) return id;
  return pool[pool.length - 1]!;
}

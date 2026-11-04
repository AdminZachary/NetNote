/**
 * 3D force-directed layout of the note graph.
 *
 * Deterministic: start positions come from a hash of the note path, so the same vault always opens in
 * the same shape and people can rely on spatial memory ("the sleep notes are top left").
 * A weak topic-cohesion force pulls members of one topic together so topics read as regions.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type SimNode } from 'd3-force-3d';

export interface LayoutNode extends SimNode {
  id: string;
  degree: number;
  topic: number | undefined;
  ghost?: boolean;
}

export interface LayoutLink {
  source: string;
  target: string;
}

export interface LayoutOptions {
  ticks?: number;
  /** Previous positions, to keep the shape stable when notes are added. */
  previous?: Map<string, { x: number; y: number; z: number }>;
}

export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Seeded PRNG (mulberry32) for d3's jiggle, so ties break the same way every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nodeRadius = (n: { degree: number; ghost?: boolean }): number => (n.ghost ? 2.2 : 3 + Math.sqrt(n.degree) * 1.6);

function topicForce(strength: number): ((alpha: number) => void) & { initialize: (n: LayoutNode[]) => void } {
  let nodes: LayoutNode[] = [];
  const force = (alpha: number): void => {
    const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
    for (const n of nodes) {
      if (n.topic === undefined) continue;
      const s = sums.get(n.topic) ?? { x: 0, y: 0, z: 0, n: 0 };
      s.x += n.x ?? 0;
      s.y += n.y ?? 0;
      s.z += n.z ?? 0;
      s.n++;
      sums.set(n.topic, s);
    }
    const k = strength * alpha;
    for (const n of nodes) {
      const s = n.topic === undefined ? undefined : sums.get(n.topic);
      if (!s || s.n < 2) continue;
      n.vx = (n.vx ?? 0) + (s.x / s.n - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (s.y / s.n - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + (s.z / s.n - (n.z ?? 0)) * k;
    }
  };
  force.initialize = (n: LayoutNode[]): void => {
    nodes = n;
  };
  return force;
}

/** Lay the graph out; returns positions in "layout units" (the scene scales them to metres). */
export function layoutGraph(input: LayoutNode[], links: LayoutLink[], opts: LayoutOptions = {}): Map<string, { x: number; y: number; z: number }> {
  const nodes = input.map((n) => {
    const prev = opts.previous?.get(n.id);
    return {
      ...n,
      x: prev?.x ?? (hash01(n.id, 1) - 0.5) * 300,
      y: prev?.y ?? (hash01(n.id, 2) - 0.5) * 300,
      z: prev?.z ?? (hash01(n.id, 3) - 0.5) * 220,
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const simLinks = links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
  const degree = new Map(nodes.map((n) => [n.id, n.degree]));
  const big = nodes.length > 800;
  const sim = forceSimulation(nodes, 3)
    .randomSource(seeded(nodes.length * 7919 + simLinks.length))
    .force(
      'link',
      forceLink<LayoutNode>(simLinks)
        .id((d) => d.id)
        .distance(52)
        .strength((l) => {
          const s = typeof l.source === 'string' ? l.source : l.source.id;
          const t = typeof l.target === 'string' ? l.target : l.target.id;
          return 1 / Math.min(degree.get(s) || 1, degree.get(t) || 1);
        }),
    )
    .force('topic', topicForce(0.05))
    .force(
      'charge',
      forceManyBody<LayoutNode>()
        .strength(-150)
        .distanceMax(700)
        .theta(big ? 1.2 : 0.9),
    )
    .force('center', forceCenter<LayoutNode>(0, 0, 0).strength(0.6))
    .force('collide', big ? null : forceCollide<LayoutNode>((d) => nodeRadius(d) + 4))
    .force('x', forceX<LayoutNode>(0).strength(0.04))
    .force('y', forceY<LayoutNode>(0).strength(0.04))
    .force('z', forceZ<LayoutNode>(0).strength(0.04))
    .alphaDecay(big ? 0.05 : 0.025)
    .velocityDecay(0.35)
    .alpha(opts.previous ? 0.4 : 1)
    .stop();
  sim.tick(opts.ticks ?? Math.max(60, Math.min(300, Math.round(60000 / Math.max(1, nodes.length)))));
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }]));
}

/** Centre and radius of a set of positions (radius = 90th percentile distance, so outliers don't shrink everything). */
export function bounds(pos: Iterable<{ x: number; y: number; z: number }>): { cx: number; cy: number; cz: number; r: number } {
  const list = [...pos];
  if (!list.length) return { cx: 0, cy: 0, cz: 0, r: 1 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of list) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= list.length;
  cy /= list.length;
  cz /= list.length;
  const d = list.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)).sort((a, b) => a - b);
  return { cx, cy, cz, r: Math.max(1, d[Math.floor((d.length - 1) * 0.9)] ?? 1) };
}

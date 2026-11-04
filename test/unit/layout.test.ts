import { describe, expect, it } from 'vitest';
import { bounds, hash01, layoutGraph, type LayoutNode } from '../../src/core/layout/force';

const nodes = (n: number, topic = (i: number): number | undefined => i % 2): LayoutNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, degree: 1, topic: topic(i) }));

describe('layoutGraph', () => {
  it('is deterministic for the same input', () => {
    const links = [
      { source: 'n0', target: 'n1' },
      { source: 'n1', target: 'n2' },
    ];
    const a = layoutGraph(nodes(6), links, { ticks: 50 });
    const b = layoutGraph(nodes(6), links, { ticks: 50 });
    expect([...a.values()]).toEqual([...b.values()]);
  });
  it('linked nodes end closer than unlinked ones', () => {
    const p = layoutGraph(
      nodes(4, () => undefined),
      [{ source: 'n0', target: 'n1' }],
      { ticks: 200 },
    );
    const d = (a: string, b: string): number => {
      const x = p.get(a)!;
      const y = p.get(b)!;
      return Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
    };
    expect(d('n0', 'n1')).toBeLessThan(d('n2', 'n3'));
  });
  it('ignores links to unknown nodes and returns finite positions', () => {
    const p = layoutGraph(nodes(3), [{ source: 'n0', target: 'missing' }], { ticks: 10 });
    for (const v of p.values()) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });
});

describe('helpers', () => {
  it('hash01 is stable and in [0,1)', () => {
    expect(hash01('abc')).toBe(hash01('abc'));
    expect(hash01('abc')).not.toBe(hash01('abd'));
    expect(hash01('x', 3)).toBeGreaterThanOrEqual(0);
    expect(hash01('x', 3)).toBeLessThan(1);
  });
  it('bounds ignores the farthest 10 %', () => {
    const pts = [...Array.from({ length: 9 }, () => ({ x: 1, y: 0, z: 0 })), { x: 1000, y: 0, z: 0 }];
    expect(bounds(pts).r).toBeLessThan(200);
  });
});

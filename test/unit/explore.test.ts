import { describe, expect, it } from 'vitest';
import { countAt, nextTourStop, playbackStep, shortestPath, timeline } from '../../src/core/explore/explore';

const graph = (edges: [string, string][]): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  return m;
};

describe('shortestPath', () => {
  const g = graph([
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['a', 'x'],
    ['x', 'd'],
    ['e', 'f'],
  ]);
  it('finds the fewest links', () => expect(shortestPath('a', 'd', g)).toEqual(['a', 'x', 'd']));
  it('is null between unconnected notes', () => expect(shortestPath('a', 'f', g)).toBeNull());
  it('a note to itself is a path of one', () => expect(shortestPath('c', 'c', g)).toEqual(['c']));
  it('can avoid notes (e.g. index pages)', () => expect(shortestPath('a', 'd', g, (id) => id === 'x')).toEqual(['a', 'b', 'c', 'd']));
  it('unknown notes have no path', () => expect(shortestPath('a', 'zzz', g)).toBeNull());
});

describe('time machine', () => {
  const tl = timeline([
    { id: 'c', at: 30 },
    { id: 'a', at: 10 },
    { id: 'b', at: 10 },
    { id: 'bad', at: NaN },
  ]);
  it('orders by birth, stable on ties, drops unknown dates', () => expect(tl.map((b) => b.id)).toEqual(['a', 'b', 'c']));
  it('counts what exists at a moment', () => {
    expect(countAt(tl, 5)).toBe(0);
    expect(countAt(tl, 10)).toBe(2);
    expect(countAt(tl, 99)).toBe(3);
  });
  it('plays any vault in about 14 seconds', () => {
    for (const n of [3, 50, 400, 5000]) {
      const { perStep, interval } = playbackStep(n);
      const total = Math.ceil(n / perStep) * interval;
      expect(total).toBeLessThan(n < 20 ? 14 * 0.7 * 3 : 16);
      expect(interval).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe('auto tour', () => {
  const g = graph([
    ['hub', 'a'],
    ['hub', 'b'],
    ['hub', 'c'],
    ['z', 'y'],
  ]);
  const deg = (id: string): number => g.get(id)?.size ?? 0;
  it('walks to an unvisited neighbour', () => {
    const next = nextTourStop('hub', g, deg, ['a'], () => 0);
    expect(['b', 'c']).toContain(next);
  });
  it('jumps elsewhere when every neighbour was seen', () => {
    const next = nextTourStop('a', g, deg, ['hub'], () => 0.5);
    expect(next).not.toBe('hub');
    expect(next).not.toBe('a');
  });
  it('respects which notes are eligible', () => {
    for (let i = 0; i < 10; i++)
      expect(
        nextTourStop(
          'hub',
          g,
          deg,
          [],
          () => i / 10,
          (id) => id !== 'b',
        ),
      ).not.toBe('b');
  });
});

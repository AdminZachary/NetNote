import { describe, expect, it } from 'vitest';
import { clusterInfo } from '../../src/core/insights/cluster';
import { computeInsights, relatedFor } from '../../src/core/insights/engine';
import { betweenness, components, louvain } from '../../src/core/insights/graph-algorithms';
import { sharedPhrases, terms } from '../../src/core/insights/text';
import { Vault, type SourceFile } from '../../src/core/vault/vault';

const vaultOf = (spec: Record<string, string>): Vault =>
  Vault.from(
    't',
    Object.entries(spec).map(([path, content]): SourceFile => ({ path, content, mtime: 1 })),
  );

const neighbours = (ids: string[], edges: [string, string][]): Map<string, Set<string>> => {
  const nb = new Map(ids.map((i) => [i, new Set<string>()]));
  for (const [a, b] of edges) {
    nb.get(a)!.add(b);
    nb.get(b)!.add(a);
  }
  return nb;
};

describe('text features', () => {
  it('CJK bigrams skip function characters and stop phrases', () => {
    const t = terms('我们的知识图谱可以帮助记忆');
    expect(t).toEqual(expect.arrayContaining(['知识', '图谱', '记忆']));
    expect(t.some((x) => x.includes('的'))).toBe(false);
    expect(t).not.toContain('我们');
  });
  it('latin stop words are dropped and links contribute their names', () => {
    expect(terms('The [[Forgetting curve|curve]] and the memory')).toEqual(['forgetting', 'curve', 'curve', 'memory']);
  });
  it('sharedPhrases merges consecutive bigrams into phrases', () => {
    expect(sharedPhrases('关于记忆宫殿的方法', ['记忆', '忆宫', '宫殿'], () => 1)).toEqual(['记忆宫殿']);
  });
});

describe('graph algorithms', () => {
  const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'];
  const edges: [string, string][] = [];
  for (const g of ['a', 'b']) for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) edges.push([g + i, g + j]);
  edges.push(['a1', 'b1']);
  const nb = neighbours(ids, edges);
  it('louvain separates two cliques joined by one edge', () => {
    const lab = louvain(ids, nb);
    expect(new Set(['a1', 'a2', 'a3', 'a4'].map((i) => lab.get(i))).size).toBe(1);
    expect(lab.get('a2')).not.toBe(lab.get('b2'));
  });
  it('betweenness is highest on the bridge ends', () => {
    const bc = betweenness(ids, nb);
    const top = [...bc]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .map(([k]) => k)
      .sort();
    expect(top).toEqual(['a1', 'b1']);
  });
  it('components are sorted largest first', () => {
    expect(components(['x', 'y', 'z'], neighbours(['x', 'y', 'z'], [['x', 'y']]))).toEqual([['x', 'y'], ['z']]);
  });
});

describe('computeInsights', () => {
  const v = vaultOf({
    'Hub.md': '[[Spaced repetition]] [[Memory palace]] [[Forgetting curve]]',
    'Spaced repetition.md': 'Review cards on a schedule; the forgetting curve decides intervals. [[Forgetting curve]] retention retention',
    'Memory palace.md': 'Place images along a route; retention improves with vivid places. [[Forgetting curve]] retention',
    'Forgetting curve.md': 'Ebbinghaus measured retention decay.',
    'Lonely.md': 'Ebbinghaus again: a note nobody links to.',
    'Ref.md': '[[Never written]] and again [[Never written]]',
    'Ref2.md': '[[Never written]]',
  });
  const ins = computeInsights(v);
  it('suggests unlinked siblings with their evidence', () => {
    const s = ins.suggestions.find((x) => [x.a, x.b].sort().join() === 'Memory palace.md,Spaced repetition.md');
    expect(s).toBeDefined();
    expect(s!.shared.length).toBeGreaterThanOrEqual(2);
    expect(relatedFor(ins, 'Memory palace.md').some((r) => r.other === 'Spaced repetition.md')).toBe(true);
  });
  it('finds orphans with an anchor, and wanted notes by references', () => {
    const orphan = ins.drifting.find((d) => d.ids[0] === 'Lonely.md');
    expect(orphan?.anchor).toBeTruthy();
    expect(ins.wanted[0]).toMatchObject({ name: 'Never written', refs: 2 });
  });
  it('is deterministic', () => {
    const again = computeInsights(v);
    expect(again.suggestions).toEqual(ins.suggestions);
    expect(again.topics).toEqual(ins.topics);
  });
  it('detects topics and a bridge between two communities', () => {
    const spec: Record<string, string> = {};
    const a = ['sleep', 'dream', 'rem', 'melatonin'];
    const b = ['budget', 'saving', 'interest', 'debt'];
    for (const g of [a, b])
      for (const n of g)
        spec[`${n}.md`] =
          g
            .filter((m) => m !== n)
            .map((m) => `[[${m}]]`)
            .join(' ') + ` ${n} ${g.join(' ')}`;
    spec['stress.md'] = '[[sleep]] [[debt]] money worries keep people awake';
    const ins2 = computeInsights(vaultOf(spec));
    expect(ins2.topics.length).toBe(2);
    expect(ins2.topicOf.get('sleep.md')).not.toBe(ins2.topicOf.get('budget.md'));
    expect(ins2.bridges[0]?.id).toBe('stress.md');
    expect(ins2.gaps.length).toBeGreaterThanOrEqual(0);
  });
});

describe('clusterInfo', () => {
  const v = vaultOf({
    'A.md': 'retention spacing memory review schedule',
    'B.md': 'retention spacing memory flashcards',
    'C.md': 'retention spacing memory [[A]] [[B]] review',
    'Far.md': 'cooking pasta tomato',
    'Far2.md': 'cooking pasta basil',
    'Far3.md': 'gardening tomato soil',
    'Far4.md': 'gardening basil soil',
  });
  const ins = computeInsights(v);
  it('names what a group shares and proposes the missing note', () => {
    const info = clusterInfo(ins, ['A.md', 'B.md']);
    expect(info.keywords).toEqual(expect.arrayContaining(['retention']));
    expect(info.candidates[0]?.path).toBe('C.md');
    expect(info.question?.kind).toBe('missing-piece');
  });
  it('returns an empty answer for fewer than two notes', () => {
    expect(clusterInfo(ins, ['A.md'])).toMatchObject({ keywords: [], question: null });
  });
});

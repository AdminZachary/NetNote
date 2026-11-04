import { describe, expect, it } from 'vitest';
import { fit, wrap } from '../../src/xr/ui/draw';

// a fake canvas where every character is 10 px wide
const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D;

describe('wrap', () => {
  it('breaks latin text between words', () => {
    expect(wrap(ctx, 'the quick brown fox', 100)).toEqual(['the quick', 'brown fox']);
  });
  it('breaks CJK between any two characters', () => {
    expect(wrap(ctx, '知识图谱帮助记忆', 30)).toEqual(['知识图', '谱帮助', '记忆']);
  });
  it('keeps paragraphs and hard-breaks long words', () => {
    expect(wrap(ctx, 'ab\n\nabcdefghijkl', 50)).toEqual(['ab', '', 'abcde', 'fghij', 'kl']);
  });
  it('respects maxLines', () => {
    expect(wrap(ctx, 'a b c d e f', 10, 2)).toEqual(['a', 'b']);
  });
});

describe('fit', () => {
  it('adds an ellipsis only when needed', () => {
    expect(fit(ctx, 'short', 100)).toBe('short');
    expect(fit(ctx, 'a long title', 60)).toBe('a lon…');
  });
});

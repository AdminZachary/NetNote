import { describe, expect, it } from 'vitest';
import { InsertSegment, deleteWordBefore, repairReplace } from '../../src/xr/keyboard/text-input';
import { caretFromX, caretSpot, layoutText, scrollForCaret } from '../../src/xr/ui/text-layout';

const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D;

describe('cursor editing', () => {
  it('deletes the word before the cursor, not at the end', () => {
    expect(deleteWordBefore('alpha beta gamma', 10)).toEqual({ text: 'alpha gamma', caret: 5 });
    expect(deleteWordBefore('alpha beta', 0)).toEqual({ text: 'alpha beta', caret: 0 });
  });
  it('puts a keystroke that wiped the text back at the cursor', () => {
    expect(repairReplace('hello world', 5, 'x', 'x')).toEqual({ text: 'hellox world', caret: 6 });
    expect(repairReplace('hello world', 5, 'hellox world', 'x')).toBeNull();
  });
});

describe('text layout with offsets', () => {
  const text = 'the quick brown fox\nend';
  const lines = layoutText(ctx, text, 100);
  it('wraps like the plain wrap and keeps source offsets', () => {
    expect(lines.map((l) => l.text)).toEqual(['the quick', 'brown fox', 'end']);
    for (const l of lines) expect(text.slice(l.start, l.start + l.text.length)).toBe(l.text);
  });
  it('places the caret on the right line', () => {
    expect(caretSpot(ctx, lines, text, 0)).toEqual({ line: 0, x: 0 });
    expect(caretSpot(ctx, lines, text, 10)).toEqual({ line: 1, x: 0 }); // at a soft wrap: next line
    expect(caretSpot(ctx, lines, text, 19)).toEqual({ line: 1, x: 90 }); // before the newline
    expect(caretSpot(ctx, lines, text, text.length)).toEqual({ line: 2, x: 30 });
  });
  it('turns a pinch position back into a caret index', () => {
    expect(caretFromX(ctx, lines[1]!, 26)).toBe(13);
    expect(caretFromX(ctx, lines[2]!, 999)).toBe(text.length);
  });
  it('keeps the caret line in view', () => {
    expect(scrollForCaret(0, 9, 12, 6)).toBe(4);
    expect(scrollForCaret(5, 1, 12, 6)).toBe(1);
    expect(scrollForCaret(3, 4, 12, 6)).toBe(3);
  });
  it('handles CJK and empty lines', () => {
    const t = '知识图谱\n\n记忆';
    const l = layoutText(ctx, t, 30);
    expect(l.map((x) => x.text)).toEqual(['知识图', '谱', '', '记忆']);
    expect(caretSpot(ctx, l, t, 5)).toEqual({ line: 2, x: 0 });
  });
});

describe('typing in the headset (the keyboard only knows its own buffer)', () => {
  it('inserts what you type at the cursor and never touches the rest', () => {
    const seg = InsertSegment.at('hello world', 5);
    expect(seg.apply('', 0)).toMatchObject({ text: 'hello world', caret: 5 });
    expect(seg.apply(',', 1)).toMatchObject({ text: 'hello, world', caret: 6 });
    expect(seg.apply(', big', 5)).toMatchObject({ text: 'hello, big world', caret: 10 });
    // the keyboard's own cursor moved inside the typed part
    expect(seg.apply(', big', 2)).toMatchObject({ caret: 7 });
    // backspacing all of it puts the text back as it was
    expect(seg.apply('', 0)).toMatchObject({ text: 'hello world', caret: 5 });
  });
  it('after moving the insertion point, what the keyboard already held is not inserted again', () => {
    const seg = InsertSegment.at('one two', 0, 'abc');
    expect(seg.apply('abc', 3)).toMatchObject({ text: 'one two', caret: 0 });
    expect(seg.apply('abcX', 4)).toMatchObject({ text: 'Xone two', caret: 1 });
    // the keyboard cleared its buffer and started again
    expect(seg.apply('Y', 1)).toMatchObject({ text: 'Yone two', caret: 1 });
  });
  it('backspacing into the old buffer inserts nothing here', () => {
    const seg = InsertSegment.at('one two', 3, 'abc');
    expect(seg.apply('ab', 2)).toMatchObject({ text: 'one two', caret: 3 });
    expect(seg.apply('abZ', 3)).toMatchObject({ text: 'oneZ two', caret: 4 });
  });
});

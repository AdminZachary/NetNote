/**
 * Wrapped text that remembers where each line starts in the source string, so a caret index can be
 * drawn at the right spot and a pinch on the text can be turned back into a caret index.
 */
import { COLORS } from '../theme';
import { TOKEN, type Ctx, type Measure, type Rect } from './draw';

export interface TextLine {
  /** the line as drawn (trailing spaces kept out) */
  text: string;
  /** index in the source of the first character on this line */
  start: number;
  /** index just past this line's last character, trailing spaces included, the newline not */
  end: number;
}

export function layoutText(ctx: Measure, text: string, maxWidth: number): TextLine[] {
  const width = (s: string): number => ctx.measureText(s).width;
  const lines: TextLine[] = [];
  let paraStart = 0;
  for (const para of text.split('\n')) {
    let start = paraStart;
    let line = '';
    const push = (): void => {
      const shown = line.trimEnd();
      lines.push({ text: shown, start, end: start + line.length });
    };
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(para))) {
      const tok = m[0];
      const at = paraStart + m.index;
      if (width((line + tok).trimEnd()) <= maxWidth) {
        line += tok;
        continue;
      }
      if (line.trim()) push();
      let piece = tok;
      let pieceAt = at;
      while (width(piece.trimEnd()) > maxWidth && piece.length > 1) {
        let n = piece.length - 1;
        while (n > 1 && width(piece.slice(0, n)) > maxWidth) n--;
        start = pieceAt;
        line = piece.slice(0, n);
        push();
        piece = piece.slice(n);
        pieceAt += n;
      }
      start = pieceAt;
      line = piece;
    }
    push();
    paraStart += para.length + 1;
  }
  return lines;
}

/** The line a caret sits on, and its x offset from the line's left edge. */
export function caretSpot(ctx: Measure, lines: TextLine[], source: string, caret: number): { line: number; x: number } {
  let li = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const next = lines[i + 1];
    // a caret at a soft wrap belongs to the next line; at a newline it stays at the end of this one
    if (caret >= l.start && (caret < l.end || !next || caret < next.start)) {
      li = i;
      break;
    }
  }
  const l = lines[Math.max(0, li)] ?? { start: 0, end: 0, text: '' };
  const upto = source.slice(l.start, Math.min(caret, l.start + l.text.length));
  return { line: Math.max(0, li), x: ctx.measureText(upto).width };
}

/** The caret index nearest to an x offset on a line. */
export function caretFromX(ctx: Measure, line: TextLine, x: number): number {
  let best = line.start;
  let bestD = Math.abs(x);
  for (let i = 1; i <= line.text.length; i++) {
    const d = Math.abs(ctx.measureText(line.text.slice(0, i)).width - x);
    if (d < bestD) {
      bestD = d;
      best = line.start + i;
    }
  }
  return best;
}

/** First line to show so the caret line stays inside a window of `rows` lines. */
export function scrollForCaret(prevTop: number, caretLine: number, total: number, rows: number): number {
  let top = Math.min(prevTop, Math.max(0, total - rows));
  if (caretLine < top) top = caretLine;
  else if (caretLine >= top + rows) top = caretLine - rows + 1;
  return Math.max(0, top);
}

/**
 * A text box with a caret: draws the visible lines, keeps the caret line in view, and maps a pinch
 * back to a caret index.
 */
export class CaretBox {
  private top = 0;
  private lines: TextLine[] = [];
  private box: Rect | null = null;
  private source = '';

  constructor(
    private readonly lineH = 46,
    private readonly inset = 24,
    private readonly firstY = 38,
  ) {}

  draw(ctx: Ctx, box: Rect, text: string, caret: number, showCaret: boolean): void {
    this.box = box;
    this.source = text;
    const w = box.w - this.inset * 2;
    this.lines = layoutText(ctx, text, w);
    const rows = Math.max(1, Math.floor((box.h - 30) / this.lineH));
    const spot = caretSpot(ctx, this.lines, text, Math.max(0, Math.min(text.length, caret)));
    this.top = scrollForCaret(this.top, spot.line, this.lines.length, rows);
    ctx.fillStyle = COLORS.text;
    for (let i = 0; i < rows && this.top + i < this.lines.length; i++) {
      ctx.fillText(this.lines[this.top + i]!.text, box.x + this.inset, box.y + this.firstY + i * this.lineH);
    }
    if (this.top > 0) {
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText('…', box.x + box.w - this.inset - 30, box.y + this.firstY);
    }
    if (showCaret) {
      const row = spot.line - this.top;
      ctx.fillStyle = COLORS.accent;
      ctx.fillRect(box.x + this.inset + spot.x + 1, box.y + this.firstY + row * this.lineH - 20, 4, 40);
    }
  }

  /** The caret index under a canvas point inside the box, or null when the box is empty. */
  caretAt(px: number, py: number, ctx: Measure): number | null {
    const b = this.box;
    if (!b || !this.lines.length || !this.source) return null;
    const row = Math.floor((py - (b.y + this.firstY - this.lineH / 2)) / this.lineH);
    const li = Math.max(0, Math.min(this.lines.length - 1, this.top + row));
    return caretFromX(ctx, this.lines[li]!, px - b.x - this.inset);
  }

  reset(): void {
    this.top = 0;
  }
}

/** 2D canvas drawing helpers for in-world panels (text wrapping that handles CJK, rounded boxes, icons). */
import { COLORS, FONT } from '../theme';

export type Ctx = CanvasRenderingContext2D;

export function font(px: number, weight = 400): string {
  return `${weight} ${px}px ${FONT}`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Cut text with an ellipsis so it fits `maxWidth`. */
export function fit(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

const CJK = '\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef';
/** One CJK character, or a latin word with the spaces after it, or a run of spaces. */
export const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, 'g');

export type Measure = Pick<Ctx, 'measureText'>;

/** Word wrap that breaks between latin words and between any two CJK characters. */
export function wrap(ctx: Measure, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const width = (s: string): number => ctx.measureText(s).width;
  const lines: string[] = [];
  const push = (l: string): boolean => {
    lines.push(l.trimEnd());
    return lines.length >= maxLines;
  };
  for (const para of text.split('\n')) {
    let line = '';
    for (const tok of para.match(TOKEN) ?? []) {
      if (width((line + tok).trimEnd()) <= maxWidth) {
        line += tok;
        continue;
      }
      if (line.trim() && push(line)) return lines;
      line = '';
      let piece = tok.trimStart();
      // a single word longer than a line: hard-break it
      while (width(piece.trimEnd()) > maxWidth && piece.length > 1) {
        let n = piece.length - 1;
        while (n > 1 && width(piece.slice(0, n)) > maxWidth) n--;
        if (push(piece.slice(0, n))) return lines;
        piece = piece.slice(n);
      }
      line = piece;
    }
    if (push(line)) return lines;
  }
  return lines;
}

/** Clamp to `maxLines`, ending the last line with an ellipsis when text was cut. */
export function wrapClamped(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const all = wrap(ctx, text, maxWidth, maxLines + 1);
  if (all.length <= maxLines) return all;
  const out = all.slice(0, maxLines);
  out[maxLines - 1] = fit(ctx, (out[maxLines - 1] ?? '') + ' ' + (all[maxLines] ?? ''), maxWidth);
  if (!out[maxLines - 1]!.endsWith('…')) out[maxLines - 1] = fit(ctx, out[maxLines - 1]! + '……', maxWidth);
  return out;
}

export function panelBackground(ctx: Ctx, w: number, h: number, radius = 36, edge: string = COLORS.panelEdge): void {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 3, 3, w - 6, h - 6, radius);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(16, 26, 48, 0.985)');
  g.addColorStop(1, 'rgba(8, 12, 26, 0.985)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export type ButtonStyle = 'primary' | 'ghost' | 'gold' | 'danger' | 'chip';

export function drawButton(ctx: Ctx, r: Rect, label: string, style: ButtonStyle, hover: boolean, px = 30): void {
  const colors: Record<ButtonStyle, [string, string, string]> = {
    primary: [hover ? 'rgba(94,231,255,0.32)' : COLORS.accentSoft, COLORS.accent, COLORS.text],
    ghost: [hover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.18)', COLORS.text],
    gold: [hover ? 'rgba(255,209,102,0.34)' : COLORS.goldSoft, COLORS.gold, COLORS.text],
    danger: [hover ? 'rgba(255,122,138,0.3)' : 'rgba(255,122,138,0.12)', COLORS.danger, COLORS.text],
    chip: [hover ? 'rgba(94,231,255,0.22)' : 'rgba(255,255,255,0.05)', hover ? COLORS.accent : 'rgba(255,255,255,0.12)', COLORS.text],
  };
  const [fill, stroke, color] = colors[style];
  roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.h / 2, 26));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = hover ? 4 : 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = font(px, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, label, r.w - 24), r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function dot(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

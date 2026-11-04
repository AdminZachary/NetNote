/**
 * Markdown → laid-out lines of styled runs for canvas panels. Supports what notes actually use:
 * headings, paragraphs, bullet/numbered/task lists, quotes, code blocks, **bold**, `code`, [[links]]
 * and [markdown](links). Link runs carry their target so panels can make them clickable.
 */
import { parseFrontmatter } from '../../core/markdown/parse';
import { font, type Ctx } from './draw';
import { COLORS } from '../theme';

export type RunStyle = 'text' | 'bold' | 'link' | 'ghost-link' | 'code' | 'tag';

export interface Run {
  text: string;
  style: RunStyle;
  target?: string;
}

export interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'code' | 'blank';
  runs: Run[];
  /** list marker: "•", "1.", "☐", "☑" */
  marker?: string;
}

const INLINE = /(\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\])|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|((?:^|(?<=\s))#[\p{L}\p{N}_/-]+)/gu;

export function inlineRuns(text: string, exists: (target: string) => boolean = () => true): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) runs.push({ text: text.slice(last, i), style: 'text' });
    if (m[1]) {
      const target = m[2]!.trim();
      runs.push({ text: (m[3] ?? m[2])!.trim(), style: exists(target) ? 'link' : 'ghost-link', target });
    } else if (m[4]) {
      const href = m[6]!;
      runs.push({ text: m[5]!, style: /^[a-z]+:/i.test(href) ? 'text' : 'link', target: /^[a-z]+:/i.test(href) ? undefined : decodeURIComponent(href) });
    } else if (m[7]) runs.push({ text: m[8]!, style: 'bold' });
    else if (m[9]) runs.push({ text: m[10]!, style: 'code' });
    else if (m[11]) runs.push({ text: m[11], style: 'tag' });
    last = i + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), style: 'text' });
  return runs.map((r) => ({ ...r, text: r.text.replace(/(==|~~|__)/g, '') }));
}

export function parseBlocks(markdown: string, exists?: (target: string) => boolean): Block[] {
  const { body } = parseFrontmatter(markdown);
  const blocks: Block[] = [];
  let inCode = false;
  let code: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) {
        blocks.push({ kind: 'code', runs: [{ text: code.join('\n'), style: 'code' }] });
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      blocks.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', runs: inlineRuns(h[2]!, exists) });
      continue;
    }
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      blocks.push({ kind: 'li', marker: task[1] === ' ' ? '☐' : '☑', runs: inlineRuns(task[2]!, exists) });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      blocks.push({ kind: 'li', marker: /\d/.test(li[1]!) ? li[1]! : '•', runs: inlineRuns(li[2]!, exists) });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push({ kind: 'quote', runs: inlineRuns(q[1]!, exists) });
      continue;
    }
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1]!.kind !== 'blank') blocks.push({ kind: 'blank', runs: [] });
      continue;
    }
    blocks.push({ kind: 'p', runs: inlineRuns(line.trim(), exists) });
  }
  if (inCode && code.length) blocks.push({ kind: 'code', runs: [{ text: code.join('\n'), style: 'code' }] });
  while (blocks.length && blocks[blocks.length - 1]!.kind === 'blank') blocks.pop();
  return blocks;
}

export interface Piece {
  text: string;
  style: RunStyle;
  target?: string;
  x: number;
  w: number;
}

export interface Line {
  y: number;
  h: number;
  pieces: Piece[];
  kind: Block['kind'];
  marker?: string;
}

export interface TypeScale {
  body: number;
  h1: number;
  h2: number;
  h3: number;
  lineHeight: number;
}

export const DEFAULT_SCALE: TypeScale = { body: 34, h1: 50, h2: 42, h3: 37, lineHeight: 1.45 };

function fontFor(kind: Block['kind'], style: RunStyle, s: TypeScale): string {
  const px = kind === 'h1' ? s.h1 : kind === 'h2' ? s.h2 : kind === 'h3' ? s.h3 : kind === 'code' ? s.body * 0.88 : s.body;
  const heading = kind === 'h1' || kind === 'h2' || kind === 'h3';
  const weight = heading || style === 'bold' ? 700 : style === 'link' ? 600 : 400;
  if (style === 'code' || kind === 'code') return `${weight} ${px}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`;
  return font(px, weight);
}

const SPLIT = /[\u3000-〿぀-ヿ㐀-䶿一-鿿＀-￯]|[^\s\u3000-〿぀-ヿ㐀-䶿一-鿿＀-￯]+\s*|\s+/g;

/** Lay blocks out into lines no wider than `width`. Coordinates are relative to the text box. */
export function layout(ctx: Ctx, blocks: Block[], width: number, s: TypeScale = DEFAULT_SCALE): Line[] {
  const lines: Line[] = [];
  let y = 0;
  for (const b of blocks) {
    const px = b.kind === 'h1' ? s.h1 : b.kind === 'h2' ? s.h2 : b.kind === 'h3' ? s.h3 : s.body;
    const lh = Math.round(px * s.lineHeight);
    if (b.kind === 'blank') {
      y += Math.round(s.body * 0.6);
      continue;
    }
    if (b.kind === 'h1' || b.kind === 'h2') y += lines.length ? Math.round(px * 0.35) : 0;
    const indent = b.kind === 'li' ? Math.round(s.body * 1.3) : b.kind === 'quote' || b.kind === 'code' ? Math.round(s.body * 0.8) : 0;
    const maxW = width - indent;
    let line: Line = { y, h: lh, pieces: [], kind: b.kind, marker: b.marker };
    let x = 0;
    const flush = (): void => {
      lines.push(line);
      y += lh;
      line = { y, h: lh, pieces: [], kind: b.kind };
      x = 0;
    };
    if (b.kind === 'code') {
      ctx.font = fontFor('code', 'code', s);
      for (const codeLine of b.runs[0]?.text.split('\n') ?? []) {
        line.pieces.push({ text: codeLine, style: 'code', x: indent, w: ctx.measureText(codeLine).width });
        flush();
      }
      continue;
    }
    for (const run of b.runs) {
      ctx.font = fontFor(b.kind, run.style, s);
      for (const tok of run.text.match(SPLIT) ?? []) {
        const w = ctx.measureText(tok).width;
        if (x + ctx.measureText(tok.trimEnd()).width > maxW && x > 0) {
          flush();
          if (/^\s+$/.test(tok)) continue;
        }
        const prev = line.pieces[line.pieces.length - 1];
        if (prev && prev.style === run.style && prev.target === run.target) {
          prev.text += tok;
          prev.w += w;
        } else line.pieces.push({ text: tok, style: run.style, target: run.target, x: indent + x, w });
        x += w;
      }
    }
    flush();
  }
  return lines;
}

const STYLE_COLOR: Record<RunStyle, string> = {
  text: COLORS.text,
  bold: '#ffffff',
  link: COLORS.accent,
  'ghost-link': COLORS.textDim,
  code: '#ffd9a8',
  tag: COLORS.violet,
};

/**
 * Paint laid-out lines at (x0, y0) clipped to [clipTop, clipBottom). Returns the hit boxes of links.
 */
export function paintLines(
  ctx: Ctx,
  lines: Line[],
  x0: number,
  y0: number,
  clipTop: number,
  clipBottom: number,
  s: TypeScale = DEFAULT_SCALE,
  hoverTarget: string | null = null,
): { target: string; x: number; y: number; w: number; h: number }[] {
  const links: { target: string; x: number; y: number; w: number; h: number }[] = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - 40, clipTop, 4000, clipBottom - clipTop);
  ctx.clip();
  ctx.textBaseline = 'middle';
  for (const line of lines) {
    const top = y0 + line.y;
    if (top + line.h < clipTop || top > clipBottom) continue;
    const mid = top + line.h / 2;
    if (line.marker) {
      ctx.font = font(s.body, 700);
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(line.marker, x0 + 4, mid);
    }
    if (line.kind === 'quote') {
      ctx.fillStyle = 'rgba(177,140,255,0.6)';
      ctx.fillRect(x0, top + 4, 5, line.h - 8);
    }
    if (line.kind === 'code') {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x0, top, 3000, line.h);
    }
    for (const p of line.pieces) {
      ctx.font = fontFor(line.kind, p.style, s);
      const hovered = p.target && p.target === hoverTarget;
      ctx.fillStyle = line.kind === 'quote' && p.style === 'text' ? COLORS.textDim : STYLE_COLOR[p.style];
      if (line.kind === 'h1' || line.kind === 'h2' || line.kind === 'h3') ctx.fillStyle = p.style === 'link' ? COLORS.accent : '#ffffff';
      ctx.fillText(p.text, x0 + p.x, mid);
      if (p.target && (p.style === 'link' || p.style === 'ghost-link')) {
        ctx.fillStyle = hovered ? COLORS.accent : 'rgba(94,231,255,0.35)';
        if (p.style === 'ghost-link') ctx.fillStyle = 'rgba(159,176,204,0.35)';
        ctx.fillRect(x0 + p.x, mid + line.h * 0.3, p.w, hovered ? 4 : 2);
        links.push({ target: p.target, x: x0 + p.x - 6, y: top, w: p.w + 12, h: line.h });
      }
    }
  }
  ctx.restore();
  return links;
}

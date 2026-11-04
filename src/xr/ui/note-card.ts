/**
 * The reading card: one note, its links and its possible connections, at reading distance.
 *
 * Everything that moves thinking forward is one pinch away: follow a link in the text, jump to a
 * backlink, accept a suggested connection (and say why), write, pin, or put the note on the wall.
 */
import type { NoteView } from '../../core/vault/vault';
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { dot, drawButton, fit, font, panelBackground, roundRect, wrapClamped, type Ctx } from './draw';
import { layout, paintLines, parseBlocks, type Line } from './rich-text';
import { Surface } from './surface';

export interface RelatedRow {
  path: string;
  name: string;
  reason: string;
}

export type ListTab = 'out' | 'in' | 'related';

export interface CardModel {
  view: NoteView;
  color: string;
  related: RelatedRow[];
  /** resolves a [[target]] written in this note */
  resolve: (target: string) => string | null;
  pinned: boolean;
  /** hanging on the thinking wall */
  onWall?: boolean;
}

const W = 1000;
const H = 1250;
const PAD = 48;
const BODY_TOP = 250;
const BODY_BOTTOM = 820;
const TABS_Y = 846;
const ROW_H = 64;
const LIST_TOP = 912;
const LIST_ROWS = 5;

export class NoteCard extends Surface {
  model: CardModel | null = null;
  tab: ListTab = 'out';
  /** waiting for the second note of a path search */
  pathPicking = false;
  /** the delete button was pinched once: the next pinch deletes */
  confirmDelete = false;
  private lines: Line[] = [];
  private linesFor = '';

  constructor(widthM = 0.7) {
    super(widthM, W, H);
    this.mesh.name = 'note-card';
  }

  get path(): string | null {
    return this.model?.view.note.path ?? null;
  }

  show(model: CardModel): void {
    const changed = model.view.note.path !== this.model?.view.note.path;
    this.model = model;
    if (changed) {
      this.confirmDelete = false;
      this.scrollY = 0;
      this.tab = model.view.outgoing.length ? 'out' : model.view.backlinks.length ? 'in' : 'related';
    }
    this.linesFor = '';
    this.invalidate();
  }

  setTab(tab: ListTab): void {
    this.tab = tab;
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    const m = this.model;
    panelBackground(ctx, W, H, 40, m ? hexA(m.color, 0.55) : COLORS.panelEdge);
    if (!m) return;
    const tr = t();
    const n = m.view.note;

    // header
    dot(ctx, PAD + 14, 78, 14, m.color);
    ctx.fillStyle = COLORS.text;
    ctx.font = font(50, 700);
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, n.title || n.name, W - PAD * 2 - 160), PAD + 44, 78);
    ctx.font = font(27, 400);
    ctx.fillStyle = COLORS.textDim;
    const meta = [...(n.folder ? [n.folder] : []), `${n.words} ${tr.words}`, ...n.tags.slice(0, 3).map((x) => '#' + x)].join('   ·   ');
    ctx.fillText(fit(ctx, meta, W - PAD * 2 - 40), PAD + 44, 128);

    // close button (top right)
    const close = { x: W - PAD - 72, y: 44, w: 72, h: 72 };
    drawButton(ctx, close, '×', 'ghost', this.isHover('close'), 46);
    this.hit({ id: 'close', ...close });

    // actions
    const actions: [string, string, 'primary' | 'ghost' | 'gold'][] = [
      ['edit', tr.edit, 'primary'],
      ['pin', m.pinned ? tr.unpin : tr.pin, 'ghost'],
      ['wall', m.onWall ? tr.offWall : tr.toWall, m.onWall ? 'gold' : 'ghost'],
    ];
    let x = PAD;
    for (const [id, label, style] of actions) {
      ctx.font = font(30, 600);
      const w = Math.max(130, ctx.measureText(label).width + 56);
      const r = { x, y: 160, w, h: 66 };
      drawButton(ctx, r, label, style, this.isHover(id), 30);
      this.hit({ id, ...r });
      x += w + 18;
    }
    // rename and delete, small, on the right (delete asks once more on the card itself)
    let rx = W - PAD;
    for (const [id, label, style] of [
      ['delete', this.confirmDelete ? tr.deleteConfirm : tr.deleteNote, this.confirmDelete ? 'danger' : 'ghost'],
      ['rename', tr.rename, 'ghost'],
      ['path', tr.pathTo, this.pathPicking ? 'gold' : 'ghost'],
    ] as const) {
      ctx.font = font(25, 600);
      const w = ctx.measureText(label).width + 34;
      rx -= w;
      if (rx < x) break;
      const r = { x: rx, y: 166, w, h: 56 };
      drawButton(ctx, r, label, style, this.isHover(id), 25);
      this.hit({ id, ...r });
      rx -= 10;
    }

    // body (scrollable)
    const key = n.path + '\u0000' + n.mtime;
    if (key !== this.linesFor) {
      this.lines = layout(
        ctx,
        parseBlocks(n.content, (target) => m.resolve(target) !== null),
        W - PAD * 2,
      );
      this.linesFor = key;
    }
    const contentH = this.lines.length ? this.lines[this.lines.length - 1]!.y + this.lines[this.lines.length - 1]!.h : 0;
    this.maxScroll = Math.max(0, contentH - (BODY_BOTTOM - BODY_TOP) + 20);
    this.hit({ id: 'body', x: 0, y: BODY_TOP, w: W, h: BODY_BOTTOM - BODY_TOP, scroll: true });
    const hoverTarget = this.hover?.startsWith('link\u0000') ? this.hover.slice(5) : null;
    const links = paintLines(ctx, this.lines, PAD, BODY_TOP + 10 - this.scrollY, BODY_TOP, BODY_BOTTOM, undefined, hoverTarget);
    for (const l of links) if (l.y + l.h > BODY_TOP && l.y < BODY_BOTTOM) this.hit({ id: 'link', data: l.target, x: l.x, y: l.y, w: l.w, h: l.h });
    if (this.maxScroll > 0) {
      // scroll indicator + fade at the bottom edge
      const trackH = BODY_BOTTOM - BODY_TOP - 20;
      const thumbH = Math.max(50, (trackH * (BODY_BOTTOM - BODY_TOP)) / (contentH + 20));
      const thumbY = BODY_TOP + 10 + ((trackH - thumbH) * this.scrollY) / this.maxScroll;
      roundRect(ctx, W - 22, thumbY, 8, thumbH, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
      if (this.scrollY < this.maxScroll - 4) {
        const g = ctx.createLinearGradient(0, BODY_BOTTOM - 60, 0, BODY_BOTTOM);
        g.addColorStop(0, 'rgba(9,14,28,0)');
        g.addColorStop(1, 'rgba(9,14,28,0.95)');
        ctx.fillStyle = g;
        ctx.fillRect(6, BODY_BOTTOM - 60, W - 12, 60);
      }
    }

    // divider + tabs
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(PAD, BODY_BOTTOM + 8, W - PAD * 2, 2);
    const tabs: [ListTab, string, number][] = [
      ['out', tr.outgoing, m.view.outgoing.length],
      ['in', tr.backlinks, m.view.backlinks.length],
      ['related', tr.related, m.related.length],
    ];
    const tabW = (W - PAD * 2 - 24) / 3;
    tabs.forEach(([id, label, count], i) => {
      const r = { x: PAD + i * (tabW + 12), y: TABS_Y, w: tabW, h: 56 };
      const active = this.tab === id;
      roundRect(ctx, r.x, r.y, r.w, r.h, 28);
      ctx.fillStyle = active
        ? id === 'related'
          ? COLORS.goldSoft
          : COLORS.accentSoft
        : this.isHover('tab', id)
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(255,255,255,0.03)';
      ctx.fill();
      if (active) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = id === 'related' ? COLORS.gold : COLORS.accent;
        ctx.stroke();
      }
      ctx.font = font(27, active ? 700 : 500);
      ctx.fillStyle = active ? COLORS.text : COLORS.textDim;
      ctx.textAlign = 'center';
      ctx.fillText(fit(ctx, `${label} ${count}`, r.w - 20), r.x + r.w / 2, r.y + r.h / 2 + 1);
      ctx.textAlign = 'left';
      this.hit({ id: 'tab', data: id, ...r });
    });

    // list
    const rows = this.rows();
    if (!rows.length) {
      ctx.font = font(28, 400);
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(tr.noLinks, PAD + 8, LIST_TOP + ROW_H / 2);
    }
    rows.slice(0, LIST_ROWS).forEach((row, i) => {
      const y = LIST_TOP + i * ROW_H;
      const r = { x: PAD, y, w: W - PAD * 2 - (row.accept ? 170 : 0), h: ROW_H - 8 };
      const hov = this.isHover('row', row.path ?? row.name);
      roundRect(ctx, r.x, r.y, r.w, r.h, 18);
      ctx.fillStyle = hov ? 'rgba(94,231,255,0.14)' : 'rgba(255,255,255,0.03)';
      ctx.fill();
      dot(ctx, r.x + 26, y + r.h / 2, 9, row.color);
      ctx.font = font(30, 600);
      ctx.fillStyle = row.path ? COLORS.text : COLORS.textDim;
      const nameW = Math.min(ctx.measureText(row.name).width, r.w * 0.55);
      ctx.fillText(fit(ctx, row.name, r.w * 0.55), r.x + 50, y + r.h / 2 + 1);
      if (row.detail) {
        ctx.font = font(24, 400);
        ctx.fillStyle = COLORS.textFaint;
        const [line] = wrapClamped(ctx, row.detail, r.w - nameW - 90, 1);
        ctx.fillText(line ?? '', r.x + 50 + nameW + 24, y + r.h / 2 + 1);
      }
      if (row.path) this.hit({ id: 'row', data: row.path, ...r });
      if (row.accept && row.path) {
        const b = { x: W - PAD - 156, y, w: 156, h: ROW_H - 8 };
        drawButton(ctx, b, t().linkIt, 'gold', this.isHover('accept', row.path), 28);
        this.hit({ id: 'accept', data: row.path, ...b });
      }
    });
    if (rows.length > LIST_ROWS) {
      ctx.font = font(24, 400);
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(`+${rows.length - LIST_ROWS}`, W - PAD - 60, H - 22);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private rows(): { path: string | null; name: string; detail?: string; color: string; accept?: boolean }[] {
    const m = this.model!;
    if (this.tab === 'out')
      return m.view.outgoing.map((o) => ({ path: o.path, name: o.name, color: o.exists ? COLORS.accent : COLORS.ghost, detail: o.exists ? undefined : '—' }));
    if (this.tab === 'in') return m.view.backlinks.map((b) => ({ path: b.path, name: b.name, detail: b.contexts[0], color: COLORS.violet }));
    return m.related.map((r) => ({ path: r.path, name: r.name, detail: r.reason, color: COLORS.gold, accept: true }));
  }
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

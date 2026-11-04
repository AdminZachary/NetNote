/**
 * "What your notes are telling you": hidden links, questions between topics, topics and bridges,
 * notes mentioned but not written, and notes drifting on their own. One row = one thing to think
 * about; pinch the row to see it on the graph, pinch its button to act.
 */
import { t } from '../../app/i18n';
import { INSIGHT_TABS, tabHint, tabLabel, type InsightRow, type InsightTab } from '../../app/insight-rows';
import { COLORS } from '../theme';
import { drawButton, fit, font, panelBackground, roundRect, wrapClamped, type Ctx } from './draw';
import { Surface } from './surface';

const W = 1000;
const H = 1180;
const PAD = 44;
const LIST_TOP = 330;
const ROW_H = 150;

export class InsightsPanel extends Surface {
  tab: InsightTab = 'links';
  rows: InsightRow[] = [];
  counts: Partial<Record<InsightTab, number>> = {};
  summary = '';
  active: string | null = null;

  constructor(widthM = 0.66) {
    super(widthM, W, H);
    this.mesh.name = 'insights';
  }

  set(tab: InsightTab, rows: InsightRow[], counts: Partial<Record<InsightTab, number>>, summary: string): void {
    if (tab !== this.tab) this.scrollY = 0;
    this.tab = tab;
    this.rows = rows;
    this.counts = counts;
    this.summary = summary;
    this.invalidate();
  }

  setActive(key: string | null): void {
    this.active = key;
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    const tr = t();
    panelBackground(ctx, W, H, 40, 'rgba(255,209,102,0.45)');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.gold;
    ctx.font = font(44, 700);
    ctx.fillText(fit(ctx, '✦ ' + tr.insightsTitle, W - PAD * 2 - 90), PAD, 92);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(28, 500);
    ctx.fillText(fit(ctx, this.summary, W - PAD * 2), PAD, 136);
    const close = { x: W - PAD - 72, y: 40, w: 72, h: 72 };
    drawButton(ctx, close, '×', 'ghost', this.isHover('close'), 46);
    this.hit({ id: 'close', ...close });

    // tabs
    // tabs: shrink the type until all five fit on one row (Chinese and English differ a lot in width)
    const labels = INSIGHT_TABS.map((tab) => tabLabel(tab) + (this.counts[tab] ? ` ${this.counts[tab]}` : ''));
    let px = 28;
    const rowW = (p: number): number => {
      ctx.font = font(p, 600);
      return labels.reduce((a, l) => a + ctx.measureText(l).width + p * 1.2 + 8, -8);
    };
    while (px > 18 && rowW(px) > W - PAD * 2) px -= 1;
    let x = PAD;
    ctx.font = font(px, 600);
    INSIGHT_TABS.forEach((tab, i) => {
      const w = ctx.measureText(labels[i]!).width + px * 1.2;
      const r = { x, y: 168, w, h: 60 };
      drawButton(ctx, r, labels[i]!, tab === this.tab ? 'gold' : 'chip', this.isHover('tab', tab), px);
      this.hit({ id: 'tab', data: tab, ...r });
      x += w + 8;
    });
    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(26, 400);
    const hint = wrapClamped(ctx, tabHint(this.tab), W - PAD * 2, 2);
    hint.forEach((l, i) => ctx.fillText(l, PAD, 272 + i * 34));

    // rows (scrollable)
    const viewH = H - LIST_TOP - 30;
    this.maxScroll = Math.max(0, this.rows.length * ROW_H - viewH);
    this.hit({ id: 'list', scroll: true, x: 0, y: LIST_TOP, w: W, h: viewH });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, LIST_TOP, W, viewH);
    ctx.clip();
    if (!this.rows.length) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = font(32, 500);
      wrapClamped(ctx, tr.allConnected, W - PAD * 2, 3).forEach((l, i) => ctx.fillText(l, PAD, LIST_TOP + 60 + i * 44));
    }
    this.rows.forEach((row, i) => {
      const y = LIST_TOP + i * ROW_H - this.scrollY;
      if (y + ROW_H < LIST_TOP || y > LIST_TOP + viewH) return;
      const on = row.key === this.active;
      const hover = this.isHover('row', row.key);
      ctx.fillStyle = on ? 'rgba(255,209,102,0.14)' : hover ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
      roundRect(ctx, PAD - 12, y + 6, W - PAD * 2 + 24, ROW_H - 12, 22);
      ctx.fill();
      // buttons on the right
      let bx = W - PAD;
      ctx.font = font(28, 600);
      const buttons = [...row.actions].reverse().map((a) => {
        const w = Math.max(70, ctx.measureText(a.label).width + 40);
        bx -= w;
        const r = { x: bx, y: y + (ROW_H - 64) / 2, w, h: 64 };
        bx -= 10;
        return { a, r };
      });
      ctx.fillStyle = COLORS.text;
      ctx.font = font(34, 650);
      ctx.fillText(fit(ctx, row.title, bx - PAD - 10), PAD + 6, y + 60);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = font(26, 400);
      wrapClamped(ctx, row.sub, bx - PAD - 10, 2).forEach((l, k) => ctx.fillText(l, PAD + 6, y + 98 + k * 32));
      const clickable = y >= LIST_TOP - 6; // a row half scrolled under the tabs must not steal their pinches
      if (clickable) this.hit({ id: 'row', data: row.key, x: PAD - 12, y: y + 6, w: bx - PAD, h: ROW_H - 12 });
      for (const { a, r } of buttons) {
        drawButton(ctx, r, a.label, a.id === 'link' || a.id === 'write' ? 'gold' : 'ghost', this.isHover(a.id, row.key), 28);
        if (clickable) this.hit({ id: a.id, data: row.key, ...r });
      }
    });
    ctx.restore();
  }
}

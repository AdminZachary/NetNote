/**
 * The wall switcher: you can keep several thinking walls (one per question you are working on) and
 * one of them is open at a time, in the same place on your left. This small panel hangs at the near
 * end of the wall, at eye level, where a short turn of the head finds it: the open wall's name,
 * previous / next, a new wall, rename and delete. It shows only while you look towards the wall, so
 * it never sits in front of the graph.
 */
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { drawButton, fit, font, panelBackground, type Ctx } from '../ui/draw';
import { Surface } from '../ui/surface';

const W = 440;
const H = 560;
export const WALL_BAR_W = 0.2;

export interface WallBarModel {
  name: string;
  index: number;
  count: number;
  cards: number;
  confirmDelete: boolean;
}

export class WallBar extends Surface {
  model: WallBarModel = { name: '', index: 0, count: 1, cards: 0, confirmDelete: false };
  /** 0..1, eased towards `target` */
  opacity = 0;
  target = 0;

  constructor() {
    super(WALL_BAR_W, W, H);
    this.mesh.name = 'wall-bar';
  }

  set(m: WallBarModel): void {
    const same = (Object.keys(m) as (keyof WallBarModel)[]).every((k) => m[k] === this.model[k]);
    if (same) return;
    this.model = m;
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    const m = this.model;
    const tr = t();
    panelBackground(ctx, W, H, 36, COLORS.gold);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = font(24, 600);
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(tr.wallBarTitle, W / 2, 46);
    ctx.font = font(38, 700);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, m.name, W - 60), W / 2, 100);
    ctx.font = font(23, 400);
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(`${m.index + 1} / ${m.count}  ·  ${tr.wallCards(m.cards)}`, W / 2, 146);
    // previous / next: the big, frequent targets
    const half = (W - 32 * 2 - 16) / 2;
    const prev = { x: 32, y: 182, w: half, h: 96 };
    const next = { x: 32 + half + 16, y: 182, w: half, h: 96 };
    drawButton(ctx, prev, '◀', 'ghost', this.isHover('prev'), 40);
    drawButton(ctx, next, '▶', 'ghost', this.isHover('next'), 40);
    this.hit({ id: 'prev', ...prev });
    this.hit({ id: 'next', ...next });
    const add = { x: 32, y: 296, w: W - 64, h: 84 };
    drawButton(ctx, add, tr.wallNew, 'primary', this.isHover('new'), 30);
    this.hit({ id: 'new', ...add });
    const ren = { x: 32, y: 396, w: half, h: 76 };
    const del = { x: 32 + half + 16, y: 396, w: half, h: 76 };
    drawButton(ctx, ren, tr.rename, 'ghost', this.isHover('rename'), 26);
    this.hit({ id: 'rename', ...ren });
    if (m.count > 1 || m.cards > 0) {
      drawButton(ctx, del, m.confirmDelete ? tr.deleteConfirm : tr.wallDelete, m.confirmDelete ? 'danger' : 'ghost', this.isHover('delete'), 26);
      this.hit({ id: 'delete', ...del });
    }
    ctx.font = font(21, 400);
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(fit(ctx, m.confirmDelete ? tr.wallDeleteHint : tr.wallBarHint, W - 50), W / 2, 510);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/**
 * The dock: a small row of actions that waits below your line of sight (look down to find it, as
 * with the Quest system bar). It works the same with hands, controllers, the narrow-view glasses and a
 * mouse, and never covers what you are reading.
 */
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { font, panelBackground, roundRect, type Ctx } from './draw';
import { Surface } from './surface';

export type DockAction = 'new' | 'search' | 'wall' | 'topics' | 'map' | 'more' | 'recenter' | 'exit';

const W = 1400;
const H = 200;

const ICONS: Record<DockAction, string> = {
  new: '✎',
  search: '⌕',
  wall: '▦',
  topics: '✦',
  map: '◉',
  more: '⋯',
  recenter: '⟲',
  exit: '⏏',
};

export class Dock extends Surface {
  active = new Set<DockAction>();
  actions: DockAction[] = ['new', 'search', 'wall', 'topics', 'map', 'more', 'recenter', 'exit'];
  status = '';

  constructor(widthM = 0.56) {
    super(widthM, W, H);
    this.mesh.name = 'dock';
  }

  setActive(a: DockAction, on: boolean): void {
    if (on) this.active.add(a);
    else this.active.delete(a);
    this.invalidate();
  }

  setStatus(s: string): void {
    if (s !== this.status) {
      this.status = s;
      this.invalidate();
    }
  }

  protected paint(ctx: Ctx): void {
    panelBackground(ctx, W, H, 60);
    const tr = t();
    const labels: Record<DockAction, string> = {
      new: tr.menuNew,
      search: tr.menuSearch,
      wall: tr.menuWall,
      topics: tr.menuOverview,
      map: tr.menuMap,
      more: tr.menuMore,
      recenter: tr.menuRecenter,
      exit: tr.menuExit,
    };
    const n = this.actions.length;
    const gap = 12;
    const bw = (W - 40 - gap * (n - 1)) / n;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.actions.forEach((a, i) => {
      const r = { x: 20 + i * (bw + gap), y: 22, w: bw, h: H - 44 };
      const on = this.active.has(a);
      const hov = this.isHover(a);
      roundRect(ctx, r.x, r.y, r.w, r.h, 34);
      ctx.fillStyle = on ? COLORS.accentSoft : hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.fill();
      if (on || hov) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = on ? COLORS.accent : 'rgba(255,255,255,0.3)';
        ctx.stroke();
      }
      ctx.fillStyle = on ? COLORS.accent : COLORS.text;
      ctx.font = font(58, 400);
      ctx.fillText(ICONS[a], r.x + r.w / 2, r.y + 54);
      ctx.font = font(25, 600);
      ctx.fillStyle = on ? COLORS.text : COLORS.textDim;
      ctx.fillText(labels[a], r.x + r.w / 2, r.y + r.h - 30);
      this.hit({ id: a, ...r });
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

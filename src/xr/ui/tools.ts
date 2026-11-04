/**
 * The "More" row: switches you use now and then (tour, time machine, sound, motion, the companion).
 * It opens just above the dock, so the dock itself stays short and easy to aim at.
 */
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { font, panelBackground, roundRect, type Ctx } from './draw';
import { Surface } from './surface';

export type ToolAction = 'tour' | 'time' | 'sound' | 'motion' | 'pet';

const W = 900;
const H = 170;
const ICONS: Record<ToolAction, string> = { tour: '⇝', time: '◷', sound: '♪', motion: '≈', pet: '❀' };

export class ToolsRow extends Surface {
  readonly actions: ToolAction[] = ['tour', 'time', 'sound', 'motion', 'pet'];
  readonly active = new Set<ToolAction>();

  constructor(widthM = 0.36) {
    super(widthM, W, H);
    this.mesh.name = 'tools';
  }

  setActive(a: ToolAction, on: boolean): void {
    if (on === this.active.has(a)) return;
    if (on) this.active.add(a);
    else this.active.delete(a);
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    panelBackground(ctx, W, H, 52);
    const tr = t();
    const labels: Record<ToolAction, string> = { tour: tr.menuTour, time: tr.menuTime, sound: tr.menuSound, motion: tr.menuMotion, pet: tr.menuPet };
    const n = this.actions.length;
    const gap = 10;
    const bw = (W - 32 - gap * (n - 1)) / n;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.actions.forEach((a, i) => {
      const r = { x: 16 + i * (bw + gap), y: 16, w: bw, h: H - 32 };
      const on = this.active.has(a);
      const hov = this.isHover(a);
      roundRect(ctx, r.x, r.y, r.w, r.h, 30);
      ctx.fillStyle = on ? COLORS.accentSoft : hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.fill();
      if (on || hov) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = on ? COLORS.accent : 'rgba(255,255,255,0.3)';
        ctx.stroke();
      }
      ctx.fillStyle = on ? COLORS.accent : COLORS.text;
      ctx.font = font(50, 400);
      ctx.fillText(ICONS[a], r.x + r.w / 2, r.y + 46);
      ctx.font = font(25, 600);
      ctx.fillStyle = on ? COLORS.text : COLORS.textDim;
      ctx.fillText(labels[a], r.x + r.w / 2, r.y + r.h - 28);
      this.hit({ id: a, ...r });
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

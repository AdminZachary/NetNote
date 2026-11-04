/**
 * One short line of guidance at a time, shown above the graph. The first-five-minutes tour moves on
 * when you actually do the thing (pinch a star, move the room, connect two notes), never by timer,
 * and it never returns once done.
 */
import { COLORS } from '../theme';
import { fit, font, roundRect, type Ctx } from './draw';
import { Surface } from './surface';

const W = 1800;
const H = 150;

export class Hint extends Surface {
  text = '';
  step = '';
  private fade = 0;

  constructor(widthM = 1.15) {
    super(widthM, W, H);
    this.mesh.name = 'hint';
    this.mesh.raycast = () => undefined; // never blocks a pinch
  }

  show(text: string, step = ''): void {
    if (text === this.text && step === this.step) return;
    this.text = text;
    this.step = step;
    this.fade = 0;
    this.mesh.visible = !!text;
    this.invalidate();
  }

  tick(dt: number): void {
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt * 3);
      this.mesh.material.opacity = this.fade;
    }
  }

  protected paint(ctx: Ctx): void {
    ctx.clearRect(0, 0, W, H);
    if (!this.text) return;
    ctx.font = font(44, 600);
    const w = Math.min(W - 20, ctx.measureText(this.text).width + (this.step ? 190 : 110));
    const x = (W - w) / 2;
    roundRect(ctx, x, 20, w, H - 40, (H - 40) / 2);
    ctx.fillStyle = 'rgba(8,14,30,0.82)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(94,231,255,0.5)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    let tx = x + 54;
    if (this.step) {
      ctx.font = font(30, 700);
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(this.step, tx, H / 2);
      tx += 80;
    }
    ctx.font = font(44, 600);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, this.text, x + w - tx - 40), tx, H / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }
}

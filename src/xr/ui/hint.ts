/**
 * The headset guide: one step at a time, with a small looping animation of the gesture itself (a hand
 * pinching, dragging, turning its palm up…, or a controller's trigger when you hold controllers), so
 * you can copy the movement instead of reading about it. The tour moves on when you actually do the
 * thing, never by timer, and it never returns once done.
 */
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { font, roundRect, wrap, type Ctx } from './draw';
import { Surface } from './surface';

const W = 1800;
const H = 330;
const GLYPH = 290;

/** Which movement the animation shows. */
export type Gesture = 'none' | 'pinch' | 'drag' | 'palm' | 'look' | 'menu' | 'tap';

export class Hint extends Surface {
  text = '';
  step = '';
  gesture: Gesture = 'none';
  /** draw a controller and its trigger instead of a hand */
  controller = false;
  private fade = 0;
  private time = 0;
  private frameAcc = 0;

  constructor(widthM = 1.25) {
    super(widthM, W, H);
    this.mesh.name = 'hint';
    this.mesh.raycast = () => undefined; // never blocks a pinch
  }

  show(text: string, step = '', gesture: Gesture = 'none'): void {
    if (text === this.text && step === this.step && gesture === this.gesture) return;
    this.text = text;
    this.step = step;
    this.gesture = text ? gesture : 'none';
    this.fade = 0;
    this.time = 0;
    this.mesh.visible = !!text;
    this.invalidate();
  }

  setController(on: boolean): void {
    if (on === this.controller) return;
    this.controller = on;
    this.invalidate();
  }

  tick(dt: number): void {
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt * 3);
      this.mesh.material.opacity = this.fade;
    }
    if (!this.mesh.visible || this.gesture === 'none') return;
    this.time += dt;
    // redraw the animation at ~30 fps: smooth enough, and cheap on the texture upload
    this.frameAcc += dt;
    if (this.frameAcc > 1 / 30) {
      this.frameAcc = 0;
      this.invalidate();
    }
  }

  protected paint(ctx: Ctx): void {
    ctx.clearRect(0, 0, W, H);
    if (!this.text) return;
    const hasGlyph = this.gesture !== 'none';
    ctx.font = font(48, 600);
    const textW = hasGlyph ? W - GLYPH - 170 : W - 200;
    const lines = wrap(ctx, this.text, textW, 3);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const w = Math.min(W - 20, widest + (hasGlyph ? GLYPH + 150 : 120));
    const x = (W - w) / 2;
    // the card, with a slow glow on its edge so the eye finds it
    const pulse = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 3));
    roundRect(ctx, x, 10, w, H - 20, 48);
    ctx.fillStyle = 'rgba(8,14,30,0.9)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(94,231,255,${hasGlyph ? pulse : 0.5})`;
    ctx.stroke();

    let tx = x + 50;
    if (hasGlyph) {
      const gx = x + 24;
      roundRect(ctx, gx, 30, GLYPH, H - 60, 36);
      ctx.fillStyle = 'rgba(94,231,255,0.07)';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, gx, 30, GLYPH, H - 60, 36);
      ctx.clip();
      drawGesture(ctx, this.gesture, this.controller, gx + GLYPH / 2, H / 2, this.time);
      ctx.restore();
      if (this.controller && this.gesture !== 'look') {
        // with controllers, "pinch" means the trigger
        ctx.font = font(26, 600);
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'center';
        ctx.fillText(t().triggerIsPinch, gx + GLYPH / 2, H - 44);
        ctx.textAlign = 'left';
      }
      tx = gx + GLYPH + 46;
    }
    ctx.textBaseline = 'middle';
    const lh = 62;
    let y = H / 2 - ((lines.length - 1) * lh) / 2 - (this.step ? 22 : 0);
    if (this.step) {
      ctx.font = font(32, 700);
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(this.step, tx, y - 16);
      y += 30;
    }
    ctx.font = font(48, 600);
    ctx.fillStyle = COLORS.text;
    for (const l of lines) {
      ctx.fillText(l, tx, y + (this.step ? 14 : 0));
      y += lh;
    }
    ctx.textBaseline = 'alphabetic';
  }
}

// ---------- the little animations ----------

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
/** 0→1→0 over one loop of `period` seconds, holding a moment at each end. */
function cycle(time: number, period: number): number {
  const p = (time % period) / period;
  if (p < 0.2) return 0;
  if (p < 0.45) return ease((p - 0.2) / 0.25);
  if (p < 0.7) return 1;
  if (p < 0.95) return 1 - ease((p - 0.7) / 0.25);
  return 0;
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string, glow = 0): void {
  if (glow > 0) {
    ctx.beginPath();
    ctx.arc(x, y, r * (1.8 + glow), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,209,102,${0.25 * glow})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function ray(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, 'rgba(94,231,255,0.0)');
  g.addColorStop(1, 'rgba(94,231,255,0.85)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * A right hand seen from behind, fingers up, pointing ahead. `pinch` 0..1 brings the thumb and index
 * tips together; `turn` 0..1 turns the palm towards you (drawn by narrowing and showing the palm).
 */
function hand(ctx: Ctx, cx: number, cy: number, s: number, pinch: number, turn = 0, mirror = false): { tip: [number, number] } {
  ctx.save();
  ctx.translate(cx, cy);
  const sx = (mirror ? -1 : 1) * (1 - 0.55 * Math.sin(turn * Math.PI) * 0.6);
  ctx.scale(sx * s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const palmColor = turn > 0.5 ? 'rgba(255,209,102,0.22)' : 'rgba(232,241,255,0.10)';
  // palm
  roundRect(ctx, -34, -10, 68, 70, 26);
  ctx.fillStyle = palmColor;
  ctx.fill();
  ctx.strokeStyle = '#e8f1ff';
  ctx.lineWidth = 6;
  ctx.stroke();
  // middle, ring, little fingers (curl a little while pinching)
  const curl = pinch * 14;
  const finger = (x: number, len: number): void => {
    ctx.beginPath();
    ctx.moveTo(x, -10);
    ctx.lineTo(x + curl * 0.2, -10 - len + curl);
    ctx.stroke();
  };
  ctx.lineWidth = 15;
  ctx.strokeStyle = '#e8f1ff';
  finger(-2, 62);
  finger(17, 56);
  finger(32, 44);
  // index finger bends down to meet the thumb
  const ix = -22 + pinch * 6;
  const iy = -10 - 64 + pinch * 34;
  ctx.beginPath();
  ctx.moveTo(-22, -10);
  ctx.quadraticCurveTo(-26, -50 + pinch * 10, ix, iy);
  ctx.stroke();
  // thumb comes up from the side
  const thx = -52 + pinch * 26;
  const thy = 6 - pinch * 50;
  ctx.beginPath();
  ctx.moveTo(-30, 40);
  ctx.quadraticCurveTo(-60, 20, thx, thy);
  ctx.stroke();
  // the spark where the tips meet
  if (pinch > 0.85) {
    ctx.beginPath();
    ctx.arc((ix + thx) / 2, (iy + thy) / 2, 10 + 6 * (pinch - 0.85) * 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(94,231,255,0.9)';
    ctx.fill();
  }
  ctx.restore();
  // where the pointing ray starts (in canvas space)
  return { tip: [cx + (mirror ? 1 : -1) * 14 * s * Math.abs(sx), cy - 70 * s] };
}

/** A Quest controller from above, its trigger pressed by `press` 0..1. */
function controller(ctx: Ctx, cx: number, cy: number, s: number, press: number): { tip: [number, number] } {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e8f1ff';
  ctx.fillStyle = 'rgba(232,241,255,0.10)';
  // ring
  ctx.beginPath();
  ctx.ellipse(0, -46, 40, 24, 0, 0, Math.PI * 2);
  ctx.stroke();
  // grip
  roundRect(ctx, -22, -30, 44, 96, 20);
  ctx.fill();
  ctx.stroke();
  // trigger (lit while pressed)
  roundRect(ctx, -12, -18 + press * 8, 24, 30, 8);
  ctx.fillStyle = press > 0.5 ? COLORS.accent : 'rgba(94,231,255,0.35)';
  ctx.fill();
  ctx.restore();
  return { tip: [cx, cy - 72 * s] };
}

function drawGesture(ctx: Ctx, g: Gesture, ctrl: boolean, cx: number, cy: number, time: number): void {
  const actor = (x: number, y: number, s: number, p: number, turn = 0): { tip: [number, number] } =>
    ctrl ? controller(ctx, x, y, s, p) : hand(ctx, x, y, s, p, turn);
  switch (g) {
    case 'pinch':
    case 'tap': {
      // point at a star, pinch: the star lights up
      const p = cycle(time, 2.2);
      const sx = cx + 50;
      const sy = cy - 80;
      star(ctx, sx, sy, 16, g === 'tap' ? COLORS.violet : COLORS.accent, p);
      const { tip } = actor(cx - 40, cy + 55, 1.15, p);
      ray(ctx, tip[0], tip[1], sx, sy);
      break;
    }
    case 'drag': {
      // pinch a star, carry it to another, let go: a link appears
      const period = 3.2;
      const ph = (time % period) / period;
      const grab = ph < 0.15 ? ease(ph / 0.15) : ph < 0.75 ? 1 : 1 - ease(clamp01((ph - 0.75) / 0.1));
      const move = ph < 0.18 ? 0 : ph < 0.65 ? ease((ph - 0.18) / 0.47) : 1;
      const ax = cx - 80;
      const ay = cy - 90;
      const bx = cx + 85;
      const by = cy - 60;
      const ex = ax + (bx - ax) * move;
      const ey = ay + (by - ay) * move;
      // the rubber band, gold once it reaches the other star
      if (grab > 0.5) {
        ctx.strokeStyle = move > 0.95 ? COLORS.gold : 'rgba(159,176,204,0.8)';
        ctx.lineWidth = 5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ph > 0.75) {
        ctx.strokeStyle = COLORS.gold;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      star(ctx, ax, ay, 15, COLORS.accent, grab * 0.6);
      star(ctx, bx, by, 15, '#ffb86b', move > 0.95 ? 1 : 0);
      const { tip } = actor(cx - 60 + 120 * move, cy + 70, 1.0, grab);
      ray(ctx, tip[0], tip[1], ex, ey);
      break;
    }
    case 'palm': {
      // the left hand turns its palm towards you: the map appears above it
      const turn = cycle(time, 2.8);
      hand(ctx, cx, cy + 45, 1.15, 0, turn, true);
      if (turn > 0.8) {
        const a = clamp01((turn - 0.8) / 0.2);
        ctx.globalAlpha = a;
        const pts: [number, number][] = [
          [-40, -95],
          [0, -120],
          [38, -92],
          [-10, -70],
          [24, -60],
        ];
        ctx.strokeStyle = 'rgba(94,231,255,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y)));
        ctx.stroke();
        for (const [x, y] of pts) star(ctx, cx + x, cy + y, 8, COLORS.accent);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'menu': {
      // left palm towards you, then a quick pinch of the right hand: the menu bar shows
      const period = 3.0;
      const ph = (time % period) / period;
      const turn = ph < 0.3 ? ease(ph / 0.3) : ph < 0.85 ? 1 : 1 - ease((ph - 0.85) / 0.15);
      const p = ph > 0.4 && ph < 0.55 ? Math.sin(((ph - 0.4) / 0.15) * Math.PI) : 0;
      hand(ctx, cx - 62, cy + 50, 0.85, 0, turn, true);
      if (ctrl) controller(ctx, cx + 70, cy + 55, 0.85, p);
      else hand(ctx, cx + 70, cy + 55, 0.85, p);
      if (ph > 0.55 && ph < 0.95) {
        ctx.globalAlpha = Math.min(1, (ph - 0.55) / 0.08);
        roundRect(ctx, cx - 110, cy - 115, 220, 44, 22);
        ctx.fillStyle = 'rgba(94,231,255,0.25)';
        ctx.fill();
        for (let i = 0; i < 5; i++) star(ctx, cx - 80 + i * 40, cy - 93, 7, COLORS.text);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'look': {
      // turn your head left: an arrow sweeps that way, towards the wall
      const t = (time % 2.4) / 2.4;
      const off = -ease(clamp01(t / 0.6)) * 70;
      ctx.strokeStyle = '#e8f1ff';
      ctx.lineWidth = 6;
      // a head from above, nose pointing the way you look
      ctx.beginPath();
      ctx.arc(cx, cy + 40, 40, 0, Math.PI * 2);
      ctx.stroke();
      const ang = -Math.PI / 2 + (off / 70) * (Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 40, cy + 40 + Math.sin(ang) * 40);
      ctx.lineTo(cx + Math.cos(ang) * 64, cy + 40 + Math.sin(ang) * 64);
      ctx.stroke();
      // the wall over there
      roundRect(ctx, cx - 120 + off * 0.2, cy - 110, 90, 70, 10);
      ctx.fillStyle = 'rgba(255,209,102,0.25)';
      ctx.fill();
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 4;
      ctx.stroke();
      // arrow
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy + 40, 90, -Math.PI / 2, -Math.PI / 2 - (Math.PI / 3) * clamp01(t / 0.6), true);
      ctx.stroke();
      break;
    }
    case 'none':
      break;
  }
}

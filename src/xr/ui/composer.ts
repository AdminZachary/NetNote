/**
 * The writing card: what you are writing, for which note or connection, and the text as you type it.
 * Shown just below eye level at ~0.6 m, where the Quest keyboard appears beneath it.
 */
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { drawButton, fit, font, panelBackground, roundRect, wrap, type Ctx } from './draw';
import { Surface } from './surface';

export interface ComposerModel {
  title: string;
  /** e.g. "Sleep ↔ Memory" or the note name */
  context: string;
  placeholder: string;
  text: string;
  keyboardOpen: boolean;
  /** show a "Skip" button (save without text) instead of only Cancel */
  skippable: boolean;
  accent: string;
  hint: string;
}

const W = 1000;
const H = 620;
const PAD = 44;

export class Composer extends Surface {
  model: ComposerModel | null = null;
  private caretOn = true;
  private caretTimer = 0;

  constructor(widthM = 0.56) {
    super(widthM, W, H);
    this.mesh.name = 'composer';
  }

  set(model: ComposerModel): void {
    this.model = model;
    this.invalidate();
  }

  /** Blink the caret (call with frame delta in seconds). */
  tick(dt: number): void {
    this.caretTimer += dt;
    if (this.caretTimer > 0.55) {
      this.caretTimer = 0;
      this.caretOn = !this.caretOn;
      this.invalidate();
    }
  }

  protected paint(ctx: Ctx): void {
    const m = this.model;
    panelBackground(ctx, W, H, 40, m ? m.accent : COLORS.panelEdge);
    if (!m) return;
    const tr = t();
    ctx.textBaseline = 'middle';
    ctx.font = font(40, 700);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, m.title, W - PAD * 2), PAD, 66);
    ctx.font = font(28, 500);
    ctx.fillStyle = m.accent;
    ctx.fillText(fit(ctx, m.context, W - PAD * 2), PAD, 114);

    // text box: pinch it to (re)open the keyboard
    const box = { x: PAD, y: 150, w: W - PAD * 2, h: 290 };
    roundRect(ctx, box.x, box.y, box.w, box.h, 24);
    ctx.fillStyle = this.isHover('type') ? 'rgba(94,231,255,0.10)' : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.lineWidth = m.keyboardOpen ? 4 : 2;
    ctx.strokeStyle = m.keyboardOpen ? COLORS.accent : 'rgba(255,255,255,0.16)';
    ctx.stroke();
    this.hit({ id: 'type', ...box });
    ctx.font = font(34, 400);
    const lineH = 46;
    const maxLines = Math.floor((box.h - 30) / lineH);
    if (m.text) {
      let lines = wrap(ctx, m.text, box.w - 48);
      if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines); // keep the end in view
      ctx.fillStyle = COLORS.text;
      lines.forEach((l, i) => ctx.fillText(l, box.x + 24, box.y + 36 + i * lineH));
      if (this.caretOn && m.keyboardOpen) {
        const last = lines[lines.length - 1] ?? '';
        const cx = box.x + 24 + ctx.measureText(last).width + 4;
        ctx.fillStyle = COLORS.accent;
        ctx.fillRect(cx, box.y + 36 + (lines.length - 1) * lineH - 20, 4, 40);
      }
    } else {
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(fit(ctx, m.keyboardOpen ? m.placeholder : tr.typeHere, box.w - 48), box.x + 24, box.y + 36);
    }

    ctx.font = font(24, 400);
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(fit(ctx, m.hint, W - PAD * 2), PAD, 470);

    // buttons
    const y = 510;
    const bh = 76;
    const save = { x: W - PAD - 230, y, w: 230, h: bh };
    drawButton(ctx, save, tr.save, 'primary', this.isHover('save'), 32);
    this.hit({ id: 'save', ...save });
    const cancel = { x: save.x - 230 - 18, y, w: 230, h: bh };
    drawButton(ctx, cancel, m.skippable ? tr.skip : tr.cancel, 'ghost', this.isHover('cancel'), 32);
    this.hit({ id: 'cancel', ...cancel });
    const del = { x: PAD, y, w: 150, h: bh };
    drawButton(ctx, del, '⌫', 'ghost', this.isHover('delete'), 36);
    this.hit({ id: 'delete', ...del });
    ctx.textBaseline = 'alphabetic';
  }
}

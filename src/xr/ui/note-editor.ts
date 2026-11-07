/**
 * Editing a note in the headset, one block at a time (a paragraph, heading, list or code block):
 *   - pinch a block in the list (or step with ◀ ▶) to choose it; its text comes up in the box;
 *   - pinch the box to type with the Quest keyboard (or voice): what you type is added at the end;
 *     ⌫ removes the last word, "Clear" empties the block so you can say it again;
 *   - "+ Below" starts a new block after this one, "Delete" removes it;
 *   - Save writes the note; nothing changes until you do.
 * Placed like the writing card (low and close, where the keyboard appears) but taller.
 */
import { t } from '../../app/i18n';
import { blockPreview } from '../../core/markdown/blocks';
import { COLORS } from '../theme';
import { drawButton, fit, font, panelBackground, roundRect, wrap, type Ctx } from './draw';
import { Surface } from './surface';

export interface EditorModel {
  name: string;
  accent: string;
  blocks: string[];
  index: number;
  /** the chosen block as it is being edited */
  text: string;
  keyboardOpen: boolean;
  dirty: boolean;
}

const W = 1100;
const H = 1180;
const PAD = 44;
const LIST_TOP = 640;
const LIST_BOTTOM = 1040;
const ROW = 74;

export class NoteEditor extends Surface {
  model: EditorModel | null = null;
  private caretOn = true;
  private caretTimer = 0;

  constructor(widthM = 0.62) {
    super(widthM, W, H);
    this.mesh.name = 'note-editor';
  }

  set(m: EditorModel): void {
    const moved = this.model?.index !== m.index;
    this.model = m;
    if (moved) this.scrollToIndex(m.index);
    this.invalidate();
  }

  tick(dt: number): void {
    this.caretTimer += dt;
    if (this.caretTimer > 0.55) {
      this.caretTimer = 0;
      this.caretOn = !this.caretOn;
      this.invalidate();
    }
  }

  private scrollToIndex(i: number): void {
    const y = i * ROW;
    const h = LIST_BOTTOM - LIST_TOP;
    if (y < this.scrollY) this.scrollY = y;
    else if (y + ROW > this.scrollY + h) this.scrollY = y + ROW - h;
  }

  protected paint(ctx: Ctx): void {
    const m = this.model;
    panelBackground(ctx, W, H, 40, m ? m.accent : COLORS.panelEdge);
    if (!m) return;
    const tr = t();
    ctx.textBaseline = 'middle';
    ctx.font = font(40, 700);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fit(ctx, `${tr.editTitle} · ${m.name}`, W - PAD * 2 - 100), PAD, 64);
    const close = { x: W - PAD - 72, y: 28, w: 72, h: 72 };
    drawButton(ctx, close, '×', 'ghost', this.isHover('cancel'), 46);
    this.hit({ id: 'cancel', ...close });
    ctx.font = font(26, 500);
    ctx.fillStyle = m.accent;
    ctx.fillText(tr.blockOf(m.index + 1, m.blocks.length), PAD, 118);

    // the chosen block: pinch to type
    const box = { x: PAD, y: 146, w: W - PAD * 2, h: 330 };
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
      let lines = m.text.split('\n').flatMap((l) => (l ? wrap(ctx, l, box.w - 48) : ['']));
      if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
      ctx.fillStyle = COLORS.text;
      lines.forEach((l, i) => ctx.fillText(l, box.x + 24, box.y + 38 + i * lineH));
      if (this.caretOn && m.keyboardOpen) {
        const last = lines[lines.length - 1] ?? '';
        ctx.fillStyle = COLORS.accent;
        ctx.fillRect(box.x + 24 + ctx.measureText(last).width + 4, box.y + 38 + (lines.length - 1) * lineH - 20, 4, 40);
      }
    } else {
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(tr.typeHere, box.x + 24, box.y + 38);
    }

    // block tools
    const tools: [string, string, 'ghost' | 'danger' | 'gold'][] = [
      ['prev', '◀', 'ghost'],
      ['next', '▶', 'ghost'],
      ['word', '⌫', 'ghost'],
      ['clear', tr.clearBlock, 'ghost'],
      ['below', tr.addBelow, 'gold'],
      ['remove', tr.removeBlock, 'danger'],
    ];
    let x = PAD;
    for (const [id, label, style] of tools) {
      ctx.font = font(30, 600);
      const w = label.length <= 2 ? 96 : ctx.measureText(label).width + 52;
      const r = { x, y: 500, w, h: 74 };
      drawButton(ctx, r, label, style, this.isHover(id), label.length <= 2 ? 38 : 30);
      this.hit({ id, ...r });
      x += w + 14;
    }
    ctx.font = font(24, 400);
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(fit(ctx, tr.editHint, W - PAD * 2), PAD, 610);

    // every block of the note: pinch one to edit it
    const listH = LIST_BOTTOM - LIST_TOP;
    this.maxScroll = Math.max(0, m.blocks.length * ROW - listH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, LIST_TOP, W, listH);
    ctx.clip();
    m.blocks.forEach((b, i) => {
      const y = LIST_TOP + i * ROW - this.scrollY;
      if (y + ROW < LIST_TOP || y > LIST_BOTTOM) return;
      const r = { x: PAD, y: y + 4, w: W - PAD * 2, h: ROW - 8 };
      const on = i === m.index;
      roundRect(ctx, r.x, r.y, r.w, r.h, 16);
      ctx.fillStyle = on ? 'rgba(94,231,255,0.16)' : this.isHover('block', String(i)) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)';
      ctx.fill();
      if (on) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = COLORS.accent;
        ctx.stroke();
      }
      ctx.font = font(28, on ? 600 : 400);
      ctx.fillStyle = on ? COLORS.text : COLORS.textDim;
      const shown = on ? m.text : b;
      ctx.fillText(fit(ctx, `${i + 1}  ${blockPreview(shown) || '…'}`, r.w - 36), r.x + 20, r.y + r.h / 2);
      const top = Math.max(r.y, LIST_TOP);
      const bottom = Math.min(r.y + r.h, LIST_BOTTOM);
      if (bottom > top) this.hit({ id: 'block', data: String(i), x: r.x, y: top, w: r.w, h: bottom - top });
    });
    ctx.restore();
    this.hit({ id: 'list', x: 0, y: LIST_TOP, w: W, h: listH, scroll: true });

    // save / cancel
    const y = H - 112;
    const save = { x: W - PAD - 240, y, w: 240, h: 80 };
    drawButton(ctx, save, tr.save, m.dirty ? 'primary' : 'ghost', this.isHover('save'), 32);
    this.hit({ id: 'save', ...save });
    const cancel = { x: save.x - 240 - 18, y, w: 240, h: 80 };
    drawButton(ctx, cancel, tr.cancel, 'ghost', this.isHover('cancel'), 32);
    this.hit({ id: 'cancel', ...cancel });
    ctx.textBaseline = 'alphabetic';
  }
}

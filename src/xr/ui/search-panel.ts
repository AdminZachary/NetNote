/** Find a note by typing: results update as you type; pinch one to fly to it. */
import type { SearchHit } from '../../core/vault/vault';
import { t } from '../../app/i18n';
import { COLORS } from '../theme';
import { dot, drawButton, fit, font, panelBackground, roundRect, type Ctx } from './draw';
import { Surface } from './surface';

const W = 1000;
const H = 900;
const PAD = 44;
const ROW = 92;

export class SearchPanel extends Surface {
  query = '';
  results: SearchHit[] = [];
  keyboardOpen = false;
  colorOf: (path: string) => string = () => COLORS.accent;

  constructor(widthM = 0.6) {
    super(widthM, W, H);
    this.mesh.name = 'search';
  }

  set(query: string, results: SearchHit[], keyboardOpen: boolean): void {
    this.query = query;
    this.results = results;
    this.keyboardOpen = keyboardOpen;
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    panelBackground(ctx, W, H, 40);
    const tr = t();
    ctx.textBaseline = 'middle';
    const box = { x: PAD, y: 40, w: W - PAD * 2 - 110, h: 96 };
    roundRect(ctx, box.x, box.y, box.w, box.h, 48);
    ctx.fillStyle = this.isHover('type') ? 'rgba(94,231,255,0.12)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = this.keyboardOpen ? 4 : 2;
    ctx.strokeStyle = this.keyboardOpen ? COLORS.accent : 'rgba(255,255,255,0.18)';
    ctx.stroke();
    this.hit({ id: 'type', ...box });
    ctx.font = font(38, 500);
    ctx.fillStyle = this.query ? COLORS.text : COLORS.textFaint;
    ctx.fillText(fit(ctx, this.query || (this.keyboardOpen ? tr.searchPlaceholder : tr.typeHere), box.w - 70), box.x + 36, box.y + box.h / 2);
    const close = { x: W - PAD - 92, y: 42, w: 92, h: 92 };
    drawButton(ctx, close, '×', 'ghost', this.isHover('close'), 50);
    this.hit({ id: 'close', ...close });

    if (this.query && !this.results.length) {
      ctx.font = font(30, 400);
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(tr.noResults, PAD + 10, 200);
    }
    this.results.slice(0, 7).forEach((r, i) => {
      const y = 166 + i * ROW;
      const rect = { x: PAD, y, w: W - PAD * 2, h: ROW - 12 };
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
      ctx.fillStyle = this.isHover('result', r.path) ? 'rgba(94,231,255,0.14)' : 'rgba(255,255,255,0.03)';
      ctx.fill();
      dot(ctx, rect.x + 28, y + 28, 10, this.colorOf(r.path));
      ctx.font = font(32, 600);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(fit(ctx, r.name, rect.w - 80), rect.x + 54, y + 28);
      ctx.font = font(23, 400);
      ctx.fillStyle = COLORS.textFaint;
      ctx.fillText(fit(ctx, r.snippet, rect.w - 80), rect.x + 54, y + 60);
      this.hit({ id: 'result', data: r.path, ...rect });
    });
    ctx.textBaseline = 'alphabetic';
  }
}

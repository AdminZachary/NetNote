/**
 * The label over a group on the thinking wall: what the cards share, the note that seems to be
 * missing (pinch it to bring it into the group), and a question to think about, with a button to
 * write the answer as a new note linked to the whole group.
 */
import { clusterQuestion, t } from '../../app/i18n';
import type { ClusterInfo } from '../../core/insights/cluster';
import { drawButton, fit, font, roundRect, wrapClamped, type Ctx } from '../ui/draw';
import { Surface } from '../ui/surface';

const W = 1000;
const H = 470;
export const TAG_W = 0.66;
export const TAG_H = (TAG_W * H) / W;

export class WallTag extends Surface {
  key = '';
  paths: string[] = [];
  private info: ClusterInfo | null = null;
  private name: (p: string) => string = (p) => p;

  constructor() {
    super(TAG_W, W, H);
    this.mesh.name = 'wall-tag';
  }

  set(paths: string[], info: ClusterInfo | null, name: (p: string) => string): void {
    const key = paths.join('|');
    if (key === this.key && info === this.info) return;
    this.key = key;
    this.paths = paths;
    this.info = info;
    this.name = name;
    this.invalidate();
  }

  get question(): string {
    const q = this.info?.question;
    return q ? clusterQuestion(q, this.name, this.info?.links ?? 0) : '';
  }

  protected paint(ctx: Ctx): void {
    const tr = t();
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 3, 3, W - 6, H - 6, 30);
    ctx.fillStyle = 'rgba(20,16,6,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const P = 34;
    const info = this.info;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#c9b27a';
    ctx.font = font(28, 600);
    const meta = [tr.wallGroup(this.paths.length)];
    if (info) {
      meta.push(info.links ? tr.wallLinks(info.links) : tr.wallNoLinks);
      if (info.hidden) meta.push(tr.wallHidden(info.hidden));
    }
    ctx.fillText(meta.join('  ·  '), P, P + 26);
    ctx.fillStyle = '#ffe8a8';
    ctx.font = font(42, 700);
    const kw = !info ? tr.wallThinking : info.keywords.length ? tr.wallShared + info.keywords.join(' · ') : tr.wallNoShared;
    ctx.fillText(fit(ctx, kw, W - P * 2), P, P + 82);
    let y = P + 134;
    ctx.fillStyle = '#f3f0e6';
    ctx.font = font(34, 500);
    for (const l of wrapClamped(ctx, this.question, W - P * 2, 3)) {
      ctx.fillText(l, P, y);
      y += 46;
    }
    // bottom row: the candidates (bring into the group) and "write an answer"
    const by = H - P - 64;
    ctx.font = font(30, 600);
    const answerLabel = '✎ ' + tr.answer;
    const aw = ctx.measureText(answerLabel).width + 56;
    const answer = { x: W - P - aw, y: by, w: aw, h: 64 };
    if (info) {
      drawButton(ctx, answer, answerLabel, 'gold', this.isHover('answer'), 30);
      this.hit({ ...answer, id: 'answer' });
    }
    let x = P;
    ctx.font = font(30, 600);
    for (const c of info?.candidates ?? []) {
      const label = '＋ ' + this.name(c.path);
      const w = Math.min(380, ctx.measureText(label).width + 44);
      if (x + w > answer.x - 14) break;
      const r = { x, y: by, w, h: 64 };
      drawButton(ctx, r, fit(ctx, label, w - 40), 'chip', this.isHover('add', c.path), 30);
      this.hit({ ...r, id: 'add', data: c.path });
      x += w + 12;
    }
  }
}

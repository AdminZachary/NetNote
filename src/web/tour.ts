/**
 * The first-run tour of the 2D workspace: a short walk through everything NetNote does, one step at
 * a time, each step pointing at the part of the page it is about (a soft spotlight), the last ones
 * showing what waits inside the headset. It runs once on a new device, and the "Tour" button in the
 * top bar plays it again.
 *
 * Ergonomics: a calm dimmed backdrop, one idea per step in plain words, Back / Next / Skip as 44 px
 * buttons, arrow keys and Esc, focus kept on the card, the spotlight follows the page if it scrolls or
 * resizes, and nothing slides about when the system asks for reduced motion.
 */
import { t } from '../app/i18n';

export interface TourStep {
  /** CSS selector of what this step is about (none: a card in the middle) */
  target?: string;
  title: string;
  body: string;
  /** small illustrated list: icon + line */
  items?: [string, string][];
}

const CSS = `
.nn-tour{position:fixed;inset:0;z-index:40;font:16px/1.6 "Inter","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;color:#e8f1ff}
.nn-tour-hole{position:fixed;border-radius:16px;box-shadow:0 0 0 9999px rgba(3,6,14,.72),0 0 0 2px rgba(94,231,255,.85),0 0 28px 6px rgba(94,231,255,.35);pointer-events:none}
.nn-tour-card{position:fixed;width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:20px 22px 18px;border-radius:18px;
  background:linear-gradient(180deg,rgba(14,22,44,.98),rgba(9,14,30,.98));border:1px solid rgba(94,231,255,.4);box-shadow:0 18px 60px rgba(0,0,0,.55)}
.nn-tour-step{font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;color:#5ee7ff;margin-bottom:6px}
.nn-tour-card h2{margin:0 0 6px;font-size:21px;line-height:1.3}
.nn-tour-card p{margin:0;color:#c9d6ec}
.nn-tour-items{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.nn-tour-items li{display:flex;gap:10px;align-items:flex-start;color:#dbe6f7;font-size:15px;line-height:1.45}
.nn-tour-items span{flex:none;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:rgba(94,231,255,.12);color:#5ee7ff;font-size:15px}
.nn-tour-dots{display:flex;gap:6px;margin:14px 0 0}
.nn-tour-dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.18)}
.nn-tour-dots i.nn-on{background:#5ee7ff}
.nn-tour-row{display:flex;gap:8px;align-items:center;margin-top:14px}
.nn-tour-row .nn-sp{flex:1}
.nn-tour .nn-btn{appearance:none;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid rgba(94,231,255,.32);background:rgba(94,231,255,.08);color:#e8f1ff;
  font:inherit;font-size:15px;font-weight:600;cursor:pointer}
.nn-tour .nn-btn:hover{background:rgba(94,231,255,.16)}
.nn-tour .nn-btn.nn-primary{background:linear-gradient(135deg,rgba(94,231,255,.32),rgba(177,140,255,.32));border-color:rgba(160,220,255,.75)}
.nn-tour .nn-btn.nn-ghost{border-color:transparent;background:none;color:#9fb3d1}
.nn-tour :focus-visible{outline:3px solid #5ee7ff;outline-offset:2px}
@media (prefers-reduced-motion:no-preference){.nn-tour-hole,.nn-tour-card{transition:all .28s cubic-bezier(.4,0,.2,1)}}
`;

export function tourSteps(): TourStep[] {
  const tr = t();
  return [
    { title: tr.tourWelcomeT, body: tr.tourWelcome },
    { target: '.nn-list', title: tr.tourListT, body: tr.tourList },
    { target: '[data-testid=ws-new]', title: tr.tourNewT, body: tr.tourNew },
    { target: '.nn-main', title: tr.tourWriteT, body: tr.tourWrite },
    { target: '.nn-side', title: tr.tourSideT, body: tr.tourSide },
    { target: '[data-testid=ws-graph]', title: tr.tourGraphT, body: tr.tourGraph },
    { target: '[data-testid=ws-library]', title: tr.tourLibraryT, body: tr.tourLibrary },
    { target: '[data-testid=enter-vr]', title: tr.tourHeadsetT, body: tr.tourHeadset, items: tr.tourHeadsetItems },
    { target: '[data-testid=enter-vr]', title: tr.tourHandsT, body: tr.tourHands, items: tr.tourHandsItems },
    { target: '[data-testid=ws-tour]', title: tr.tourDoneT, body: tr.tourDone },
  ];
}

export class Tour {
  readonly root: HTMLDivElement;
  private readonly hole: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private steps: TourStep[] = [];
  private i = 0;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.go(this.i + 1);
    else if (e.key === 'ArrowLeft') this.go(this.i - 1);
    else return;
    e.preventDefault();
  };
  private onMove = (): void => this.place();
  /** called once the tour closes (finished or skipped) */
  onClose: (() => void) | null = null;
  /** called before a step shows (e.g. to open a note so the writing area has something in it) */
  onStep: ((step: TourStep, index: number) => void) | null = null;

  constructor(private readonly doc: Document) {
    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);
    this.root = doc.createElement('div');
    this.root.className = 'nn-tour';
    this.root.setAttribute('data-testid', 'tour');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.hidden = true;
    this.hole = doc.createElement('div');
    this.hole.className = 'nn-tour-hole';
    this.card = doc.createElement('div');
    this.card.className = 'nn-tour-card';
    this.root.append(this.hole, this.card);
    doc.body.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  get index(): number {
    return this.i;
  }

  start(): void {
    this.steps = tourSteps();
    this.root.hidden = false;
    this.doc.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onMove);
    this.go(0);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.doc.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onMove);
    this.onClose?.();
  }

  go(i: number): void {
    if (i >= this.steps.length) return this.close();
    this.i = Math.max(0, i);
    const step = this.steps[this.i]!;
    this.onStep?.(step, this.i);
    this.render(step);
    requestAnimationFrame(() => this.place());
  }

  private render(step: TourStep): void {
    const tr = t();
    const c = this.card;
    c.replaceChildren();
    const n = this.doc.createElement('div');
    n.className = 'nn-tour-step';
    n.textContent = tr.tourStep(this.i + 1, this.steps.length);
    const h = this.doc.createElement('h2');
    h.id = 'nn-tour-title';
    h.textContent = step.title;
    this.root.setAttribute('aria-labelledby', h.id);
    const p = this.doc.createElement('p');
    p.textContent = step.body;
    c.append(n, h, p);
    if (step.items?.length) {
      const ul = this.doc.createElement('ul');
      ul.className = 'nn-tour-items';
      for (const [icon, line] of step.items) {
        const li = this.doc.createElement('li');
        const s = this.doc.createElement('span');
        s.textContent = icon;
        s.setAttribute('aria-hidden', 'true');
        li.append(s, this.doc.createTextNode(line));
        ul.append(li);
      }
      c.append(ul);
    }
    const dots = this.doc.createElement('div');
    dots.className = 'nn-tour-dots';
    dots.setAttribute('aria-hidden', 'true');
    this.steps.forEach((_, k) => {
      const d = this.doc.createElement('i');
      if (k === this.i) d.className = 'nn-on';
      dots.append(d);
    });
    const row = this.doc.createElement('div');
    row.className = 'nn-tour-row';
    const last = this.i === this.steps.length - 1;
    const btn = (label: string, cls: string, id: string, fn: () => void): HTMLButtonElement => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'nn-btn ' + cls;
      b.textContent = label;
      b.setAttribute('data-testid', id);
      b.addEventListener('click', fn);
      return b;
    };
    const skip = btn(tr.tourSkip, 'nn-ghost', 'tour-skip', () => this.close());
    const sp = this.doc.createElement('span');
    sp.className = 'nn-sp';
    row.append(skip, sp);
    if (this.i > 0) row.append(btn(tr.tourBack, '', 'tour-back', () => this.go(this.i - 1)));
    const next = btn(last ? tr.tourFinish : tr.tourNext, 'nn-primary', 'tour-next', () => this.go(this.i + 1));
    row.append(next);
    if (last) skip.hidden = true;
    c.append(dots, row);
    next.focus({ preventScroll: true });
  }

  /** Spotlight the step's target and put the card beside it, inside the window. */
  private place(): void {
    if (this.root.hidden) return;
    const step = this.steps[this.i];
    const el = step?.target ? (this.doc.querySelector(step.target) as HTMLElement | null) : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const card = this.card.getBoundingClientRect();
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    if (!r || r.width === 0) {
      Object.assign(this.hole.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
      Object.assign(this.card.style, { left: Math.max(16, (vw - card.width) / 2) + 'px', top: Math.max(16, (vh - card.height) / 2) + 'px' });
      return;
    }
    const pad = 6;
    Object.assign(this.hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    // beside the target where there is room: right, left, below, above, else inside its bottom
    const gap = 18;
    let x: number;
    let y: number;
    if (r.right + gap + card.width <= vw - 16) [x, y] = [r.right + gap, r.top];
    else if (r.left - gap - card.width >= 16) [x, y] = [r.left - gap - card.width, r.top];
    else if (r.bottom + gap + card.height <= vh - 16) [x, y] = [r.left + r.width / 2 - card.width / 2, r.bottom + gap];
    else if (r.top - gap - card.height >= 16) [x, y] = [r.left + r.width / 2 - card.width / 2, r.top - gap - card.height];
    else [x, y] = [r.left + r.width / 2 - card.width / 2, r.bottom - card.height - 24];
    x = Math.max(16, Math.min(vw - card.width - 16, x));
    y = Math.max(16, Math.min(vh - card.height - 16, y));
    Object.assign(this.card.style, { left: x + 'px', top: y + 'px' });
  }
}

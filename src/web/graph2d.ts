/**
 * The flat graph map of the 2D workspace: every note a dot, every link a line, coloured by topic,
 * laid out by the same forces as the room but in two dimensions. It answers "what is near what?" at
 * a glance and leads straight back to writing.
 *
 *   - drag to move around, scroll or pinch to zoom (or the + / − / fit buttons, 44 px targets);
 *   - point at a note to see it and its neighbours lit, with names;
 *   - click a note to select it (a card shows what it is and how it connects); "Open" or a double
 *     click opens it for writing.
 * Names are shown for hubs, for what you point at and its neighbours, and for everything once you
 * zoom in far enough to read them, so the map never turns into a wall of text.
 */
import { t } from '../app/i18n';
import type { Library } from '../app/library';
import { layoutGraph, nodeRadius, type LayoutNode } from '../core/layout/force';
import type { Graph } from '../core/vault/vault';

const TOPIC_COLORS = ['#5ee7ff', '#ffb86b', '#b18cff', '#7ef0b2', '#ff7aa8', '#ffe066', '#6ea8ff', '#ff9e7a', '#9be37a', '#e0a3ff'];
const NO_TOPIC = '#8ea0c0';
const FONT = '"Inter","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

interface Dot {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  color: string;
  ghost: boolean;
  degree: number;
}

export const GRAPH2D_CSS = `
.nn-g2{position:relative;min-height:0;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,#0d1836 0%,#070c1a 70%)}
.nn-g2 canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}
.nn-g2 canvas.nn-drag{cursor:grabbing}
.nn-g2-ctl{position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px}
.nn-g2-ctl .nn-btn{width:48px;min-height:48px;padding:0;font-size:20px}
.nn-g2-card{position:absolute;left:16px;bottom:16px;max-width:min(380px,calc(100% - 100px));padding:14px 16px;border-radius:16px;background:rgba(9,15,32,.92);
  border:1px solid rgba(94,231,255,.35);box-shadow:0 14px 40px rgba(0,0,0,.45)}
.nn-g2-card b{display:block;font-size:18px;margin-bottom:2px}
.nn-g2-card small{display:block;color:#8ea3c4;font-size:14px;margin-bottom:10px}
.nn-g2-card .nn-row{display:flex;gap:8px;flex-wrap:wrap}
.nn-g2-help{position:absolute;left:16px;top:12px;color:#7f93b3;font-size:13.5px}
`;

export class Graph2D {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly card: HTMLDivElement;
  private dots: Dot[] = [];
  private index = new Map<string, Dot>();
  private links: [Dot, Dot][] = [];
  private neighbours = new Map<string, Set<string>>();
  private version = -1;
  private view = { x: 0, y: 0, k: 1 };
  private fitted = false;
  private hover: Dot | null = null;
  selected: string | null = null;
  /** the note being written in the workspace (marked with a ring) */
  focus: string | null = null;
  /** dim notes that do not match (the workspace search) */
  matches: Set<string> | null = null;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  private pinch: { d: number; k: number } | null = null;
  private lastClick = { id: '', at: 0 };
  onOpen: ((path: string) => void) | null = null;

  constructor(private readonly library: Library) {
    this.root = document.createElement('div');
    this.root.className = 'nn-g2';
    this.root.setAttribute('data-testid', 'graph2d');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.ctx = this.canvas.getContext('2d')!;
    this.card = document.createElement('div');
    this.card.className = 'nn-g2-card';
    this.card.hidden = true;
    const ctl = document.createElement('div');
    ctl.className = 'nn-g2-ctl';
    const btn = (label: string, aria: string, fn: () => void, id: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nn-btn';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.setAttribute('data-testid', id);
      b.addEventListener('click', fn);
      return b;
    };
    ctl.append(
      btn('+', 'zoom in', () => this.zoomBy(1.35), 'g2-in'),
      btn('−', 'zoom out', () => this.zoomBy(1 / 1.35), 'g2-out'),
      btn('⤢', 'fit', () => this.fit(), 'g2-fit'),
    );
    const help = document.createElement('div');
    help.className = 'nn-g2-help';
    this.help = help;
    this.root.append(this.canvas, help, ctl, this.card);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.root);
  }

  private help: HTMLDivElement;

  /** Rebuild from the library if it changed (cheap when it did not). */
  refresh(): void {
    const vault = this.library.vault;
    this.help.textContent = t().g2Help;
    if (!vault) return;
    if (vault.version === this.version) return this.invalidate();
    this.version = vault.version;
    const g: Graph = vault.graph();
    let topicOf: Map<string, number> | undefined;
    try {
      topicOf = this.library.insights().topicOf;
    } catch {
      topicOf = undefined;
    }
    const nodes: LayoutNode[] = g.nodes.filter((n) => !n.file).map((n) => ({ id: n.id, degree: 0, topic: topicOf?.get(n.id), ghost: n.ghost }));
    const deg = new Map<string, number>();
    for (const l of g.links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    for (const n of nodes) n.degree = deg.get(n.id) ?? 0;
    const prev = new Map(this.dots.map((d) => [d.id, { x: d.x, y: d.y, z: 0 }]));
    const pos = layoutGraph(nodes, g.links, { dims: 2, previous: prev.size ? prev : undefined });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    this.dots = nodes.map((n) => {
      const p = pos.get(n.id)!;
      const t = n.topic;
      return {
        id: n.id,
        name: byId.get(n.id)?.name ?? n.id,
        x: p.x,
        y: p.y,
        r: nodeRadius(n),
        color: n.ghost ? '#3a4152' : t === undefined ? NO_TOPIC : TOPIC_COLORS[t % TOPIC_COLORS.length]!,
        ghost: !!n.ghost,
        degree: n.degree,
      };
    });
    this.index = new Map(this.dots.map((d) => [d.id, d]));
    this.neighbours = new Map();
    this.links = [];
    for (const l of g.links) {
      const a = this.index.get(l.source);
      const b = this.index.get(l.target);
      if (!a || !b || a === b) continue;
      this.links.push([a, b]);
      if (!this.neighbours.has(a.id)) this.neighbours.set(a.id, new Set());
      if (!this.neighbours.has(b.id)) this.neighbours.set(b.id, new Set());
      this.neighbours.get(a.id)!.add(b.id);
      this.neighbours.get(b.id)!.add(a.id);
    }
    if (this.selected && !this.index.has(this.selected)) this.select(null);
    if (!this.fitted) this.fit();
    this.invalidate();
  }

  /** Centre the map on a note (keeping the zoom). */
  centreOn(id: string): void {
    const d = this.index.get(id);
    if (!d) return;
    this.view.x = d.x;
    this.view.y = d.y;
    this.invalidate();
  }

  fit(): void {
    const w = this.root.clientWidth || 800;
    const h = this.root.clientHeight || 600;
    if (!this.dots.length) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const d of this.dots) {
      x0 = Math.min(x0, d.x);
      x1 = Math.max(x1, d.x);
      y0 = Math.min(y0, d.y);
      y1 = Math.max(y1, d.y);
    }
    this.view.x = (x0 + x1) / 2;
    this.view.y = (y0 + y1) / 2;
    this.view.k = Math.min((w - 120) / Math.max(1, x1 - x0), (h - 120) / Math.max(1, y1 - y0), 4);
    this.fitted = true;
    this.invalidate();
  }

  /** Screen position of a note (for tests). */
  screenOf(id: string): { x: number; y: number } | null {
    const d = this.index.get(id);
    return d ? this.toScreen(d.x, d.y) : null;
  }

  private zoomBy(f: number, at?: { x: number; y: number }): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const p = at ?? { x: w / 2, y: h / 2 };
    const before = this.toWorld(p.x, p.y);
    this.view.k = Math.max(0.05, Math.min(12, this.view.k * f));
    const after = this.toWorld(p.x, p.y);
    this.view.x += before.x - after.x;
    this.view.y += before.y - after.y;
    this.invalidate();
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.view.x) * this.view.k + this.root.clientWidth / 2, y: (y - this.view.y) * this.view.k + this.root.clientHeight / 2 };
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.root.clientWidth / 2) / this.view.k + this.view.x, y: (sy - this.root.clientHeight / 2) / this.view.k + this.view.y };
  }

  /** The note under a screen point (generous: at least a 22 px radius, a 44 px target). */
  private dotAt(sx: number, sy: number): Dot | null {
    let best: Dot | null = null;
    let bestD = Infinity;
    for (const d of this.dots) {
      const p = this.toScreen(d.x, d.y);
      const dist = Math.hypot(p.x - sx, p.y - sy);
      const reach = Math.max(22, d.r * this.view.k + 6);
      if (dist < reach && dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best;
  }

  private bind(): void {
    const c = this.canvas;
    const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: this.view.k };
        this.drag = null;
      } else this.drag = { x: p.x, y: p.y, vx: this.view.x, vy: this.view.y, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        this.zoomBy((this.pinch.k * (d / Math.max(1, this.pinch.d))) / this.view.k, mid);
        return;
      }
      const dr = this.drag;
      if (dr) {
        const dx = p.x - dr.x;
        const dy = p.y - dr.y;
        if (Math.hypot(dx, dy) > 5) {
          dr.moved = true;
          c.classList.add('nn-drag');
        }
        if (dr.moved) {
          this.view.x = dr.vx - dx / this.view.k;
          this.view.y = dr.vy - dy / this.view.k;
          this.invalidate();
        }
        return;
      }
      const h = this.dotAt(p.x, p.y);
      if (h !== this.hover) {
        this.hover = h;
        c.style.cursor = h ? 'pointer' : '';
        this.invalidate();
      }
    });
    const up = (e: PointerEvent): void => {
      const p = local(e);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const dr = this.drag;
      this.drag = null;
      c.classList.remove('nn-drag');
      if (!dr || dr.moved || e.type === 'pointercancel') return;
      const d = this.dotAt(p.x, p.y);
      const now = performance.now();
      if (d && this.lastClick.id === d.id && now - this.lastClick.at < 450) {
        this.onOpen?.(d.id);
        return;
      }
      this.lastClick = { id: d?.id ?? '', at: now };
      this.select(d?.id ?? null);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      if (this.hover) {
        this.hover = null;
        this.invalidate();
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), local(e));
      },
      { passive: false },
    );
  }

  /** Select a note (or nothing): it and its neighbours light up, and its card shows. */
  select(id: string | null): void {
    this.selected = id;
    this.card.replaceChildren();
    const vault = this.library.vault;
    const note = id ? vault?.notes.get(id) : undefined;
    const d = id ? this.index.get(id) : undefined;
    this.card.hidden = !d;
    if (d) {
      const tr = t();
      const b = document.createElement('b');
      b.textContent = d.name;
      const s = document.createElement('small');
      const n = this.neighbours.get(d.id)?.size ?? 0;
      s.textContent = note ? tr.g2Links(n) : tr.wsUnwritten;
      const row = document.createElement('div');
      row.className = 'nn-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'nn-btn nn-primary';
      open.textContent = note ? tr.g2Open : tr.wsCreate;
      open.setAttribute('data-testid', 'g2-open');
      open.addEventListener('click', () => this.onOpen?.(d.id));
      row.append(open);
      this.card.append(b, s, row);
    }
    this.invalidate();
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.fitted) this.fit();
    this.invalidate();
  }

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this.dots.length) return;
    const k = this.view.k;
    const lit = this.selected ?? this.hover?.id ?? null;
    const near = lit ? (this.neighbours.get(lit) ?? new Set<string>()) : null;
    const isLit = (id: string): boolean => !lit || id === lit || !!near?.has(id);
    const dim = (id: string): boolean => (this.matches ? !this.matches.has(id) : false) || !isLit(id);
    // links
    for (const [a, b] of this.links) {
      const on = lit && (a.id === lit || b.id === lit);
      const pa = this.toScreen(a.x, a.y);
      const pb = this.toScreen(b.x, b.y);
      ctx.strokeStyle = on ? 'rgba(94,231,255,0.85)' : lit ? 'rgba(150,170,210,0.06)' : 'rgba(150,170,210,0.22)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    // dots
    for (const d of this.dots) {
      const p = this.toScreen(d.x, d.y);
      if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const r = Math.max(3, d.r * k * 0.9);
      ctx.globalAlpha = dim(d.id) ? 0.22 : 1;
      if (!dim(d.id) && !d.ghost) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        g.addColorStop(0, d.color + '55');
        g.addColorStop(1, d.color + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (d.id === this.focus || d.id === this.selected) {
        ctx.strokeStyle = d.id === this.selected ? '#ffffff' : '#ffd166';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // names: hubs, what is lit, the note being written, or everything when zoomed in
    const hubCut = [...this.dots].sort((a, b) => b.degree - a.degree)[Math.min(this.dots.length - 1, 7)]?.degree ?? 0;
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const d of this.dots) {
      const show = k > 2.2 || d.id === lit || d.id === this.focus || (near?.has(d.id) ?? false) || (!lit && d.degree >= hubCut && d.degree > 1);
      if (!show || dim(d.id)) continue;
      const p = this.toScreen(d.x, d.y);
      if (p.x < -60 || p.y < -30 || p.x > w + 60 || p.y > h + 30) continue;
      const r = Math.max(3, d.r * k * 0.9);
      const label = d.name.length > 26 ? d.name.slice(0, 25) + '…' : d.name;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(7,12,26,0.9)';
      ctx.strokeText(label, p.x, p.y + r + 6);
      ctx.fillStyle = d.ghost ? '#8ea0c0' : '#e8f1ff';
      ctx.fillText(label, p.x, p.y + r + 6);
    }
  }
}

/**
 * A flat panel in the world drawn with the 2D canvas API (so any font, including CJK, renders crisply)
 * and made interactive through IWSDK pointer events (ray, pinch, poke and mouse alike).
 *
 * Subclasses implement `paint()` and register hit regions with `hit()`. Hover, press and scroll are
 * handled here, so every panel behaves the same.
 */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D } from '@iwsdk/core';
import { inRect, type Ctx, type Rect } from './draw';

/** Minimal shape of the pointer events we use (from @pmndrs/pointer-events). */
export interface XRPointerEvent {
  pointerId: number;
  pointerType: string;
  uv?: { x: number; y: number };
  point: { x: number; y: number; z: number };
  object: Object3D;
  instanceId?: number;
  pointerPosition: { x: number; y: number; z: number };
  pointerQuaternion: { x: number; y: number; z: number; w: number };
  stopPropagation(): void;
  nativeEvent?: { deltaY?: number };
  deltaY?: number;
}

export interface HitRegion extends Rect {
  id: string;
  /** Extra data passed to the action handler (e.g. the note path of a list row). */
  data?: string;
  /** Regions marked as a scroll area accept drag-to-scroll. */
  scroll?: boolean;
}

export type ActionHandler = (id: string, data: string | undefined, surface: Surface) => void;

export abstract class Surface {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly canvas: HTMLCanvasElement;
  protected readonly ctx: Ctx;
  protected readonly texture: CanvasTexture;
  protected hits: HitRegion[] = [];
  protected hover: string | null = null;
  protected scrollY = 0;
  protected maxScroll = 0;
  private dirty = true;
  private drag: { pointerId: number; startY: number; startScroll: number; moved: boolean } | null = null;
  onAction: ActionHandler | null = null;
  /** Called when a finger (or ray) presses a button on any panel: for a click sound and a tick. */
  static onPress: ((surface: Surface, kind: 'touch' | 'ray', at: { x: number; y: number; z: number }) => void) | null = null;
  /**
   * Hand presses are ignored until this time: set while you type, so fingers tapping on a surface
   * keyboard on your desk cannot press panels or stars by accident.
   */
  static quietUntil = 0;
  /** pointers that went down on this panel, with where (canvas px) they went down */
  private downs = new Map<number, { x: number; y: number; touch: boolean }>();
  /** the region being pressed, drawn lit until the press ends */
  private pressed: HitRegion | null = null;
  /** Canvas position of the latest click, so a handler can tell where inside a region it landed. */
  lastPoint: { x: number; y: number } | null = null;

  constructor(
    readonly widthM: number,
    readonly pxW: number,
    readonly pxH: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8; // panels are often seen at an angle: keep their text sharp
    const heightM = (widthM * pxH) / pxW;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: true, alphaTest: 0.02, toneMapped: false }),
    );
    this.mesh.renderOrder = 10;
    this.mesh.userData.surface = this;
    this.bindPointer();
  }

  get heightM(): number {
    return (this.widthM * this.pxH) / this.pxW;
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Call once per frame; repaints only when something changed. */
  update(): void {
    if (!this.dirty || !this.mesh.visible) return;
    this.dirty = false;
    this.hits = [];
    this.paint(this.ctx);
    const pr = this.pressed;
    if (pr) {
      const c = this.ctx;
      c.save();
      c.fillStyle = 'rgba(94, 231, 255, 0.22)';
      c.strokeStyle = 'rgba(160, 245, 255, 0.95)';
      c.lineWidth = 4;
      c.beginPath();
      c.roundRect(pr.x, pr.y, pr.w, pr.h, Math.min(24, pr.h / 2));
      c.fill();
      c.stroke();
      c.restore();
    }
    this.texture.needsUpdate = true;
  }

  /** Force a repaint now (tests, screenshots). */
  repaint(): void {
    this.dirty = true;
    this.update();
  }

  protected abstract paint(ctx: Ctx): void;

  protected hit(region: HitRegion): void {
    this.hits.push(region);
  }

  protected isHover(id: string, data?: string): boolean {
    return this.hover === (data === undefined ? id : id + '\u0000' + data);
  }

  hitAt(px: number, py: number): HitRegion | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (!h.scroll && inRect(h, px, py)) return h;
    }
    return null;
  }

  /** Simulate a click at canvas pixel coordinates (used by tests and keyboard shortcuts). */
  clickAt(px: number, py: number): boolean {
    this.lastPoint = { x: px, y: py };
    const h = this.hitAt(px, py);
    if (h) this.onAction?.(h.id, h.data, this);
    return !!h;
  }

  /** The canvas position of a region, for tests. */
  regionCenter(id: string, data?: string): { x: number; y: number } | null {
    const h = this.hits.find((r) => r.id === id && (data === undefined || r.data === data));
    return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null;
  }

  protected scrollBy(dy: number): void {
    const next = Math.max(0, Math.min(this.maxScroll, this.scrollY + dy));
    if (next !== this.scrollY) {
      this.scrollY = next;
      this.invalidate();
    }
  }

  /** Is this an XR press arriving while you are typing? (Mouse clicks always pass.) */
  static quiet(e: XRPointerEvent): boolean {
    return performance.now() < Surface.quietUntil && !/mouse|pen|screen/i.test(e.pointerType);
  }

  private toPx(e: XRPointerEvent): { x: number; y: number } | null {
    if (e.uv) return { x: e.uv.x * this.pxW, y: (1 - e.uv.y) * this.pxH };
    // a fingertip (touch) hit has no uv: use the point on the panel nearest the finger
    if (!e.point) return null;
    const l = this.mesh.worldToLocal(new Vector3(e.point.x, e.point.y, e.point.z));
    const x = (l.x / this.widthM + 0.5) * this.pxW;
    const y = (0.5 - l.y / this.heightM) * this.pxH;
    return x >= 0 && x <= this.pxW && y >= 0 && y <= this.pxH ? { x, y } : null;
  }

  private bindPointer(): void {
    const m = this.mesh as unknown as {
      addEventListener(type: string, fn: (e: XRPointerEvent) => void): void;
    };
    m.addEventListener('pointermove', (e) => {
      const p = this.toPx(e);
      if (!p) return;
      if (this.drag && this.drag.pointerId === e.pointerId) {
        const dy = this.drag.startY - p.y;
        if (Math.abs(dy) > 12) this.drag.moved = true;
        if (this.drag.moved) {
          this.scrollY = Math.max(0, Math.min(this.maxScroll, this.drag.startScroll + dy));
          this.invalidate();
        }
        return;
      }
      const h = this.hitAt(p.x, p.y);
      const key = h ? (h.data === undefined ? h.id : h.id + '\u0000' + h.data) : null;
      if (key !== this.hover) {
        this.hover = key;
        this.invalidate();
      }
    });
    m.addEventListener('pointerleave', (e) => {
      if (this.downs.get(e.pointerId)?.touch === false) {
        this.downs.delete(e.pointerId);
        this.pressed = null;
        this.invalidate();
      }
      if (this.hover !== null) {
        this.hover = null;
        this.invalidate();
      }
    });
    m.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = this.toPx(e);
      if (!p) return;
      const touch = isTouch(e);
      if (Surface.quiet(e)) return;
      this.downs.set(e.pointerId, { ...p, touch });
      const h = this.hitAt(p.x, p.y);
      if (h) {
        this.pressed = h;
        this.invalidate();
        Surface.onPress?.(this, touch ? 'touch' : 'ray', e.point);
      }
      const inScroll = this.hits.some((h) => h.scroll && inRect(h, p.x, p.y));
      if (inScroll && this.maxScroll > 0) {
        this.drag = { pointerId: e.pointerId, startY: p.y, startScroll: this.scrollY, moved: false };
        this.mesh.setPointerCapture(e.pointerId);
      }
    });
    m.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      const down = this.downs.get(e.pointerId);
      this.downs.delete(e.pointerId);
      if (this.pressed) {
        this.pressed = null;
        this.invalidate();
      }
      // a fingertip lifts off wherever it drifted: the press counts where it touched down
      const p = down?.touch ? down : this.toPx(e);
      const wasDrag = this.drag?.moved;
      if (this.drag) this.mesh.releasePointerCapture(this.drag.pointerId);
      this.drag = null;
      // only a press that started on this panel clicks (a finger arriving from behind does not)
      if (wasDrag || !p || !down) return;
      this.lastPoint = p;
      const h = this.hitAt(p.x, p.y);
      if (h) this.onAction?.(h.id, h.data, this);
    });
    m.addEventListener('wheel', (e) => {
      const dy = e.deltaY ?? e.nativeEvent?.deltaY ?? 0;
      if (dy) this.scrollBy(dy);
      e.stopPropagation();
    });
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

function isTouch(e: XRPointerEvent): boolean {
  return e.pointerType === 'touch' || !e.uv;
}

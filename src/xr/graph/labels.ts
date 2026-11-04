/** Text labels as camera-facing sprites drawn on canvases (CJK-safe), cached per text + style. */
import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from '@iwsdk/core';
import { fit, font, roundRect } from '../ui/draw';

export interface LabelStyle {
  px: number;
  weight: number;
  color: string;
  /** background pill colour, or null */
  pill: string | null;
  maxWidth: number;
}

export const NODE_LABEL: LabelStyle = { px: 44, weight: 500, color: '#e8f1ff', pill: 'rgba(5,8,18,0.55)', maxWidth: 560 };
export const FOCUS_LABEL: LabelStyle = { px: 52, weight: 700, color: '#ffffff', pill: 'rgba(5,8,18,0.72)', maxWidth: 680 };
export const TOPIC_LABEL: LabelStyle = { px: 64, weight: 700, color: '#ffffff', pill: null, maxWidth: 900 };

/**
 * A label sprite whose world height stays `heightM` metres regardless of parent scale; aspect follows
 * the text. `sizeAttenuation` is on so labels shrink with distance like real signs.
 */
export class Label {
  readonly sprite: Sprite;
  private canvas = document.createElement('canvas');
  private texture: CanvasTexture;
  private aspect = 1;
  private key = '';

  constructor() {
    this.texture = this.makeTexture();
    const mat = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
    this.sprite = new Sprite(mat);
    this.sprite.renderOrder = 5;
    this.sprite.raycast = () => undefined; // labels never take a pinch (and sprites need a camera to raycast)
    this.sprite.center.set(0.5, 0);
  }

  set(text: string, style: LabelStyle, color = style.color): void {
    const key = text + '\u0000' + style.px + style.weight + color + style.pill;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d')!;
    ctx.font = font(style.px, style.weight);
    const shown = fit(ctx, text, style.maxWidth);
    const padX = style.pill ? style.px * 0.45 : 6;
    const w = Math.ceil(ctx.measureText(shown).width + padX * 2);
    const h = Math.ceil(style.px * 1.45);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      // a texture's GPU storage has a fixed size: a resized canvas needs a new texture
      this.canvas.width = w;
      this.canvas.height = h;
      this.texture.dispose();
      this.texture = this.makeTexture();
      (this.sprite.material as SpriteMaterial).map = this.texture;
    }
    ctx.font = font(style.px, style.weight);
    ctx.textBaseline = 'middle';
    if (style.pill) {
      roundRect(ctx, 0, 0, w, h, h / 2);
      ctx.fillStyle = style.pill;
      ctx.fill();
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = style.px * 0.25;
    }
    ctx.fillStyle = color;
    ctx.fillText(shown, padX, h / 2 + 1);
    this.aspect = w / h;
    this.texture.needsUpdate = true;
  }

  private makeTexture(): CanvasTexture {
    const t = new CanvasTexture(this.canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  }

  /** World-space height in metres, compensating for the parent's scale. */
  setHeight(heightM: number, parentScale: number): void {
    const h = heightM / parentScale;
    this.sprite.scale.set(h * this.aspect, h, 1);
  }

  get aspectRatio(): number {
    return this.aspect;
  }

  set opacity(v: number) {
    (this.sprite.material as SpriteMaterial).opacity = v;
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
    this.sprite.removeFromParent();
  }
}

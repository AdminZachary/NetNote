/**
 * A thin curved thread from each open card back to its star in the graph, so you always know where
 * what you are reading lives (and the graph stays meaningful while you read). Cyan for the card you
 * are reading, violet for pinned ones; strongest at the card, fading towards the star.
 * Static lines (they only follow the card and the graph), so they add context without motion.
 */
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Vector3 } from '@iwsdk/core';

export const TETHER_SEG = 24;
const MAX = 12;

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Cubic bezier from p0 to p3 leaving p0 along `out` and arriving at p3 from above. */
export function tetherCurve(p0: P3, out: P3, p3: P3, n = TETHER_SEG): P3[] {
  const d = Math.hypot(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z);
  const k = Math.min(0.35, d * 0.35);
  const c1 = { x: p0.x + out.x * k, y: p0.y + out.y * k, z: p0.z + out.z * k };
  const c2 = { x: p3.x + (p0.x - p3.x) * 0.25, y: p3.y + Math.min(0.25, d * 0.2), z: p3.z + (p0.z - p3.z) * 0.25 };
  const pts: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const e = t ** 3;
    pts.push({
      x: a * p0.x + b * c1.x + c * c2.x + e * p3.x,
      y: a * p0.y + b * c1.y + c * c2.y + e * p3.y,
      z: a * p0.z + b * c1.z + c * c2.z + e * p3.z,
    });
  }
  return pts;
}

export interface TetherSpec {
  from: Vector3;
  /** direction the thread leaves the card (its left edge, outward) */
  out: Vector3;
  to: Vector3;
  color: string;
  opacity: number;
}

export class Tethers {
  readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>;

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX * TETHER_SEG * 2 * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(MAX * TETHER_SEG * 2 * 4), 4));
    this.lines = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.lines.name = 'tethers';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    this.lines.raycast = () => undefined;
  }

  set(specs: readonly TetherSpec[]): void {
    const pos = this.lines.geometry.getAttribute('position') as BufferAttribute;
    const col = this.lines.geometry.getAttribute('color') as BufferAttribute;
    const c = new Color();
    let v = 0;
    for (const s of specs.slice(0, MAX)) {
      if (s.opacity < 0.01) continue;
      const pts = tetherCurve(s.from, s.out, s.to);
      c.set(s.color);
      for (let i = 0; i < pts.length - 1; i++) {
        for (const j of [i, i + 1]) {
          const p = pts[j]!;
          pos.setXYZ(v, p.x, p.y, p.z);
          col.setXYZW(v, c.r, c.g, c.b, s.opacity * (0.75 - 0.6 * (j / TETHER_SEG)));
          v++;
        }
      }
    }
    this.lines.geometry.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.lines.visible = v > 0;
  }
}

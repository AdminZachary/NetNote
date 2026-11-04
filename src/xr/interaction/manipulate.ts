/**
 * Moving the whole room with your hands:
 *   - pinch empty space with one hand and move it: the graph follows the hand (translation only, so it
 *     never tilts on you), and keeps a little momentum when you let go;
 *   - pinch with both hands: pull apart / push together to zoom, turn them around each other to rotate
 *     about the vertical axis; the point between your hands stays under your hands;
 *   - with a mouse (desktop preview): drag to orbit, wheel to zoom.
 * The maths is in pure functions below so it is unit-tested without a headset.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface TwoHand {
  scale: number;
  yaw: number;
  /** midpoint of the hands now */
  pivot: V3;
  /** how far the midpoint moved since the start */
  shift: V3;
}

/** Relative transform implied by two hands moving from (a0, b0) to (a1, b1). */
export function twoHandDelta(a0: V3, b0: V3, a1: V3, b1: V3): TwoHand {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y, b0.z - a0.z) || 1e-6;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y, b1.z - a1.z) || 1e-6;
  const yaw0 = Math.atan2(b0.x - a0.x, b0.z - a0.z);
  const yaw1 = Math.atan2(b1.x - a1.x, b1.z - a1.z);
  let yaw = yaw1 - yaw0;
  if (yaw > Math.PI) yaw -= Math.PI * 2;
  if (yaw < -Math.PI) yaw += Math.PI * 2;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2, z: (a0.z + b0.z) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2, z: (a1.z + b1.z) / 2 };
  return { scale: d1 / d0, yaw, pivot: m1, shift: { x: m1.x - m0.x, y: m1.y - m0.y, z: m1.z - m0.z } };
}

export function clampScale(s: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, s));
}

interface Grip {
  start: Vector3;
  last: Vector3;
}

interface Snapshot {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
}

const Y = new Vector3(0, 1, 0);

/**
 * Applies hand motion to a target object (the graph root). Feed it pointer poses; call `update(dt)`
 * every frame for momentum.
 */
export class RoomManipulator {
  private grips = new Map<number, Grip>();
  private base: Snapshot | null = null;
  private two: { a: number; b: number; a0: Vector3; b0: Vector3 } | null = null;
  private velocity = new Vector3();
  private lastMove = 0;
  minScale = 0.0005;
  maxScale = 0.05;
  /** called once a drag moved enough to count as a manipulation (onboarding listens) */
  onManipulate: ((kind: 'move' | 'zoom') => void) | null = null;
  private reported = new Set<string>();

  constructor(private target: Object3D) {}

  get active(): boolean {
    return this.grips.size > 0;
  }

  begin(pointerId: number, pos: V3): void {
    const p = new Vector3(pos.x, pos.y, pos.z);
    this.grips.set(pointerId, { start: p.clone(), last: p.clone() });
    this.velocity.set(0, 0, 0);
    this.snapshot();
    if (this.grips.size === 2) {
      const [a, b] = [...this.grips.keys()] as [number, number];
      this.two = { a, b, a0: this.grips.get(a)!.last.clone(), b0: this.grips.get(b)!.last.clone() };
    }
  }

  move(pointerId: number, pos: V3, now = performance.now()): void {
    const g = this.grips.get(pointerId);
    if (!g) return;
    const p = new Vector3(pos.x, pos.y, pos.z);
    if (this.two && this.base) {
      g.last.copy(p);
      const ga = this.grips.get(this.two.a);
      const gb = this.grips.get(this.two.b);
      if (!ga || !gb) return;
      const d = twoHandDelta(this.two.a0, this.two.b0, ga.last, gb.last);
      const scale = clampScale(this.base.scale * d.scale, this.minScale, this.maxScale);
      const k = scale / this.base.scale;
      const rot = new Quaternion().setFromAxisAngle(Y, d.yaw);
      // pivot about the start midpoint, then follow the midpoint
      const m0 = new Vector3().addVectors(this.two.a0, this.two.b0).multiplyScalar(0.5);
      const offset = this.base.position.clone().sub(m0).applyQuaternion(rot).multiplyScalar(k);
      this.target.position
        .copy(m0)
        .add(offset)
        .add(new Vector3(d.shift.x, d.shift.y, d.shift.z));
      this.target.quaternion.copy(rot).multiply(this.base.quaternion);
      this.target.scale.setScalar(scale);
      if (Math.abs(d.scale - 1) > 0.05) this.report('zoom');
      return;
    }
    const delta = p.clone().sub(g.last);
    g.last.copy(p);
    this.target.position.add(delta);
    const dt = Math.max(1, now - this.lastMove) / 1000;
    this.lastMove = now;
    this.velocity.lerp(delta.clone().divideScalar(dt), 0.5);
    if (g.start.distanceTo(p) > 0.05) this.report('move');
  }

  end(pointerId: number): void {
    if (!this.grips.delete(pointerId)) return;
    this.two = null;
    if (this.grips.size === 1) {
      // continue with the remaining hand from where it is now
      this.snapshot();
      this.velocity.set(0, 0, 0);
    }
    if (performance.now() - this.lastMove > 80) this.velocity.set(0, 0, 0);
  }

  cancel(): void {
    this.grips.clear();
    this.two = null;
    this.velocity.set(0, 0, 0);
  }

  /** Momentum after letting go; stops in about half a second. */
  update(dt: number): void {
    if (this.grips.size || this.velocity.lengthSq() < 1e-6) return;
    this.target.position.addScaledVector(this.velocity, dt);
    this.velocity.multiplyScalar(Math.exp(-dt * 6));
  }

  /** Orbit about a pivot (mouse drag on desktop). */
  orbit(pivot: Vector3, dYaw: number, dPitch: number, right: Vector3): void {
    const q = new Quaternion().setFromAxisAngle(Y, dYaw).multiply(new Quaternion().setFromAxisAngle(right, dPitch));
    this.target.position.sub(pivot).applyQuaternion(q).add(pivot);
    this.target.quaternion.premultiply(q);
  }

  /** Zoom about a pivot (mouse wheel). */
  zoom(pivot: Vector3, factor: number): void {
    const s = clampScale(this.target.scale.x * factor, this.minScale, this.maxScale);
    const k = s / this.target.scale.x;
    this.target.position.sub(pivot).multiplyScalar(k).add(pivot);
    this.target.scale.setScalar(s);
  }

  private snapshot(): void {
    this.base = { position: this.target.position.clone(), quaternion: this.target.quaternion.clone(), scale: this.target.scale.x };
    for (const g of this.grips.values()) g.start.copy(g.last);
    if (this.two) {
      this.two.a0.copy(this.grips.get(this.two.a)?.last ?? this.two.a0);
      this.two.b0.copy(this.grips.get(this.two.b)?.last ?? this.two.b0);
    }
  }

  private report(kind: 'move' | 'zoom'): void {
    if (this.reported.has(kind)) return;
    this.reported.add(kind);
    this.onManipulate?.(kind);
  }
}

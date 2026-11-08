/**
 * Reading the open hand: where the palm is, which way it faces, and a calm "palm up" gesture with
 * hysteresis, so the map in your hand appears when you turn your palm towards you and goes away
 * when you turn it back, without flickering at the edge.
 */
import { Vector3 } from '@iwsdk/core';

export interface PalmPose {
  /** middle of the palm */
  centre: Vector3;
  /** unit vector out of the palm (the side you would hold something on) */
  normal: Vector3;
}

/**
 * From four joints (WebXR hand joint names in brackets): wrist, index-finger-metacarpal,
 * pinky-finger-metacarpal and middle-finger-phalanx-proximal (the knuckle).
 */
export function palmPose(wrist: Vector3, indexMeta: Vector3, pinkyMeta: Vector3, middleKnuckle: Vector3, handedness: 'left' | 'right'): PalmPose {
  const a = indexMeta.clone().sub(wrist);
  const b = pinkyMeta.clone().sub(wrist);
  // index × pinky points out of the back of a left hand and out of the palm of a right one
  const n = new Vector3().crossVectors(a, b);
  if (handedness === 'left') n.negate();
  if (n.lengthSq() < 1e-10) n.set(0, 1, 0);
  return { centre: wrist.clone().lerp(middleKnuckle, 0.55), normal: n.normalize() };
}

/** How squarely the palm faces the eyes: 1 = straight at you, 0 = edge on, < 0 = turned away. */
export function palmFacing(p: PalmPose, eye: Vector3): number {
  return p.normal.dot(eye.clone().sub(p.centre).normalize());
}

/** Palm-up with hysteresis: on after facing > `on` for `holdOn` s, off after < `off` for `holdOff` s. */
export class PalmUp {
  active = false;
  private t = 0;

  constructor(
    private readonly on = 0.55,
    private readonly off = 0.2,
    private readonly holdOn = 0.15,
    private readonly holdOff = 0.25,
  ) {}

  /** `facing` is null while the hand is not tracked. Returns whether the gesture is on. */
  update(facing: number | null, dt: number): boolean {
    const want = this.active ? facing !== null && facing > this.off : facing !== null && facing > this.on;
    if (want === this.active) {
      this.t = 0;
      return this.active;
    }
    this.t += dt;
    if (this.t >= (this.active ? this.holdOff : this.holdOn)) {
      this.active = want;
      this.t = 0;
    }
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.t = 0;
  }
}

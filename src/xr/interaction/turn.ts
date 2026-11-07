/**
 * Turning the whole graph (instead of moving you): bring a note round to the side that faces you,
 * and spin the graph from the map in your hand.
 *
 * Human factors: only the graph turns, never the room; about its own centre and the vertical axis for
 * the automatic turn (no roll or pitch), at most ~110°/s with ease-in-out so it starts and stops
 * softly. Pure maths so it is unit-tested without a headset.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';

export interface XZ {
  x: number;
  z: number;
}

const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Yaw (radians, about +Y) that turns `point` around `centre` until it lies between the centre and the eye. */
export function yawToFace(centre: XZ, point: XZ, eye: XZ): number {
  const px = point.x - centre.x;
  const pz = point.z - centre.z;
  const ex = eye.x - centre.x;
  const ez = eye.z - centre.z;
  if (Math.hypot(px, pz) < 1e-6 || Math.hypot(ex, ez) < 1e-6) return 0;
  return wrap(Math.atan2(ex, ez) - Math.atan2(px, pz));
}

/** How long a turn of `angle` radians takes: never abrupt, never sluggish (seconds). */
export function turnSeconds(angle: number): number {
  return Math.min(1.8, Math.max(0.4, 0.3 + Math.abs(angle) / ((110 * Math.PI) / 180)));
}

/** Rotate an object by `q` (world space) about the world point `pivot`. */
export function rotateAbout(obj: Object3D, pivot: Vector3, q: Quaternion): void {
  obj.position.sub(pivot).applyQuaternion(q).add(pivot);
  obj.quaternion.premultiply(q);
}

/**
 * Point on a sphere (centre c, radius r) under a ray, or the closest point of the sphere to the ray
 * when it misses: what you "hold" when you grab a ball and turn it.
 */
export function grabPoint(origin: Vector3, dir: Vector3, c: Vector3, r: number): Vector3 {
  const d = dir.clone().normalize();
  const oc = origin.clone().sub(c);
  const b = oc.dot(d);
  const disc = b * b - (oc.lengthSq() - r * r);
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0) return origin.clone().addScaledVector(d, t);
  }
  const closest = origin.clone().addScaledVector(d, Math.max(0, -b));
  return closest.sub(c).setLength(r).add(c);
}

/** Rotation that carries the grabbed point from a to b (both relative to the ball's centre). */
export function dragRotation(a: Vector3, b: Vector3): Quaternion {
  const u = a.clone().normalize();
  const v = b.clone().normalize();
  if (u.lengthSq() < 0.5 || v.lengthSq() < 0.5) return new Quaternion();
  return new Quaternion().setFromUnitVectors(u, v);
}

/**
 * Where things go around a seated person. All placements are relative to a "home" pose (head
 * position + facing yaw) taken when you enter or recenter, so content stays put while you look
 * around and only follows when you turn far away (lazy follow).
 *
 * The field of view is read from the headset, so on narrow-view devices (Meta VR Glasses ≈ 74° wide,
 * 25° up / 43° down) the shelf tightens towards the centre and slides down instead of falling off
 * the edges.
 */
import { Euler, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { ERGO } from '../theme';

export interface Home {
  position: Vector3;
  yaw: number;
}

export interface Fov {
  left: number;
  right: number;
  up: number;
  down: number;
}

/** Quest 3 field of view per eye, in degrees (approximate). */
export const QUEST_FOV: Fov = { left: 50, right: 50, up: 48, down: 52 };

export function fovFromProjection(m: ArrayLike<number>): Fov {
  // column-major projection: m[0] = 2n/(r-l), m[8] = (r+l)/(r-l), m[5] = 2n/(t-b), m[9] = (t+b)/(t-b)
  const deg = (r: number): number => (r * 180) / Math.PI;
  const left = deg(Math.atan((1 - m[8]!) / m[0]!));
  const right = deg(Math.atan((1 + m[8]!) / m[0]!));
  const up = deg(Math.atan((1 + m[9]!) / m[5]!));
  const down = deg(Math.atan((1 - m[9]!) / m[5]!));
  return { left, right, up, down };
}

/** Combined view of both eyes. */
export function unionFov(a: Fov, b: Fov): Fov {
  return { left: Math.max(a.left, b.left), right: Math.max(a.right, b.right), up: Math.max(a.up, b.up), down: Math.max(a.down, b.down) };
}

export interface ShelfLayout {
  /** azimuth of the active card, degrees (positive = to your right) */
  activeAz: number;
  /** angular width of one card */
  cardDeg: number;
  /** vertical offset of card centres below the eyes, metres */
  drop: number;
  radius: number;
  /** narrow-view devices put the dock higher so it stays inside the view */
  dockPitch: number;
}

/** Fit the reading shelf to the field of view. */
export function shelfFor(fov: Fov, cardWidth = ERGO.cardWidth): ShelfLayout {
  const radius = ERGO.shelfRadius;
  const cardDeg = (2 * Math.atan(cardWidth / 2 / radius) * 180) / Math.PI;
  const narrow = fov.right < 42 || fov.up < 32;
  // keep the whole active card inside the right half of the view, clear of the graph's centre
  const activeAz = narrow ? Math.max(0, Math.min(12, fov.right - cardDeg / 2 - 4)) : Math.min(26, fov.right - cardDeg / 2 - 6);
  // narrow views see more below than above (the glasses: 25° up, 43° down): slide content down a bit
  const drop = narrow ? ERGO.shelfDrop + 0.05 : ERGO.shelfDrop;
  const dockPitch = -Math.min(34, fov.down - 10);
  return { activeAz, cardDeg, drop, radius, dockPitch };
}

/** A point on the shelf: azimuth (deg, right positive) and height offset from the eyes. */
export function shelfPoint(home: Home, azDeg: number, dy: number, radius: number, out = new Vector3()): Vector3 {
  const a = home.yaw - (azDeg * Math.PI) / 180;
  return out.set(home.position.x - Math.sin(a) * radius, home.position.y + dy, home.position.z - Math.cos(a) * radius);
}

/** Turn `obj` so its +Z faces `eye` (planes face the viewer), upright. */
export function faceTowards(obj: Object3D, eye: Vector3, upright = true): void {
  const dx = eye.x - obj.position.x;
  const dz = eye.z - obj.position.z;
  const dy = eye.y - obj.position.y;
  const yaw = Math.atan2(dx, dz);
  const pitch = upright ? -Math.atan2(dy, Math.hypot(dx, dz)) : 0;
  obj.quaternion.setFromEuler(new Euler(upright ? pitch : 0, yaw, 0, 'YXZ'));
}

export function yawOf(q: Quaternion): number {
  const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}

/** Smallest signed difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

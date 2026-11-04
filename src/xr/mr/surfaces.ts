/**
 * Mixed reality: use the real room. From the planes the headset found (scene understanding) pick
 *   - a table or desk in front of you: the graph sits on it like a small galaxy you lean over;
 *   - a wall on your left: the thinking wall hangs just in front of it, so the cards you sort
 *     really are "on the wall".
 * Pure maths over plain numbers so it is unit-tested without a headset.
 */

export interface PlaneInfo {
  orientation: 'horizontal' | 'vertical' | string;
  /** e.g. "table", "desk", "wall", "floor" (Meta Quest room setup), may be empty */
  label: string;
  /** centre in world space */
  x: number;
  y: number;
  z: number;
  /** extent along the plane's local x and z, metres */
  width: number;
  depth: number;
  /** for a vertical plane: the direction it faces (its normal), as a yaw in radians */
  normalYaw: number;
}

export interface Head {
  x: number;
  y: number;
  z: number;
  /** facing yaw (radians, 0 = -Z, positive turns left) */
  yaw: number;
}

export interface TableSpot {
  x: number;
  /** top surface height */
  y: number;
  z: number;
  /** radius the graph may use without hanging far over the edge */
  radius: number;
  label: string;
}

export interface WallFit {
  /** yaw of the wall ring so its middle faces the real wall */
  yaw: number;
  /** ring radius that keeps the cards just in front of the real wall */
  radius: number;
  label: string;
}

const TABLE_LABELS = /table|desk|couch|bed|counter/i;

/** Azimuth of a point seen from the head, degrees, positive = to your right (same as the shelf). */
export function azimuthOf(head: Head, p: { x: number; z: number }): number {
  const a = Math.atan2(-(p.x - head.x), -(p.z - head.z)); // world yaw of the direction
  let d = ((head.yaw - a) * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d;
}

export function findTable(planes: readonly PlaneInfo[], head: Head): TableSpot | null {
  let best: { p: PlaneInfo; score: number } | null = null;
  for (const p of planes) {
    if (p.orientation !== 'horizontal') continue;
    const below = head.y - p.y;
    // seated or standing work height: 25–95 cm below the eyes; floors and ceilings are out
    if (below < 0.25 || below > 0.95) continue;
    const dist = Math.hypot(p.x - head.x, p.z - head.z);
    if (dist > 2.2) continue;
    const az = Math.abs(azimuthOf(head, p));
    if (az > 70) continue;
    const area = p.width * p.depth;
    if (area < 0.12) continue;
    const score = (TABLE_LABELS.test(p.label) ? 2 : 0) + Math.min(area, 1.5) - dist * 0.6 - az / 90;
    if (!best || score > best.score) best = { p, score };
  }
  if (!best) return null;
  const { p } = best;
  return { x: p.x, y: p.y, z: p.z, radius: Math.max(0.18, Math.min(0.45, Math.min(p.width, p.depth) * 0.55)), label: p.label };
}

/** The real wall to hang the thinking wall on: vertical, on your left (−150°…−20°), 0.8–3.5 m away. */
export function findWall(planes: readonly PlaneInfo[], head: Head): WallFit | null {
  let best: { p: PlaneInfo; score: number; dist: number; az: number } | null = null;
  for (const p of planes) {
    if (p.orientation !== 'vertical') continue;
    if (p.label && !/wall/i.test(p.label)) continue; // doors, windows, screens are not for cards
    const span = Math.max(p.width, p.depth); // which local axis runs along the floor depends on the runtime
    if (span < 1.2) continue;
    // the point of the wall closest to you (perpendicular foot), not its centre, which can be far to the side
    const nx = -Math.sin(p.normalYaw);
    const nz = -Math.cos(p.normalYaw);
    const along = (head.x - p.x) * nx + (head.z - p.z) * nz;
    const foot = { x: head.x - nx * along, z: head.z - nz * along };
    const az = azimuthOf(head, foot);
    if (az > -20 || az < -150) continue;
    const dist = Math.abs(along);
    if (dist < 0.8 || dist > 3.5) continue;
    const score = Math.min(span, 4) - Math.abs(az + 80) / 40 - Math.abs(dist - 1.5) * 0.5;
    if (!best || score > best.score) best = { p, score, dist, az };
  }
  if (!best) return null;
  // the ring's middle (−79°) should look at the wall: rotate it by the difference
  const MID = -79;
  const yaw = head.yaw + ((MID - best.az) * Math.PI) / 180;
  return { yaw, radius: Math.max(0.9, Math.min(1.6, best.dist - 0.08)), label: best.p.label };
}

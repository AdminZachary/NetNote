/**
 * The thinking wall, after "Immersive Space to Think" (Lisle, Davidson, Bowman, Virginia Tech 3DI):
 * people make sense of a pile of documents by laying them out around themselves and sorting them into
 * piles; the arrangement itself becomes the thinking, and an external memory you come back to.
 *
 * Geometry: a half-ring on your LEFT (26°–132°), radius 1.3 m, from ~0.6 m below to ~0.4 m above the
 * eyes. The graph stays in front and the reading shelf on the right, so the three never overlap. Cards
 * hang at half size; point at one and it comes forward to reading size. Cards placed edge to edge
 * form a group.
 *
 * Positions on the wall are (az°, h m): azimuth around you (negative = left) and height from the eyes.
 * Everything here is plain maths so it is unit-tested.
 */

export interface WallSpot {
  az: number;
  h: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** uniform scale for a full-size card */
  scale: number;
}

export const WALL_R = 1.3;
export const WALL_SCALE = 0.5;
/** degrees; negative = to your left (same convention as the shelf) */
export const WALL_AZ: readonly [number, number] = [-132, -26];
/** card centre height, metres relative to the eyes */
export const WALL_H: readonly [number, number] = [-0.6, 0.4];
/** edge gap that still counts as "placed together" */
export const GROUP_GAP = 0.07;
const SLOT_COLS = [-38, -58, -78, -98, -118];
const SLOT_ROWS = [0.1, -0.42];
const D2R = Math.PI / 180;

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class WallGeometry {
  /** card size on the wall, metres */
  readonly cw: number;
  readonly ch: number;
  /** ring radius: 1.3 m in VR; in mixed reality it is fitted to the real wall */
  radius = WALL_R;

  constructor(cardW: number, cardH: number) {
    this.cw = cardW * WALL_SCALE;
    this.ch = cardH * WALL_SCALE;
  }

  /** World pose of a card at `s`; zoom 0 = on the wall, 1 = pulled forward to reading size. */
  pose(origin: { x: number; y: number; z: number }, yaw: number, s: WallSpot, zoom = 0): Pose {
    const a = yaw - s.az * D2R;
    const r = this.radius - 0.42 * zoom;
    return {
      x: origin.x - Math.sin(a) * r,
      y: origin.y + s.h + 0.06 * zoom,
      z: origin.z - Math.cos(a) * r,
      scale: WALL_SCALE + (0.92 - WALL_SCALE) * zoom,
    };
  }

  /** Where a world point is, in wall coordinates (r = horizontal distance from the wall's centre). */
  locate(origin: { x: number; y: number; z: number }, yaw: number, pt: { x: number; y: number; z: number }): WallSpot & { r: number } {
    const dx = pt.x - origin.x;
    const dz = pt.z - origin.z;
    let az = (yaw - Math.atan2(-dx, -dz)) / D2R;
    az = ((((az + 180) % 360) + 360) % 360) - 180;
    return { az, h: pt.y - origin.y, r: Math.hypot(dx, dz) };
  }

  /** Is a carried card close enough to the wall to stick to it? */
  inZone(s: WallSpot & { r: number }): boolean {
    return s.r > 0.7 && s.r < 2.1 && s.az > WALL_AZ[0] - 8 && s.az < WALL_AZ[1] + 6 && s.h > WALL_H[0] - 0.25 && s.h < WALL_H[1] + 0.25;
  }

  clamp(s: WallSpot): WallSpot {
    return { az: clampN(s.az, WALL_AZ[0], WALL_AZ[1]), h: clampN(s.h, WALL_H[0], WALL_H[1]) };
  }

  /** Arc distance in metres between two wall spots. */
  dx(a: WallSpot, b: WallSpot): number {
    return Math.abs(a.az - b.az) * D2R * this.radius;
  }

  overlaps(s: WallSpot, others: readonly WallSpot[], gap = 0.02): boolean {
    return others.some((o) => this.dx(s, o) < this.cw + gap && Math.abs(s.h - o.h) < this.ch + gap);
  }

  private neighbours(o: WallSpot): WallSpot[] {
    const step = (this.cw + 0.03) / this.radius / D2R;
    return [
      { az: o.az + step, h: o.h },
      { az: o.az - step, h: o.h },
      { az: o.az, h: o.h - this.ch - 0.03 },
      { az: o.az, h: o.h + this.ch + 0.03 },
    ];
  }

  /** A free spot for a card dropped at `s`: keep it if free, else tuck it right next to what it landed on. */
  settle(s: WallSpot, others: readonly WallSpot[]): WallSpot {
    const c = this.clamp(s);
    if (!this.overlaps(c, others)) return c;
    const opts: WallSpot[] = [];
    for (const o of others) if (this.dx(c, o) < this.cw + 0.02 && Math.abs(c.h - o.h) < this.ch + 0.02) opts.push(...this.neighbours(o));
    const ok = opts.map((o) => this.clamp(o)).filter((o) => !this.overlaps(o, others));
    const d = (a: WallSpot): number => this.dx(a, c) + Math.abs(a.h - c.h);
    ok.sort((a, b) => d(a) - d(b));
    return ok[0] ?? this.nextFree(others) ?? c;
  }

  /** Next free automatic slot (spaced so auto-placed cards do NOT form groups by accident). */
  nextFree(others: readonly WallSpot[]): WallSpot | null {
    for (const h of SLOT_ROWS) for (const az of SLOT_COLS) if (!this.overlaps({ az, h }, others, 0.08)) return { az, h };
    for (let az = WALL_AZ[1]; az >= WALL_AZ[0]; az -= 4)
      for (let h = WALL_H[1]; h >= WALL_H[0]; h -= 0.08) if (!this.overlaps({ az, h }, others)) return { az, h };
    return null;
  }

  /** Spot right beside a group, for a card you add to it (closest to the group's middle). */
  besideGroup(group: readonly WallSpot[], others: readonly WallSpot[]): WallSpot | null {
    const cx = group.reduce((a, b) => a + b.az, 0) / group.length;
    const cy = group.reduce((a, b) => a + b.h, 0) / group.length;
    const ok = group
      .flatMap((o) => this.neighbours(o))
      .filter((o) => o.az >= WALL_AZ[0] && o.az <= WALL_AZ[1] && o.h >= WALL_H[0] && o.h <= WALL_H[1] && !this.overlaps(o, others));
    const d = (a: WallSpot): number => Math.abs(a.az - cx) * D2R * this.radius + Math.abs(a.h - cy);
    ok.sort((a, b) => d(a) - d(b));
    return ok[0] ?? this.nextFree(others);
  }

  /** Cards placed edge to edge belong together (union–find over neighbours). Groups of 2 or more. */
  groups<T>(items: readonly T[], spot: (t: T) => WallSpot): T[][] {
    const parent = items.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = spot(items[i]!);
        const b = spot(items[j]!);
        if (this.dx(a, b) < this.cw + GROUP_GAP && Math.abs(a.h - b.h) < this.ch + GROUP_GAP) parent[find(i)] = find(j);
      }
    const m = new Map<number, T[]>();
    items.forEach((t, i) => {
      const r = find(i);
      const g = m.get(r) ?? [];
      g.push(t);
      m.set(r, g);
    });
    return [...m.values()].filter((g) => g.length >= 2);
  }

  /** Bounds of a group on the wall (degrees across, metres up). */
  bounds(group: readonly WallSpot[]): { a0: number; a1: number; h0: number; h1: number } {
    const half = this.cw / 2 / this.radius / D2R;
    let a0 = Infinity;
    let a1 = -Infinity;
    let h0 = Infinity;
    let h1 = -Infinity;
    for (const s of group) {
      a0 = Math.min(a0, s.az - half);
      a1 = Math.max(a1, s.az + half);
      h0 = Math.min(h0, s.h - this.ch / 2);
      h1 = Math.max(h1, s.h + this.ch / 2);
    }
    return { a0, a1, h0, h1 };
  }
}

/** The saved form of the wall (per library). */
export interface SavedWallCard extends WallSpot {
  path: string;
}

export function sanitizeSavedWall(raw: unknown): SavedWallCard[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedWallCard[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const { path, az, h } = it as Record<string, unknown>;
    if (typeof path !== 'string' || typeof az !== 'number' || typeof h !== 'number' || !Number.isFinite(az + h) || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, az, h });
  }
  return out;
}

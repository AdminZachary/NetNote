import { describe, expect, it } from 'vitest';
import { sanitizeSavedWall, WALL_AZ, WALL_H, WALL_R, WALL_SCALE, WallGeometry, type WallSpot } from '../../src/xr/wall/wall-geometry';

const geo = new WallGeometry(0.7, 0.875);
const O = { x: 0, y: 1.6, z: 0 };

describe('WallGeometry', () => {
  it('pose and locate are inverse', () => {
    for (const yaw of [0, 0.7, -2]) {
      const s = { az: -60, h: 0.1 };
      const p = geo.pose(O, yaw, s);
      const back = geo.locate(O, yaw, p);
      expect(back.az).toBeCloseTo(-60);
      expect(back.h).toBeCloseTo(0.1);
      expect(back.r).toBeCloseTo(WALL_R);
      expect(p.scale).toBe(WALL_SCALE);
    }
  });

  it('negative azimuth is on your left when facing -Z', () => {
    const p = geo.pose(O, 0, { az: -90, h: 0 });
    expect(p.x).toBeCloseTo(-WALL_R);
    expect(p.z).toBeCloseTo(0);
  });

  it('zooming pulls a card towards you at reading size', () => {
    const far = geo.pose(O, 0, { az: -40, h: 0 }, 0);
    const near = geo.pose(O, 0, { az: -40, h: 0 }, 1);
    expect(Math.hypot(near.x, near.z)).toBeLessThan(Math.hypot(far.x, far.z));
    expect(near.scale).toBeGreaterThan(0.9);
  });

  it('only points near the wall are in its zone', () => {
    expect(geo.inZone({ az: -60, h: 0, r: 1.3 })).toBe(true);
    expect(geo.inZone({ az: 20, h: 0, r: 1.3 })).toBe(false); // on the right, the reading shelf
    expect(geo.inZone({ az: -60, h: 0, r: 0.3 })).toBe(false); // right next to your face
    expect(geo.inZone({ az: -60, h: 1.2, r: 1.3 })).toBe(false); // far above
  });

  it('clamps spots to the wall', () => {
    expect(geo.clamp({ az: 10, h: 5 })).toEqual({ az: WALL_AZ[1], h: WALL_H[1] });
  });

  it('automatic slots never overlap and never group by accident', () => {
    const spots: WallSpot[] = [];
    for (let i = 0; i < 10; i++) {
      const s = geo.nextFree(spots);
      expect(s).not.toBeNull();
      expect(geo.overlaps(s!, spots)).toBe(false);
      spots.push(s!);
    }
    expect(geo.groups(spots, (s) => s)).toEqual([]);
  });

  it('a card dropped onto another is tucked right next to it, forming a group', () => {
    const a = { az: -60, h: 0 };
    const s = geo.settle({ az: -61, h: 0.02 }, [a]);
    expect(geo.overlaps(s, [a])).toBe(false);
    const groups = geo.groups([a, s], (x) => x);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('besideGroup returns a free spot touching the group', () => {
    const g = [
      { az: -60, h: 0 },
      { az: -60 + 16.8, h: 0 },
    ];
    expect(geo.groups(g, (x) => x)).toHaveLength(1);
    const s = geo.besideGroup(g, g)!;
    expect(geo.overlaps(s, g)).toBe(false);
    expect(geo.groups([...g, s], (x) => x)[0]).toHaveLength(3);
  });

  it('bounds cover every card of the group', () => {
    const b = geo.bounds([
      { az: -60, h: 0 },
      { az: -40, h: -0.3 },
    ]);
    expect(b.a0).toBeLessThan(-60);
    expect(b.a1).toBeGreaterThan(-40);
    expect(b.h0).toBeLessThan(-0.3 - geo.ch / 2 + 1e-9);
    expect(b.h1).toBeGreaterThan(geo.ch / 2 - 1e-9);
  });
});

describe('sanitizeSavedWall', () => {
  it('keeps valid, unique cards only', () => {
    expect(
      sanitizeSavedWall([
        { path: 'a.md', az: -40, h: 0 },
        { path: 'a.md', az: -60, h: 0 },
        { path: 'b.md', az: 'x', h: 0 },
        null,
        { path: 'c.md', az: -80, h: NaN },
        { path: 'd.md', az: -90, h: 0.1 },
      ]),
    ).toEqual([
      { path: 'a.md', az: -40, h: 0 },
      { path: 'd.md', az: -90, h: 0.1 },
    ]);
    expect(sanitizeSavedWall('nope')).toEqual([]);
  });
});

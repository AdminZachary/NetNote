import { Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { angleDiff, fovFromProjection, QUEST_FOV, shelfFor, shelfPoint, unionFov, yawOf, type Fov } from '../../src/xr/room/placement';

/** A column-major projection matrix for an asymmetric frustum (degrees). */
function projection(f: Fov, near = 0.1): number[] {
  const r = Math.tan((f.right * Math.PI) / 180) * near;
  const l = -Math.tan((f.left * Math.PI) / 180) * near;
  const t = Math.tan((f.up * Math.PI) / 180) * near;
  const b = -Math.tan((f.down * Math.PI) / 180) * near;
  const m = new Array(16).fill(0);
  m[0] = (2 * near) / (r - l);
  m[5] = (2 * near) / (t - b);
  m[8] = (r + l) / (r - l);
  m[9] = (t + b) / (t - b);
  m[10] = -1;
  m[11] = -1;
  return m;
}

/** Meta VR glasses, as emulated by IWER: 37° left/right, 25° up, 43° down. */
const GLASSES: Fov = { left: 37, right: 37, up: 25, down: 43 };

describe('field of view', () => {
  it('reads the angles back from a projection matrix', () => {
    const f = fovFromProjection(projection(GLASSES));
    expect(f.left).toBeCloseTo(37);
    expect(f.right).toBeCloseTo(37);
    expect(f.up).toBeCloseTo(25);
    expect(f.down).toBeCloseTo(43);
  });

  it('union of both eyes takes the wider side of each', () => {
    const u = unionFov({ left: 50, right: 40, up: 40, down: 40 }, { left: 40, right: 50, up: 45, down: 38 });
    expect(u).toEqual({ left: 50, right: 50, up: 45, down: 40 });
  });
});

describe('shelfFor', () => {
  it('Quest: the active card sits right of centre and fully inside the view', () => {
    const s = shelfFor(QUEST_FOV);
    expect(s.activeAz).toBeGreaterThan(10);
    expect(s.activeAz + s.cardDeg / 2).toBeLessThan(QUEST_FOV.right);
  });

  it('Meta VR glasses: the card moves towards the centre and content slides down', () => {
    const q = shelfFor(QUEST_FOV);
    const g = shelfFor(GLASSES);
    expect(g.activeAz).toBeLessThan(q.activeAz);
    expect(g.activeAz + g.cardDeg / 2).toBeLessThanOrEqual(GLASSES.right);
    expect(g.drop).toBeGreaterThan(q.drop);
    // the dock stays inside the narrow lower view
    expect(-g.dockPitch).toBeLessThan(GLASSES.down);
  });
});

describe('shelf geometry', () => {
  it('azimuth 0 is straight ahead, positive is to the right', () => {
    const home = { position: new Vector3(0, 1.5, 0), yaw: 0 };
    const ahead = shelfPoint(home, 0, 0, 1);
    expect(ahead.z).toBeCloseTo(-1);
    expect(shelfPoint(home, 90, 0, 1).x).toBeCloseTo(1);
    expect(shelfPoint(home, 0, -0.2, 1).y).toBeCloseTo(1.3);
  });

  it('yawOf and angleDiff', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    expect(yawOf(q)).toBeCloseTo(0.5);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2);
  });
});

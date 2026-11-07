import { describe, expect, it } from 'vitest';
import { Group, Quaternion, Vector3 } from '@iwsdk/core';
import { dragRotation, grabPoint, rotateAbout, turnSeconds, yawToFace } from '../../src/xr/interaction/turn';

describe('turning the graph', () => {
  const centre = { x: 0, z: -3 };
  const eye = { x: 0, z: 0 };
  it('a note on the far side turns half way round', () => expect(Math.abs(yawToFace(centre, { x: 0, z: -4 }, eye))).toBeCloseTo(Math.PI));
  it('a note already facing you does not turn', () => expect(yawToFace(centre, { x: 0, z: -2 }, eye)).toBeCloseTo(0));
  it('rotating by that yaw brings the note between the centre and you', () => {
    const p = new Vector3(1, 0, -3);
    const yaw = yawToFace(centre, p, eye);
    const g = new Group();
    g.position.copy(p);
    rotateAbout(g, new Vector3(0, 0, -3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
    expect(g.position.x).toBeCloseTo(0);
    expect(g.position.z).toBeCloseTo(-2);
  });
  it('turns are soft but never slow', () => {
    expect(turnSeconds(0.1)).toBeGreaterThanOrEqual(0.4);
    expect(turnSeconds(Math.PI)).toBeLessThanOrEqual(1.8);
    // never faster than ~110°/s on average
    for (const a of [0.5, 1, 2, 3]) expect(a / turnSeconds(a)).toBeLessThan((115 * Math.PI) / 180);
  });
  it('grabbing the ball: on the sphere when the ray hits, the closest point when it misses', () => {
    const c = new Vector3(0, 0, -1);
    const hit = grabPoint(new Vector3(0, 0, 0), new Vector3(0, 0, -1), c, 0.1);
    expect(hit.z).toBeCloseTo(-0.9);
    const miss = grabPoint(new Vector3(0, 1, 0), new Vector3(0, 0, -1), c, 0.1);
    expect(miss.distanceTo(c)).toBeCloseTo(0.1);
    expect(miss.y).toBeGreaterThan(0);
  });
  it('dragging carries the grabbed point', () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 0, -1);
    expect(a.clone().applyQuaternion(dragRotation(a, b)).distanceTo(b)).toBeLessThan(1e-6);
  });
});

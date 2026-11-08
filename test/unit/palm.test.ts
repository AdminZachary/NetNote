import { describe, expect, it } from 'vitest';
import { Vector3 } from '@iwsdk/core';
import { PalmUp, palmFacing, palmPose } from '../../src/xr/interaction/palm';

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

describe('palm', () => {
  // a left hand held out flat, fingers forward (-z): index on the right (+x), pinky on the left
  const wrist = v(0, 1, -0.3);
  const knuckle = v(0, 1, -0.39);
  it('a left hand palm down faces the floor, palm up faces the sky', () => {
    const down = palmPose(wrist, v(0.025, 1, -0.37), v(-0.03, 1, -0.36), knuckle, 'left');
    expect(down.normal.y).toBeLessThan(-0.9);
    // turned over (rotate 180° about the forearm): index now on the left
    const up = palmPose(wrist, v(-0.025, 1, -0.37), v(0.03, 1, -0.36), knuckle, 'left');
    expect(up.normal.y).toBeGreaterThan(0.9);
  });
  it('the right hand is the mirror image', () => {
    const down = palmPose(wrist, v(-0.025, 1, -0.37), v(0.03, 1, -0.36), knuckle, 'right');
    expect(down.normal.y).toBeLessThan(-0.9);
  });
  it('measures how squarely the palm faces you', () => {
    const up = palmPose(wrist, v(-0.025, 1, -0.37), v(0.03, 1, -0.36), knuckle, 'left');
    expect(palmFacing(up, v(0, 1.6, 0))).toBeGreaterThan(0.8);
    expect(palmFacing(up, v(0, 0.4, -0.3))).toBeLessThan(-0.9);
  });
  it('turns on and off calmly, with hysteresis', () => {
    const g = new PalmUp();
    expect(g.update(0.9, 0.05)).toBe(false); // must be held a moment
    g.update(0.9, 0.06);
    expect(g.update(0.9, 0.06)).toBe(true);
    expect(g.update(0.35, 0.5)).toBe(true); // between the thresholds: stays on
    g.update(0.1, 0.1);
    expect(g.update(0.1, 0.1)).toBe(true);
    expect(g.update(0.1, 0.1)).toBe(false);
    expect(g.update(null, 1)).toBe(false);
  });
});

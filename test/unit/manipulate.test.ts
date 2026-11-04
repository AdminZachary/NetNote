import { Object3D } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { RoomManipulator, twoHandDelta } from '../../src/xr/interaction/manipulate';

describe('twoHandDelta', () => {
  it('pulling hands apart doubles the scale', () => {
    const d = twoHandDelta({ x: -0.1, y: 1, z: -0.5 }, { x: 0.1, y: 1, z: -0.5 }, { x: -0.2, y: 1, z: -0.5 }, { x: 0.2, y: 1, z: -0.5 });
    expect(d.scale).toBeCloseTo(2);
    expect(d.yaw).toBeCloseTo(0);
  });
  it('turning hands around each other gives a yaw', () => {
    const d = twoHandDelta({ x: -0.1, y: 1, z: 0 }, { x: 0.1, y: 1, z: 0 }, { x: 0, y: 1, z: 0.1 }, { x: 0, y: 1, z: -0.1 });
    expect(Math.abs(d.yaw)).toBeCloseTo(Math.PI / 2);
  });
});

describe('RoomManipulator', () => {
  it('one hand translates the target 1:1', () => {
    const o = new Object3D();
    const m = new RoomManipulator(o);
    m.begin(1, { x: 0, y: 1, z: 0 });
    m.move(1, { x: 0.2, y: 1.1, z: 0 }, 16);
    m.end(1);
    expect(o.position.x).toBeCloseTo(0.2);
    expect(o.position.y).toBeCloseTo(0.1);
  });
  it('two hands zoom about the midpoint, clamped', () => {
    const o = new Object3D();
    o.scale.setScalar(0.01);
    o.position.set(0, 1, -1);
    const m = new RoomManipulator(o);
    const events: string[] = [];
    m.onManipulate = (k) => events.push(k);
    m.begin(1, { x: -0.1, y: 1, z: -1 });
    m.begin(2, { x: 0.1, y: 1, z: -1 });
    m.move(2, { x: 0.3, y: 1, z: -1 });
    // distance 0.2 -> 0.4: scale doubles; midpoint moved from 0 to 0.1
    expect(o.scale.x).toBeCloseTo(0.02);
    expect(o.position.x).toBeCloseTo(0.1);
    expect(events).toEqual(['zoom']);
    m.move(2, { x: 100, y: 1, z: -1 });
    expect(o.scale.x).toBeLessThanOrEqual(m.maxScale);
  });
  it('keeps momentum after a flick and stops', () => {
    const o = new Object3D();
    const m = new RoomManipulator(o);
    m.begin(1, { x: 0, y: 0, z: 0 });
    m.move(1, { x: 0.05, y: 0, z: 0 }, performance.now());
    m.end(1);
    const x0 = o.position.x;
    for (let i = 0; i < 60; i++) m.update(1 / 60);
    expect(o.position.x).toBeGreaterThan(x0);
    const x1 = o.position.x;
    for (let i = 0; i < 120; i++) m.update(1 / 60);
    expect(o.position.x - x1).toBeLessThan(0.01);
  });
});

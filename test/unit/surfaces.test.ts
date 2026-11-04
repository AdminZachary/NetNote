import { describe, expect, it } from 'vitest';
import { azimuthOf, findTable, findWall, type Head, type PlaneInfo } from '../../src/xr/mr/surfaces';

const head: Head = { x: 0, y: 1.2, z: 0, yaw: 0 }; // seated, facing -Z
const plane = (p: Partial<PlaneInfo>): PlaneInfo => ({ orientation: 'horizontal', label: '', x: 0, y: 0, z: 0, width: 1, depth: 1, normalYaw: 0, ...p });

describe('azimuthOf', () => {
  it('right is positive, left negative', () => {
    expect(azimuthOf(head, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(azimuthOf(head, { x: 1, z: 0 })).toBeCloseTo(90);
    expect(azimuthOf(head, { x: -1, z: 0 })).toBeCloseTo(-90);
  });
});

describe('findTable', () => {
  it('picks the desk in front of you, not the floor or a shelf behind you', () => {
    const planes = [
      plane({ label: 'floor', y: 0, width: 4, depth: 4 }),
      plane({ label: 'table', y: 0.75, z: -0.7, width: 1.2, depth: 0.7 }),
      plane({ label: 'table', y: 0.75, z: 1.2, width: 1.2, depth: 0.7 }), // behind
    ];
    const t = findTable(planes, head)!;
    expect(t.z).toBeCloseTo(-0.7);
    expect(t.y).toBeCloseTo(0.75);
    expect(t.radius).toBeGreaterThan(0.18);
    expect(t.radius).toBeLessThanOrEqual(0.45);
  });

  it('works with unlabelled planes and ignores tiny ones', () => {
    expect(findTable([plane({ y: 0.7, z: -0.8, width: 0.2, depth: 0.2 })], head)).toBeNull();
    expect(findTable([plane({ y: 0.7, z: -0.8, width: 0.8, depth: 0.6 })], head)).not.toBeNull();
  });

  it('returns null when there is no table', () => {
    expect(findTable([plane({ label: 'floor', y: 0, width: 4, depth: 4 })], head)).toBeNull();
  });
});

describe('findWall', () => {
  // a wall 1.4 m to your left, facing you (+X): normal yaw = -90° (pointing +X)
  const leftWall = plane({ orientation: 'vertical', label: 'wall', x: -1.4, y: 1.3, z: 0.5, width: 3, normalYaw: -Math.PI / 2 });

  it('fits the thinking wall onto the real wall on your left', () => {
    const w = findWall([leftWall], head)!;
    expect(w).not.toBeNull();
    expect(w.radius).toBeCloseTo(1.32);
    // the ring middle (-79°) must point at the wall foot (-90°): ring yaw = 0 + (-79 - -90)°
    expect((w.yaw * 180) / Math.PI).toBeCloseTo(11);
  });

  it('ignores walls on your right, windows and walls too close', () => {
    const right = { ...leftWall, x: 1.4, normalYaw: Math.PI / 2 };
    expect(findWall([right], head)).toBeNull();
    expect(findWall([{ ...leftWall, label: 'window' }], head)).toBeNull();
    expect(findWall([{ ...leftWall, x: -0.5 }], head)).toBeNull();
  });
});

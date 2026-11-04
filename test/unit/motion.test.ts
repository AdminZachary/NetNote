import { describe, expect, it } from 'vitest';
import { damp, follow, MOTION, popScale } from '../../src/xr/motion/ease';
import { planParticles, type FlowLink } from '../../src/xr/motion/flows';
import { tetherCurve } from '../../src/xr/motion/tethers';

describe('easing', () => {
  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 72; i++) a = damp(a, 1, MOTION.glide, 1 / 72);
    let b = 0;
    for (let i = 0; i < 120; i++) b = damp(b, 1, MOTION.glide, 1 / 120);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
  it('a card glide is nearly done in a quarter second', () => expect(follow(MOTION.glide, 0.25)).toBeGreaterThan(0.88));
  it('pop-in grows without overshoot and ends at full size', () => {
    let prev = 0;
    for (let t = 0; t <= 0.4; t += 0.01) {
      const s = popScale(t);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(popScale(0)).toBeCloseTo(MOTION.popFrom);
    expect(popScale(1)).toBe(1);
    expect(popScale(0, true)).toBe(1);
  });
});

describe('flow particles', () => {
  const L = (len: number): FlowLink => ({ a: { x: 0, y: 0, z: 0 }, b: { x: len, y: 0, z: 0 }, kind: 'out' });
  it('none without links', () => expect(planParticles([])).toEqual([]));
  it('more on longer links, at least one each', () => {
    const ps = planParticles([L(1), L(4)]);
    const n0 = ps.filter((p) => p.link === 0).length;
    const n1 = ps.filter((p) => p.link === 1).length;
    expect(n0).toBeGreaterThanOrEqual(1);
    expect(n1).toBeGreaterThan(n0);
    expect(n1).toBeLessThanOrEqual(6);
  });
  it('stays within the budget for a huge hub', () => {
    const many = Array.from({ length: 3000 }, (_, i) => L(1 + (i % 5)));
    expect(planParticles(many, 1600).length).toBeLessThanOrEqual(1600);
  });
  it('phases are spread along each link', () => {
    const ps = planParticles([L(1), L(1)]).filter((p) => p.link === 0);
    const ph = ps.map((p) => p.phase).sort();
    for (const p of ph) expect(p).toBeGreaterThanOrEqual(0);
    expect(new Set(ph).size).toBe(ph.length);
  });
});

describe('tethers', () => {
  it('start at the card edge and end at the star', () => {
    const pts = tetherCurve({ x: 0, y: 1, z: -1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: 0.8, z: -2.5 });
    expect(pts[0]).toEqual({ x: 0, y: 1, z: -1 });
    const end = pts[pts.length - 1]!;
    expect(end.x).toBeCloseTo(0.5);
    expect(end.z).toBeCloseTo(-2.5);
    // leaves the card outward (to the left) first
    expect(pts[2]!.x).toBeLessThan(0);
  });
});

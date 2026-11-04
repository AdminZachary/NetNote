/**
 * Motion rules for a headset, from human factors rather than taste:
 *   - things you look at arrive quickly and settle without overshoot (no wobble to refocus on)
 *   - nothing big moves on its own in your peripheral view; the world itself only moves when you ask
 *   - ambient motion (flowing links) is slow, small and low-contrast, and stops when nothing is focused
 *   - "reduce motion" (system setting or ours) turns animation into instant changes
 * Frame-rate independent: every easing is exponential in dt.
 */

/** Fraction to move towards a target this frame for a given rate (1/s). */
export function follow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/** Critically damped approach of a scalar. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * follow(rate, dt);
}

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
export const easeInOut = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
};

export const MOTION = {
  /** card glide rate: ~90% of the way in 0.25 s */
  glide: 9,
  /** a new card grows from this scale */
  popFrom: 0.72,
  popSeconds: 0.22,
  /** a card that changes note dims briefly instead of moving */
  swapSeconds: 0.16,
  /** flow particles, in link lengths per second (slow on purpose) */
  flowSpeed: 0.35,
  /** time machine and graph glides */
  glideSeconds: 0.45,
} as const;

/** Scale of a card `t` seconds after it appeared (ease-out, never above 1). */
export function popScale(t: number, reduced = false): number {
  if (reduced) return 1;
  return MOTION.popFrom + (1 - MOTION.popFrom) * easeOutCubic(t / MOTION.popSeconds);
}

let override: boolean | null = null;

/** User choice wins; otherwise the OS / browser preference. */
export function reduceMotion(): boolean {
  if (override !== null) return override;
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function setReduceMotion(v: boolean | null): void {
  override = v;
}

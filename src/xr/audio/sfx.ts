/**
 * A tiny spatial sound kit, synthesised with Web Audio (nothing to download). Every cue comes from
 * where it happens (HRTF panning): the star you point at to your left, the card that opens on your
 * right. Quiet and short: it confirms, it never nags; hover ticks are rate-limited.
 * Plus controller haptics: a light tick on hover, a firmer one on pinch/select. Hands have no motor,
 * so with hand tracking the sound is the confirmation.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

type Cue = 'hover' | 'select' | 'open' | 'close' | 'pin' | 'grab' | 'release' | 'link' | 'whoosh' | 'chime' | 'error';

interface ToneOpts {
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  delay?: number;
  slide?: number;
}

/** What each cue sounds like (frequency, envelope). Exported so tests can check it stays gentle. */
export const CUES: Record<Cue, [number, ToneOpts][]> = {
  hover: [[1320, { dur: 0.05, gain: 0.14 }]],
  select: [
    [660, { dur: 0.18, gain: 0.36 }],
    [990, { dur: 0.24, gain: 0.26, delay: 0.06 }],
  ],
  open: [[520, { dur: 0.22, gain: 0.26, slide: 1.5 }]],
  close: [[700, { dur: 0.16, gain: 0.2, slide: 0.6 }]],
  pin: [
    [220, { dur: 0.12, gain: 0.42, type: 'triangle' }],
    [440, { dur: 0.1, gain: 0.22, delay: 0.03 }],
  ],
  grab: [[300, { dur: 0.1, gain: 0.3, type: 'triangle', slide: 1.4 }]],
  release: [[420, { dur: 0.14, gain: 0.22, type: 'triangle', slide: 0.7 }]],
  // a found connection: an open fifth and octave, two notes finding each other
  link: [
    [523, { dur: 0.5, gain: 0.24 }],
    [784, { dur: 0.5, gain: 0.22, delay: 0.09 }],
    [1047, { dur: 0.5, gain: 0.2, delay: 0.18 }],
  ],
  whoosh: [
    [160, { dur: 0.8, gain: 0.22, type: 'triangle', slide: 2.2 }],
    [240, { dur: 0.8, gain: 0.14, delay: 0.12, slide: 2.2 }],
  ],
  chime: [
    [880, { dur: 0.3, gain: 0.16 }],
    [1320, { dur: 0.35, gain: 0.12, delay: 0.08 }],
  ],
  error: [[180, { dur: 0.22, gain: 0.28, type: 'triangle', slide: 0.8 }]],
};

/** Haptic strength (0..1) and length (ms) per cue; none for ambient cues. */
export const BUZZ: Partial<Record<Cue, [number, number]>> = {
  hover: [0.08, 12],
  select: [0.35, 30],
  grab: [0.45, 35],
  release: [0.25, 20],
  pin: [0.3, 25],
  link: [0.5, 60],
  error: [0.4, 50],
};

interface HapticSession {
  inputSources: Iterable<{ handedness: string; gamepad?: { hapticActuators?: readonly { pulse?(v: number, ms: number): Promise<unknown> }[] } | null }>;
}

export class Sound {
  enabled = true;
  hapticsEnabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastHover = 0;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const AC =
        (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Call from a user gesture (the Enter VR click) so the browser lets us play. */
  unlock(): void {
    const c = this.ensure();
    if (c?.state === 'suspended') void c.resume().catch(() => undefined);
  }

  /** Keep the listener on your head. */
  listen(pos: P3, fwd: P3, up: P3): void {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener;
    if (l.positionX) {
      const t = c.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      (l as unknown as { setPosition?(x: number, y: number, z: number): void }).setPosition?.(pos.x, pos.y, pos.z);
    }
  }

  /** Play a cue at a place in the room; optionally buzz the controllers of `session`. */
  play(cue: Cue, at: P3, session?: HapticSession | null, hand?: 'left' | 'right'): void {
    if (cue === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 70) return;
      this.lastHover = now;
    }
    if (session && this.hapticsEnabled) buzz(session, cue, hand);
    if (!this.enabled) return;
    const c = this.ensure();
    if (!c || c.state !== 'running' || !this.master) return;
    for (const [f, o] of CUES[cue]) this.tone(c, this.master, at, f, o);
  }

  private tone(c: AudioContext, out: GainNode, at: P3, freq: number, { dur = 0.12, gain = 0.5, type = 'sine', delay = 0, slide = 0 }: ToneOpts): void {
    const t = c.currentTime + delay;
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.6;
    p.rolloffFactor = 0.8;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    }
    p.connect(out);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => p.disconnect();
  }
}

/** Pulse the controller(s): the given hand, or every controller that has a motor. */
export function buzz(session: HapticSession, cue: Cue, hand?: 'left' | 'right'): number {
  const b = BUZZ[cue];
  if (!b) return 0;
  let n = 0;
  for (const s of session.inputSources) {
    if (hand && s.handedness !== hand) continue;
    const act = s.gamepad?.hapticActuators?.[0];
    if (act?.pulse) {
      void act.pulse(b[0], b[1]).catch(() => undefined);
      n++;
    }
  }
  return n;
}

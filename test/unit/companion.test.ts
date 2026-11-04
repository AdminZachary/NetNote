import { describe, expect, it } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { CompanionBrain, type WorldView } from '../../src/xr/companion/brain';
import { BUZZ, buzz, CUES } from '../../src/xr/audio/sfx';

const world = (over: Partial<WorldView> = {}): WorldView => ({
  suggestions: () => [{ a: 'A.md', b: 'B.md' }],
  questions: () => ['How does sleep relate to memory?'],
  writing: () => false,
  busy: () => false,
  ...over,
});

describe('companion brain', () => {
  setLocale('en');
  it('greets once, offering what it found', () => {
    const b = new CompanionBrain(world(), 0, () => 0);
    b.insightsReady(1000, 9);
    expect(b.speech?.text).toMatch(/Good morning/);
    expect(b.speech?.action).toEqual({ kind: 'next' });
    b.hush();
    b.insightsReady(2000, 9);
    expect(b.speech).toBeNull();
  });
  it('never talks over your writing', () => {
    let writing = true;
    const b = new CompanionBrain(world({ writing: () => writing }), 0, () => 0);
    b.created(100);
    expect(b.speech).toBeNull();
    writing = false;
    b.created(200);
    expect(b.speech).not.toBeNull();
  });
  it('keeps quiet for a while after speaking', () => {
    const b = new CompanionBrain(world(), 0, () => 0);
    b.linked(0);
    b.hush();
    b.opened({ path: 'A.md', name: 'A', backlinks: 3, related: { path: 'B.md', name: 'B' } }, 5000);
    expect(b.speech).toBeNull();
    b.opened({ path: 'C.md', name: 'C', backlinks: 3, related: { path: 'B.md', name: 'B' } }, 30_000);
    expect(b.speech?.action).toEqual({ kind: 'suggest', a: 'C.md', b: 'B.md' });
  });
  it('falls asleep when you are away and wakes when you are back', () => {
    const b = new CompanionBrain(world(), 0, () => 0);
    b.tick(80_000);
    expect(b.mood).toBe('sleep');
    b.active(81_000);
    expect(b.mood).toBe('surprised');
    expect(b.acts).toContain('hop');
  });
  it('shares an ambient thought at most every four minutes', () => {
    const b = new CompanionBrain(world(), 0, () => 0);
    let spoke = 0;
    for (let now = 0; now < 600_000; now += 5000) {
      b.active(now);
      b.tick(now);
      if (b.speech) {
        spoke++;
        b.hush();
      }
    }
    expect(spoke).toBeLessThanOrEqual(2);
    expect(spoke).toBeGreaterThanOrEqual(1);
  });
  it('not chatty: only answers a poke', () => {
    const b = new CompanionBrain(world(), 0, () => 0.9);
    b.chatty = false;
    b.created(100);
    expect(b.speech).toBeNull();
    b.poke(200);
    expect(b.speech).not.toBeNull();
  });
  it('disabled: silent even when poked', () => {
    const b = new CompanionBrain(world(), 0);
    b.enabled = false;
    b.poke(10);
    expect(b.speech).toBeNull();
  });
});

describe('sound and haptics', () => {
  it('every cue is short and quiet', () => {
    for (const tones of Object.values(CUES))
      for (const [f, o] of tones) {
        expect(f).toBeGreaterThan(100);
        expect(f).toBeLessThan(2000);
        expect(o.gain ?? 0.5).toBeLessThanOrEqual(0.45);
        expect((o.dur ?? 0.12) + (o.delay ?? 0)).toBeLessThanOrEqual(1);
      }
  });
  it('haptic pulses are light and brief', () => {
    for (const [s, ms] of Object.values(BUZZ)) {
      expect(s).toBeLessThanOrEqual(0.5);
      expect(ms).toBeLessThanOrEqual(60);
    }
  });
  it('buzzes only the chosen hand, skipping hands without a motor', () => {
    const pulses: string[] = [];
    const src = (h: string, motor: boolean) => ({
      handedness: h,
      gamepad: motor ? { hapticActuators: [{ pulse: () => (pulses.push(h), Promise.resolve(true)) }] } : null,
    });
    const session = { inputSources: [src('left', true), src('right', true), src('right', false)] };
    expect(buzz(session, 'select', 'right')).toBe(1);
    expect(pulses).toEqual(['right']);
    expect(buzz(session, 'chime')).toBe(0);
  });
});

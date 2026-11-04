/**
 * The companion's mind. It doesn't decorate, it notices: two notes that might belong together, a link
 * you just made, a question between two topics. Rules that keep it a help and never a nuisance:
 *   - it never speaks while you write, and stays quiet for a while after each remark
 *   - an ambient thought at most every 4 minutes, and only while you are active
 *   - it falls asleep when you are away (75 s) and greets you when you come back
 *   - "chatty" off: it only answers when you poke it
 * Pure: time comes in through `now`, randomness through `rand`, words through `t()`.
 */
import { t } from '../../app/i18n';

export type Mood = 'idle' | 'happy' | 'love' | 'sleep' | 'surprised' | 'curious';
export type Act = 'hop' | 'wiggle' | 'spin' | 'nod' | 'look' | 'hearts' | 'wave';

export type SpeechAction = { kind: 'suggest'; a: string; b: string } | { kind: 'next' } | { kind: 'insights' };

export interface Speech {
  text: string;
  action?: SpeechAction;
  label?: string;
  /** when it stops showing (ms clock) */
  until: number;
}

export interface WorldView {
  /** possible links not yet made / dismissed, best first */
  suggestions(): { a: string; b: string }[];
  /** questions between topics */
  questions(): string[];
  writing(): boolean;
  /** tour or time machine running: no small talk */
  busy(): boolean;
}

export interface NoteSeen {
  path: string;
  name: string;
  backlinks: number;
  /** an unlinked related note, if any */
  related?: { path: string; name: string };
}

export class CompanionBrain {
  enabled = true;
  chatty = true;
  mood: Mood = 'idle';
  speech: Speech | null = null;
  /** acts to play, drained by the body */
  readonly acts: Act[] = [];
  /** notes it wants to look at */
  focus: string[] = [];
  xp = 0;
  private moodUntil = 0;
  private lastSpoke = -Infinity;
  private lastAmbient: number;
  private lastActive: number;
  private greeted = false;
  private lastNote: string | null = null;

  constructor(
    private readonly world: WorldView,
    now: number,
    private readonly rand: () => number = Math.random,
  ) {
    this.lastAmbient = now;
    this.lastActive = now;
  }

  private pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.rand() * a.length)] ?? a[0]!;
  }

  private quietFor(ms: number, now: number): boolean {
    return now - this.lastSpoke > ms;
  }

  setMood(m: Mood, now: number, ms = 0): void {
    this.mood = m;
    this.moodUntil = ms ? now + ms : 0;
  }

  /** Say something; `force` answers you directly (pokes), even when not chatty. */
  say(text: string, now: number, opts: { action?: SpeechAction; label?: string; force?: boolean; ms?: number } = {}): boolean {
    if (!this.enabled) return false;
    if (!this.chatty && !opts.force) return false;
    if (this.world.writing() && !opts.force) return false;
    const dur = opts.ms ?? Math.min(9000, 2600 + text.length * 110) + (opts.action ? 3500 : 0);
    this.speech = { text, action: opts.action, label: opts.label, until: now + dur };
    this.lastSpoke = now;
    return true;
  }

  hush(): void {
    this.speech = null;
  }

  /** Something you did (pinch, move, type): you are here. */
  active(now: number): void {
    this.lastActive = now;
    if (this.mood === 'sleep') {
      this.setMood('surprised', now, 900);
      this.acts.push('hop');
      this.say(this.pick(t().petWake), now);
    }
  }

  tick(now: number): void {
    if (this.speech && now > this.speech.until) this.speech = null;
    if (this.moodUntil && now > this.moodUntil) this.setMood('idle', now);
    if (this.world.writing() && this.speech && !this.speech.action) this.speech = null;
    const idle = now - this.lastActive;
    if (idle > 75_000 && this.mood !== 'sleep' && !this.world.busy()) {
      this.hush();
      this.setMood('sleep', now);
    }
    if (this.chatty && idle < 30_000 && now - this.lastAmbient > 240_000 && this.quietFor(60_000, now) && !this.world.writing() && !this.world.busy()) {
      this.lastAmbient = now;
      const qs = this.world.questions();
      const sug = this.world.suggestions();
      if (qs.length && (this.rand() < 0.6 || !sug.length))
        this.say(t().petWonder(this.pick(qs.slice(0, 3))), now, { action: { kind: 'insights' }, label: t().petInsights });
      else if (sug.length) this.say(this.pick(t().petAmbientLink), now, { action: { kind: 'next' }, label: t().petShow });
    }
  }

  /** Insights are ready (first time: greet). */
  insightsReady(now: number, hour: number): void {
    if (this.greeted) return;
    this.greeted = true;
    const n = Math.min(8, this.world.suggestions().length);
    this.acts.push('wave');
    this.setMood('happy', now, 2200);
    this.say(t().petGreet(hour) + (n ? t().petFound(n) : ''), now, n ? { action: { kind: 'next' }, label: t().petShow } : {});
  }

  /** You opened a note. */
  opened(note: NoteSeen, now: number): void {
    if (note.path === this.lastNote) return;
    this.lastNote = note.path;
    this.focus = [note.path];
    if (this.mood === 'sleep') return;
    this.acts.push('look');
    if (!this.quietFor(18_000, now) || this.world.busy()) return;
    if (note.related && this.rand() < 0.7) {
      this.setMood('curious', now, 2500);
      this.say(t().petRelated(note.name, note.related.name), now, {
        action: { kind: 'suggest', a: note.path, b: note.related.path },
        label: t().petWhy,
      });
    } else if (note.backlinks === 0 && this.rand() < 0.35) this.say(t().petLonely, now);
  }

  linked(now: number): void {
    this.xp++;
    this.setMood('love', now, 2600);
    this.acts.push('spin', 'hearts');
    this.say(this.pick(t().petLinked(this.xp)), now);
  }

  saved(now: number): void {
    this.acts.push('nod');
    this.setMood('happy', now, 1500);
    if (this.quietFor(30_000, now)) this.say(this.pick(t().petSaved), now);
  }

  created(now: number): void {
    this.acts.push('hop');
    this.setMood('surprised', now, 1200);
    this.say(this.pick(t().petCreated), now);
  }

  path(steps: number, now: number): void {
    this.setMood('happy', now, 2000);
    this.acts.push('wiggle');
    this.say(t().petPath(steps), now);
  }

  timeMachine(now: number): void {
    if (this.quietFor(20_000, now)) this.say(t().petTime, now, { force: true });
  }

  tour(now: number): void {
    this.say(t().petTour, now, { force: true });
  }

  /** You pinched it. */
  poke(now: number): void {
    this.lastActive = now;
    this.acts.push('hearts');
    if (this.mood === 'sleep') {
      this.setMood('surprised', now, 900);
      this.acts.push('hop');
      this.say(this.pick(t().petWake), now, { force: true });
      return;
    }
    this.setMood('love', now, 1600);
    this.acts.push(this.pick(['hop', 'wiggle', 'spin'] as const));
    if (this.world.suggestions().length && this.rand() < 0.65)
      this.say(this.pick(t().petPokeFind), now, { action: { kind: 'next' }, label: t().petShow, force: true });
    else this.say(this.pick(t().petPoke), now, { force: true, ms: 2600 });
  }
}

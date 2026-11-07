/**
 * The companion's mind. It doesn't decorate, it notices, and every remark comes with something to do:
 *   - you open a note that may belong with another one: it says which, and why, with Show / Connect /
 *     Not related right on its bubble;
 *   - a poke always gives you the next possible link (or a question between topics);
 *   - a link you just made, a note you just wrote: a small reaction.
 * Rules that keep it a help and never a nuisance:
 *   - it never speaks while you write, and stays quiet for a while after each remark
 *   - an ambient thought at most every 3 minutes, and only while you are active
 *   - it falls asleep when you are away (75 s) and greets you when you come back
 *   - "chatty" off: it only answers when you poke it
 * Pure: time comes in through `now`, randomness through `rand`, words through `t()`.
 */
import { t } from '../../app/i18n';

export type Mood = 'idle' | 'happy' | 'love' | 'sleep' | 'surprised' | 'curious';
export type Act = 'hop' | 'wiggle' | 'spin' | 'nod' | 'look' | 'hearts' | 'wave';

/** What a button on the bubble does. */
export type SpeechButton = 'show' | 'connect' | 'dismiss' | 'next' | 'insights';

export interface Speech {
  text: string;
  /** a second, quieter line: why it thinks so */
  sub?: string;
  buttons: SpeechButton[];
  /** the two notes a suggestion is about */
  pair?: [string, string];
  /** when it stops showing (ms clock) */
  until: number;
}

export interface Suggestion {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** one line: why they may belong together */
  why: string;
}

export interface WorldView {
  /** possible links not yet made / dismissed, best first */
  suggestions(): Suggestion[];
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
}

interface SayOpts {
  buttons?: SpeechButton[];
  sub?: string;
  pair?: [string, string];
  force?: boolean;
  ms?: number;
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
  private nextIndex = 0;

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
  say(text: string, now: number, opts: SayOpts = {}): boolean {
    if (!this.enabled) return false;
    if (!this.chatty && !opts.force) return false;
    if (this.world.writing() && !opts.force) return false;
    const buttons = opts.buttons ?? [];
    const chars = text.length + (opts.sub?.length ?? 0);
    // something to act on stays long enough to read and reach (up to 20 s)
    const dur = opts.ms ?? Math.min(buttons.length ? 20000 : 9000, 2600 + chars * 110 + (buttons.length ? 6000 : 0));
    this.speech = { text, sub: opts.sub, buttons, pair: opts.pair, until: now + dur };
    this.lastSpoke = now;
    return true;
  }

  hush(): void {
    this.speech = null;
  }

  /** Put one possible link in front of you: what, why, and the buttons to show / connect / dismiss it. */
  present(s: Suggestion, now: number, force = false): boolean {
    this.focus = [s.a, s.b];
    this.setMood('curious', now, 2500);
    this.acts.push('look');
    return this.say(t().petRelated(s.aName, s.bName), now, { sub: s.why, buttons: ['show', 'connect', 'dismiss'], pair: [s.a, s.b], force });
  }

  /** The next possible link (cycles through them). */
  presentNext(now: number, force = true): boolean {
    const all = this.world.suggestions();
    if (!all.length) return false;
    return this.present(all[this.nextIndex++ % all.length]!, now, force);
  }

  /** How many possible links are waiting (shown as a small badge). */
  get waiting(): number {
    return this.enabled ? this.world.suggestions().length : 0;
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
    if (this.world.writing() && this.speech && !this.speech.buttons.length) this.speech = null;
    const idle = now - this.lastActive;
    if (idle > 75_000 && this.mood !== 'sleep' && !this.world.busy()) {
      this.hush();
      this.setMood('sleep', now);
    }
    const free = !this.world.writing() && !this.world.busy() && !this.speech;
    if (this.chatty && free && idle < 30_000 && now - this.lastAmbient > 180_000 && this.quietFor(45_000, now)) {
      this.lastAmbient = now;
      const qs = this.world.questions();
      const sug = this.world.suggestions();
      if (qs.length && (this.rand() < 0.4 || !sug.length)) this.say(t().petWonder(this.pick(qs.slice(0, 3))), now, { buttons: ['insights'] });
      else if (sug.length) this.presentNext(now, false);
    }
  }

  /** Insights are ready (first time: greet). */
  insightsReady(now: number, hour: number): void {
    if (this.greeted) return;
    this.greeted = true;
    const n = Math.min(8, this.world.suggestions().length);
    this.acts.push('wave');
    this.setMood('happy', now, 2200);
    this.say(t().petGreet(hour) + (n ? t().petFound(n) : ''), now, n ? { buttons: ['next'] } : {});
  }

  /** You opened a note. */
  opened(note: NoteSeen, now: number): void {
    if (note.path === this.lastNote) return;
    this.lastNote = note.path;
    this.focus = [note.path];
    if (this.mood === 'sleep') return;
    this.acts.push('look');
    if (!this.quietFor(8_000, now) || this.world.busy()) return;
    // the best possible link involving the note you just opened, every time there is one
    const s = this.world.suggestions().find((x) => x.a === note.path || x.b === note.path);
    if (s) this.present(s.a === note.path ? s : { a: s.b, b: s.a, aName: s.bName, bName: s.aName, why: s.why }, now);
    else if (note.backlinks === 0 && this.rand() < 0.5) this.say(t().petLonely, now);
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
    // a poke always gives you something useful when there is something to give
    if (!this.presentNext(now, true)) {
      const qs = this.world.questions();
      if (qs.length) this.say(t().petWonder(qs[0]!), now, { buttons: ['insights'], force: true });
      else this.say(this.pick(t().petPoke), now, { force: true, ms: 2600 });
    }
  }
}

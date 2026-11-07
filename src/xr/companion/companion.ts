/**
 * Mochi, the companion's body: a soft round creature (an original design made of simple shapes) that
 * sits just outside the lower-left corner of the card you are reading, a little in front of it, so it
 * is in view whenever you read and never hidden behind the card or covering its text. With no card
 * open it waits at the left end of the menu. A small gold badge shows how many possible links it has
 * found; its bubble says what and why, with buttons to act on it. A pinch on Mochi pokes it.
 *
 * Human factors: it moves with the card (never head-locked), its idle motion is a slow 5 mm bob, the
 * bubble is drawn on top so nothing hides it, and it steps aside while you write, search or read the
 * insights panel.
 */
import {
  CanvasTexture,
  Color,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { COLORS } from '../theme';
import { drawButton, font, roundRect, wrap, type Ctx } from '../ui/draw';
import { Surface } from '../ui/surface';
import { t } from '../../app/i18n';
import type { Act, Mood, Speech, SpeechButton } from './brain';
import { damp, follow } from '../motion/ease';

const BODY = '#ffd6e0';
const MOOD_TINT: Record<Mood, string> = {
  idle: BODY,
  happy: '#ffe1b0',
  love: '#ffc2d6',
  sleep: '#d9d6ec',
  surprised: '#fff0c4',
  curious: '#d3ecff',
};

function toonRamp(): DataTexture {
  const tex = new DataTexture(new Uint8Array([110, 185, 255]), 3, 1, RedFormat);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const BW = 960;
const BH = 440;

const label = (b: SpeechButton): string => {
  const tr = t();
  return { show: tr.petBtnShow, connect: tr.petBtnConnect, dismiss: tr.petBtnDismiss, next: tr.petShow, insights: tr.petInsights }[b];
};

/** The speech bubble: what it noticed, why, and up to three buttons. Drawn on top of everything. */
export class Bubble extends Surface {
  speech: Speech | null = null;

  constructor() {
    super(0.36, BW, BH);
    this.mesh.name = 'companion-bubble';
    this.mesh.renderOrder = 40;
    this.mesh.material.depthTest = false;
  }

  set(s: Speech | null): void {
    if (s === this.speech) return;
    this.speech = s;
    this.mesh.visible = !!s;
    this.invalidate();
  }

  protected paint(ctx: Ctx): void {
    ctx.clearRect(0, 0, BW, BH);
    const s = this.speech;
    if (!s) return;
    const n = s.buttons.length;
    ctx.font = font(44, 650);
    const lines = wrap(ctx, s.text, BW - 110, 2);
    ctx.font = font(32, 400);
    const subs = s.sub ? wrap(ctx, s.sub, BW - 110, 2) : [];
    const h = 50 + lines.length * 56 + subs.length * 42 + (subs.length ? 10 : 0) + (n ? 100 : 0);
    const y0 = BH - h - 6;
    roundRect(ctx, 6, y0, BW - 12, h, 40);
    ctx.fillStyle = 'rgba(14,20,38,0.96)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,214,224,0.6)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.font = font(44, 650);
    ctx.fillStyle = COLORS.text;
    lines.forEach((l, i) => ctx.fillText(l, 50, y0 + 50 + i * 56));
    ctx.font = font(32, 400);
    ctx.fillStyle = COLORS.textDim;
    const subY = y0 + 50 + lines.length * 56 - 6;
    subs.forEach((l, i) => ctx.fillText(l, 50, subY + i * 42));
    let x = 44;
    const by = y0 + h - 96;
    for (const b of s.buttons) {
      ctx.font = font(32, 700);
      const w = Math.max(170, ctx.measureText(label(b)).width + 60);
      const r = { x, y: by, w, h: 76 };
      drawButton(ctx, r, label(b), b === 'dismiss' ? 'ghost' : b === 'connect' ? 'primary' : 'gold', this.isHover(b), 32);
      this.hit({ id: b, ...r });
      x += w + 16;
    }
    ctx.textBaseline = 'alphabetic';
  }
}

function badgeTexture(n: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fillStyle = COLORS.gold;
  g.fill();
  g.fillStyle = '#1a1206';
  g.font = font(n > 9 ? 40 : 50, 800);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n > 99 ? '99' : String(n), 48, 52);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface Anim {
  kind: Act;
  t: number;
  dur: number;
}

const DUR: Record<Act, number> = { hop: 0.45, wiggle: 0.6, spin: 0.7, nod: 0.4, look: 0.5, hearts: 1.2, wave: 0.9 };

export class Companion {
  readonly group = new Group();
  /** the pokable body (a ray target) */
  readonly body = new Group();
  readonly bubble = new Bubble();
  private readonly skin: MeshToonMaterial;
  private readonly eyes: Mesh[] = [];
  private readonly arms: Mesh[] = [];
  private readonly hearts: Sprite;
  private readonly badge: Sprite;
  private badgeN = -1;
  private anims: Anim[] = [];
  private time = 0;
  private blinkAt = 2;
  private fade = 0;
  private tint = new Color(BODY);
  shown = 1;

  constructor() {
    this.group.name = 'companion';
    this.skin = new MeshToonMaterial({ color: BODY, gradientMap: toonRamp() });
    const torso = new Mesh(new SphereGeometry(0.5, 28, 20), this.skin);
    torso.scale.set(1, 0.86, 0.92);
    torso.position.y = 0.43;
    this.body.add(torso);
    const ink = new MeshBasicMaterial({ color: '#3b3446' });
    const shine = new MeshBasicMaterial({ color: '#ffffff' });
    const blush = new MeshBasicMaterial({ color: '#ff9fb5', transparent: true, opacity: 0.55 });
    for (const s of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.065, 14, 10), ink);
      eye.position.set(s * 0.16, 0.5, 0.42);
      const hi = new Mesh(new SphereGeometry(0.022, 8, 6), shine);
      hi.position.set(0.02, 0.025, 0.05);
      eye.add(hi);
      this.eyes.push(eye);
      const cheek = new Mesh(new SphereGeometry(0.07, 12, 8), blush);
      cheek.scale.set(1, 0.55, 0.3);
      cheek.position.set(s * 0.29, 0.39, 0.39);
      const arm = new Mesh(new SphereGeometry(0.11, 14, 10), this.skin);
      arm.scale.set(0.8, 1.15, 0.8);
      arm.position.set(s * 0.46, 0.32, 0.05);
      this.arms.push(arm);
      this.body.add(eye, cheek, arm);
    }
    // a tiny leaf on top, its one accessory
    const leaf = new Mesh(new SphereGeometry(0.07, 10, 8), new MeshToonMaterial({ color: '#8fe3b0', gradientMap: toonRamp() }));
    leaf.scale.set(1.5, 0.35, 0.8);
    leaf.position.set(0.05, 0.86, 0);
    leaf.rotation.z = -0.4;
    this.body.add(leaf);
    this.hearts = new Sprite(new SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false, opacity: 0 }));
    this.hearts.scale.setScalar(0.35);
    this.hearts.raycast = () => undefined;
    this.body.add(this.hearts);
    this.badge = new Sprite(new SpriteMaterial({ map: badgeTexture(0), transparent: true, depthTest: false }));
    this.badge.scale.setScalar(0.32);
    this.badge.position.set(0.42, 0.9, 0.1);
    this.badge.renderOrder = 41;
    this.badge.raycast = () => undefined;
    this.badge.visible = false;
    this.group.add(this.badge);
    this.group.traverse((o) => {
      if (o !== this.badge) o.renderOrder = 30;
    });
    this.group.add(this.body);
    this.bubble.mesh.visible = false;
  }

  /** How many possible links are waiting (0 hides the badge). */
  setBadge(n: number): void {
    if (n === this.badgeN) return;
    this.badgeN = n;
    this.badge.visible = n > 0;
    if (n > 0) {
      this.badge.material.map?.dispose();
      this.badge.material.map = badgeTexture(n);
      this.badge.material.needsUpdate = true;
    }
  }

  play(a: Act): void {
    this.anims = this.anims.filter((x) => x.kind !== a);
    this.anims.push({ kind: a, t: 0, dur: DUR[a] });
  }

  /**
   * Per frame. `at`: where it floats (world), `eye`: your head, `size`: body height (m),
   * `look`: optional point it should glance at (the note it talks about).
   */
  update(dt: number, at: Vector3, eye: Vector3, size: number, mood: Mood, speech: Speech | null, reduced: boolean, look?: Vector3 | null): void {
    this.time += dt;
    this.fade = damp(this.fade, this.shown, this.shown ? 5 : 10, dt); // steps aside quickly, returns gently
    this.group.visible = this.fade > 0.02;
    if (!this.group.visible) {
      this.bubble.mesh.visible = false;
      return;
    }
    const first = this.group.position.lengthSq() === 0;
    if (first) this.group.position.copy(at);
    else this.group.position.lerp(at, follow(4, dt));
    this.group.scale.setScalar(size * (0.6 + 0.4 * this.fade));
    // face you, glancing a little towards what it talks about
    const target = eye.clone();
    if (look) target.lerp(look, 0.3);
    this.group.lookAt(target.x, this.group.position.y, target.z);

    this.tint.lerp(new Color(MOOD_TINT[mood]), follow(3, dt));
    this.skin.color.copy(this.tint);
    // idle: a slow bob (5 mm at 0.45 Hz), a blink every few seconds, sleep = eyes shut, slow breathing
    let y = reduced ? 0 : Math.sin(this.time * 2.8) * 0.05;
    let rotY = 0;
    let rotZ = 0;
    let sx = 1;
    let sy = 1;
    let armWave = 0;
    const sleep = mood === 'sleep';
    if (sleep && !reduced) sy = 1 + Math.sin(this.time * 1.6) * 0.03;
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt <= 0) this.blinkAt = 2.5 + ((this.time * 7.3) % 3);
    const eyeY = sleep ? 0.12 : blink ? 0.15 : mood === 'surprised' ? 1.25 : 1;
    for (const e of this.eyes) e.scale.set(1, eyeY, 1);
    let heartsA = 0;
    for (const a of this.anims) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (reduced && a.kind !== 'hearts') continue;
      switch (a.kind) {
        case 'hop':
          y += Math.sin(k * Math.PI) * 0.22;
          sy *= 1 + Math.sin(k * Math.PI * 2) * 0.06;
          break;
        case 'wiggle':
          rotZ += Math.sin(k * Math.PI * 4) * 0.18 * (1 - k);
          break;
        case 'spin':
          rotY += k * Math.PI * 2;
          break;
        case 'nod':
          sy *= 1 - Math.sin(k * Math.PI) * 0.08;
          sx *= 1 + Math.sin(k * Math.PI) * 0.05;
          break;
        case 'look':
          rotY += Math.sin(k * Math.PI) * 0.35;
          break;
        case 'wave':
          armWave = Math.sin(k * Math.PI * 4) * (1 - k);
          break;
        case 'hearts':
          heartsA = Math.sin(k * Math.PI);
          this.hearts.position.set(0.3, 0.9 + k * 0.4, 0.1);
          break;
      }
    }
    this.anims = this.anims.filter((a) => a.t < a.dur);
    this.body.position.y = y;
    this.body.rotation.set(0, rotY, rotZ);
    this.body.scale.set(sx, sy, sx);
    this.arms[1]!.rotation.z = armWave * 1.2;
    this.hearts.material.opacity = heartsA;
    this.hearts.visible = heartsA > 0.01;

    // bubble: just above it, reaching left (away from the card's text), facing you
    this.bubble.set(this.fade > 0.5 ? speech : null);
    if (this.bubble.mesh.visible) {
      const toEye = eye.clone().sub(this.group.position).setY(0).normalize();
      const right = new Vector3().crossVectors(new Vector3(0, 1, 0), toEye).normalize();
      const p = this.group.position
        .clone()
        .addScaledVector(right, -(this.bubble.widthM / 2 - size * 0.6))
        .addScaledVector(toEye, 0.01)
        .setY(this.group.position.y + size * 1.05 + this.bubble.heightM / 2);
      this.bubble.mesh.position.copy(p);
      this.bubble.mesh.lookAt(eye);
      this.bubble.update();
    }
  }
}

function heartTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = COLORS.danger;
  g.font = '96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♥', 64, 70);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

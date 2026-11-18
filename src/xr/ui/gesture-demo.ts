/**
 * The guide's 3D demonstration: translucent "ghost" hands that do the movement in front of you, and the
 * scene answering them (a star lights up and its card opens, a link is drawn, the map appears over the
 * palm, the map grows between two hands, the menu shows…). It hangs just under the guide card, so you
 * can watch it from any angle and copy it with your own hands.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from '@iwsdk/core';
import type { Gesture } from './hint';

const GHOST = new Color('#9fe9ff');
const ACCENT = new Color('#5ee7ff');
const GOLD = new Color('#ffd166');
const ORANGE = new Color('#ffb86b');

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
/** 0→1→0 over one loop of `period` seconds, holding a moment at each end */
function cycle(time: number, period: number): number {
  const p = (time % period) / period;
  if (p < 0.2) return 0;
  if (p < 0.4) return ease((p - 0.2) / 0.2);
  if (p < 0.7) return 1;
  if (p < 0.9) return 1 - ease((p - 0.7) / 0.2);
  return 0;
}

function ghost(color = GHOST, opacity = 0.55): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending });
}

/** A stylised hand: palm, four fingers in two segments, a thumb. Local units: metres, fingers up (+y), palm facing +z. */
class GhostHand {
  readonly root = new Group();
  private readonly fingers: { base: Group; tip: Group }[] = [];
  private readonly thumb: { base: Group; tip: Group };
  private readonly pinchDot: Mesh;
  private readonly palmMark: Mesh;

  constructor(mirror = false) {
    const mat = ghost();
    const palm = new Mesh(new SphereGeometry(0.5, 20, 14), mat);
    palm.scale.set(0.075, 0.08, 0.024);
    this.root.add(palm);
    // which side is the palm: a soft disc on it, so a turning hand reads
    this.palmMark = new Mesh(new CircleGeometry(0.022, 24), ghost(ACCENT, 0.5));
    this.palmMark.position.set(0, -0.005, 0.0125);
    this.root.add(this.palmMark);
    const xs = [-0.027, -0.009, 0.009, 0.026];
    const lens = [0.03, 0.034, 0.032, 0.025];
    xs.forEach((x, i) => {
      const len = lens[i]!;
      const base = new Group();
      base.position.set(mirror ? -x : x, 0.036, 0);
      const a = new Mesh(new CapsuleGeometry(0.0075, len, 4, 10), mat);
      a.position.y = len / 2;
      base.add(a);
      const tip = new Group();
      tip.position.y = len + 0.002;
      const b = new Mesh(new CapsuleGeometry(0.0068, len * 0.85, 4, 10), mat);
      b.position.y = (len * 0.85) / 2;
      tip.add(b);
      base.add(tip);
      this.root.add(base);
      this.fingers.push({ base, tip });
    });
    const s = mirror ? -1 : 1;
    const tb = new Group();
    tb.position.set(0.034 * s * -1, -0.012, 0.006);
    tb.rotation.z = 0.75 * s;
    const ta = new Mesh(new CapsuleGeometry(0.0085, 0.026, 4, 10), mat);
    ta.position.y = 0.013;
    tb.add(ta);
    const tt = new Group();
    tt.position.y = 0.028;
    const tm = new Mesh(new CapsuleGeometry(0.0075, 0.022, 4, 10), mat);
    tm.position.y = 0.011;
    tt.add(tm);
    tb.add(tt);
    this.root.add(tb);
    this.thumb = { base: tb, tip: tt };
    this.pinchDot = new Mesh(new SphereGeometry(0.009, 12, 8), ghost(ACCENT, 0.95));
    this.pinchDot.visible = false;
    this.root.add(this.pinchDot);
    void s;
  }

  /** 0: open hand, 1: thumb and index tips together (a pinch). */
  pinch(p: number, mirror = false): void {
    const s = mirror ? -1 : 1;
    const idx = this.fingers[0]!;
    // index curls forward, the others curl a little less; the thumb swings in to meet the index
    idx.base.rotation.x = 0.95 * p;
    idx.tip.rotation.x = 0.9 * p;
    for (let i = 1; i < 4; i++) {
      this.fingers[i]!.base.rotation.x = 0.35 * p;
      this.fingers[i]!.tip.rotation.x = 0.3 * p;
    }
    this.thumb.base.rotation.z = (0.75 - 0.55 * p) * s;
    this.thumb.base.rotation.x = 0.7 * p;
    this.thumb.tip.rotation.x = 0.35 * p;
    this.pinchDot.visible = p > 0.85;
    this.pinchDot.position.set(-0.03 * s, 0.062, 0.032);
  }
}

/** A small star: a bright core and a halo that lights up. */
class Star {
  readonly root = new Group();
  private readonly halo: Mesh<RingGeometry, MeshBasicMaterial>;
  constructor(color: Color, r = 0.012) {
    this.root.add(new Mesh(new SphereGeometry(r, 16, 12), ghost(color, 0.95)));
    this.halo = new Mesh(new RingGeometry(r * 1.5, r * 2.2, 28), ghost(color, 0));
    this.root.add(this.halo);
  }
  light(k: number): void {
    this.halo.material.opacity = 0.8 * k;
    this.halo.scale.setScalar(1 + 0.6 * k);
  }
}

function segmentLine(color: Color): Line<BufferGeometry, LineBasicMaterial> {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  return new Line(g, new LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
}

function setLine(l: Line<BufferGeometry, LineBasicMaterial>, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const p = l.geometry.getAttribute('position') as Float32BufferAttribute;
  p.setXYZ(0, ax, ay, az);
  p.setXYZ(1, bx, by, bz);
  p.needsUpdate = true;
  l.geometry.computeBoundingSphere();
}

/** A tiny constellation (the map). */
function cluster(): Group {
  const g = new Group();
  const pts: [number, number, number][] = [
    [-0.03, 0.01, 0],
    [0, 0.035, 0.01],
    [0.028, 0.012, -0.008],
    [-0.008, -0.018, 0.012],
    [0.02, -0.022, 0],
  ];
  const cols = [ACCENT, GOLD, ACCENT, ORANGE, ACCENT];
  pts.forEach(([x, y, z], i) => {
    const m = new Mesh(new SphereGeometry(0.006, 10, 8), ghost(cols[i]!, 0.95));
    m.position.set(x, y, z);
    g.add(m);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const l = segmentLine(ACCENT);
    l.material.opacity = 0.5;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    setLine(l, a[0], a[1], a[2], b[0], b[1], b[2]);
    g.add(l);
  }
  const ring = new Mesh(new RingGeometry(0.052, 0.056, 40), ghost(ACCENT, 0.35));
  g.add(ring);
  return g;
}

export class GestureDemo {
  readonly root = new Group();
  private readonly right = new GhostHand();
  private readonly left = new GhostHand(true);
  private readonly starA = new Star(ACCENT);
  private readonly starB = new Star(ORANGE);
  private readonly card: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly link = segmentLine(GOLD);
  private readonly band = segmentLine(GHOST);
  private readonly map = cluster();
  private readonly wall: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly arrow: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly bar: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private gesture: Gesture = 'none';
  private time = 0;
  private arrowK = 0;

  constructor() {
    this.root.name = 'gesture-demo';
    this.card = new Mesh(new PlaneGeometry(0.07, 0.05), ghost(ACCENT, 0));
    this.wall = new Mesh(new PlaneGeometry(0.07, 0.05), ghost(GOLD, 0));
    this.arrow = new Mesh(new RingGeometry(0.07, 0.078, 32, 1, Math.PI / 2, 0.01), ghost(ACCENT, 0.8));
    this.bar = new Mesh(new PlaneGeometry(0.12, 0.022), ghost(ACCENT, 0));
    // a dark stage behind the ghosts, so they read clearly against the stars
    const stage = new Mesh(new CircleGeometry(0.15, 48), new MeshBasicMaterial({ color: '#060b18', transparent: true, opacity: 0.82, depthWrite: false }));
    stage.scale.set(1.45, 0.82, 1);
    stage.position.set(0, 0.01, -0.05);
    const rim = new Mesh(new RingGeometry(0.148, 0.151, 64), ghost(ACCENT, 0.35));
    rim.scale.copy(stage.scale);
    rim.position.copy(stage.position);
    this.root.add(stage, rim);
    this.root.add(
      this.right.root,
      this.left.root,
      this.starA.root,
      this.starB.root,
      this.card,
      this.link,
      this.band,
      this.map,
      this.wall,
      this.arrow,
      this.bar,
    );
    this.root.traverse((o) => {
      o.raycast = () => undefined; // never in the way of a pinch
      o.renderOrder = 30;
    });
    this.set('none');
  }

  set(g: Gesture): void {
    if (g === this.gesture) return;
    this.gesture = g;
    this.time = 0;
    this.root.visible = g !== 'none';
  }

  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;
    const t = this.time;
    const R = this.right;
    const L = this.left;
    // everything off, then each gesture switches on what it needs
    for (const o of [R.root, L.root, this.starA.root, this.starB.root, this.card, this.link, this.band, this.map, this.wall, this.arrow, this.bar])
      o.visible = false;
    R.root.rotation.set(0, 0, 0);
    L.root.rotation.set(0, 0, 0);
    this.map.scale.setScalar(1);
    this.map.rotation.set(0, 0, 0);
    switch (this.gesture) {
      case 'pinch':
      case 'tap': {
        // point at a star and pinch: it lights up and its card opens
        const p = cycle(t, 2.4);
        R.root.visible = this.starA.root.visible = this.card.visible = this.band.visible = true;
        R.root.position.set(0.02, -0.06, 0.05);
        R.root.rotation.set(-0.25, 0.35, 0);
        R.pinch(p);
        this.starA.root.position.set(-0.06, 0.06, -0.02);
        this.starA.light(p);
        setLine(this.band, -0.012, 0.0, 0.085, -0.06, 0.06, -0.02);
        this.band.material.opacity = 0.35 + 0.4 * p;
        this.card.position.set(0.06, 0.07, -0.03);
        this.card.material.opacity = 0.35 * seg(p, 0.6, 1);
        this.card.scale.setScalar(0.6 + 0.4 * ease(seg(p, 0.6, 1)));
        break;
      }
      case 'drag': {
        // pinch a star, carry it onto another, let go: a gold link
        const period = 3.4;
        const ph = (t % period) / period;
        const grab = ph < 0.15 ? ease(ph / 0.15) : ph < 0.72 ? 1 : 1 - ease(clamp01((ph - 0.72) / 0.1));
        const move = ph < 0.18 ? 0 : ph < 0.62 ? ease((ph - 0.18) / 0.44) : 1;
        R.root.visible = this.starA.root.visible = this.starB.root.visible = true;
        const ax = -0.08;
        const bx = 0.08;
        R.root.position.set(ax + (bx - ax) * move + 0.03, -0.05, 0.06);
        R.root.rotation.set(-0.3, 0.3, 0);
        R.pinch(grab);
        this.starA.root.position.set(ax, 0.05, 0);
        this.starB.root.position.set(bx, 0.05, 0);
        this.starA.light(grab * 0.6);
        this.starB.light(move > 0.95 ? 1 : 0);
        this.band.visible = grab > 0.5 && ph < 0.75;
        setLine(this.band, ax, 0.05, 0, ax + (bx - ax) * move, 0.05, 0);
        this.link.visible = ph > 0.72;
        setLine(this.link, ax, 0.05, 0, bx, 0.05, 0);
        break;
      }
      case 'palm': {
        // the left hand turns its palm towards you: the map appears over it
        const turn = cycle(t, 3.0);
        L.root.visible = true;
        L.root.position.set(0, -0.05, 0.03);
        L.root.rotation.y = Math.PI * (1 - turn);
        L.pinch(0, true);
        this.map.visible = turn > 0.7;
        this.map.position.set(0, 0.07, 0.03);
        this.map.scale.setScalar(ease(seg(turn, 0.7, 1)));
        this.map.rotation.y = t * 0.6;
        break;
      }
      case 'twohand': {
        // both hands take the map, pull apart and turn it: the library grows and turns with them
        const period = 3.6;
        const ph = (t % period) / period;
        const grab = ph < 0.12 ? ease(ph / 0.12) : ph < 0.8 ? 1 : 1 - ease(clamp01((ph - 0.8) / 0.1));
        const k = ph < 0.15 ? 0 : ph < 0.7 ? ease((ph - 0.15) / 0.55) : ph < 0.85 ? 1 : 1 - ease((ph - 0.85) / 0.15);
        const spread = 0.07 + 0.045 * k;
        L.root.visible = R.root.visible = this.map.visible = true;
        L.root.position.set(-spread - 0.02, -0.03, 0.05);
        R.root.position.set(spread + 0.02, -0.03, 0.05);
        L.root.rotation.set(-0.2, -0.5, 0);
        R.root.rotation.set(-0.2, 0.5, 0);
        L.pinch(grab, true);
        R.pinch(grab);
        this.map.position.set(0, 0.03, 0.02);
        this.map.scale.setScalar(0.9 + 0.6 * k);
        this.map.rotation.z = -0.5 * k;
        break;
      }
      case 'look': {
        // turn to the left: an arrow sweeps that way, and the wall lights up over there
        const k = ease(seg(t % 2.6, 0, 1.4));
        this.arrow.visible = this.wall.visible = true;
        if (Math.abs(k - this.arrowK) > 0.02) {
          this.arrowK = k;
          this.arrow.geometry.dispose();
          this.arrow.geometry = new RingGeometry(0.07, 0.078, 32, 1, Math.PI / 2, 0.01 + 1.3 * k);
        }
        this.arrow.position.set(0, -0.02, 0);
        this.wall.position.set(-0.11, 0.03, -0.03);
        this.wall.rotation.y = 0.6;
        this.wall.material.opacity = 0.15 + 0.35 * k;
        break;
      }
      case 'menu': {
        // the left hand alone: palm towards you, then a quick pinch of that same hand toggles the menu bar
        const period = 3.0;
        const ph = (t % period) / period;
        const turn = ph < 0.3 ? ease(ph / 0.3) : ph < 0.85 ? 1 : 1 - ease((ph - 0.85) / 0.15);
        const p = ph > 0.36 && ph < 0.6 ? Math.sin(((ph - 0.36) / 0.24) * Math.PI) : 0;
        L.root.visible = this.bar.visible = true;
        R.root.visible = false;
        L.root.position.set(0, -0.04, 0.04);
        L.root.rotation.y = Math.PI * (1 - turn);
        L.pinch(p, true);
        this.bar.position.set(0, 0.07, 0);
        this.bar.material.opacity = ph > 0.55 && ph < 0.95 ? 0.45 * Math.min(1, (ph - 0.55) / 0.08) : 0;
        break;
      }
      case 'none':
        break;
    }
  }
}

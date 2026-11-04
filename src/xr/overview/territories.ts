/**
 * Seeing the whole while reading a part: every topic the insight engine found gets a faint coloured
 * glow around its notes and a name label; bridge notes (holding several topics together) get a gold
 * ring. Labels sit on one row just above the graph, in the left-to-right order of their territories,
 * pushed apart so they never overlap, with a thin leader line down to each territory. A territory
 * fades when your head is inside it (you are reading there, not surveying).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  NormalBlending,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Bridge, Topic } from '../../core/insights/engine';
import type { GraphView } from '../graph/graph-view';
import { Label, TOPIC_LABEL } from '../graph/labels';
import { TOPIC_COLORS } from '../theme';

function radialTexture(draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const glow = (): CanvasTexture =>
  radialTexture((g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grd.addColorStop(0.8, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });

const ring = (): CanvasTexture =>
  radialTexture((g) => {
    g.strokeStyle = 'rgba(255,209,102,1)';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.stroke();
  });

interface Item {
  topic: Topic;
  halo: Sprite;
  label: Label;
  color: string;
  centre: Vector3;
  r: number;
  alpha: number;
}

const smooth = (x: number, a: number, b: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Territories {
  readonly group = new Group();
  private items: Item[] = [];
  private rings: { id: string; sprite: Sprite }[] = [];
  private readonly glowTex = glow();
  private readonly ringTex = ring();
  private readonly leaders: LineSegments<BufferGeometry, LineBasicMaterial>;
  private sig = '';
  /** 0..1, eased towards `target` every frame */
  private shown = 0;
  target = 0;
  passthrough = false;
  /** highest the label row may sit, as an angle above the eyes (a flat window shows much less) */
  maxElevationDeg = 18;

  constructor(private readonly graph: GraphView) {
    this.group.visible = false;
    graph.root.add(this.group);
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(TOPIC_COLORS.length * 6), 3));
    lg.setAttribute('color', new BufferAttribute(new Float32Array(TOPIC_COLORS.length * 6), 3));
    this.leaders = new LineSegments(lg, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.leaders.frustumCulled = false;
    this.leaders.raycast = () => undefined;
    this.group.add(this.leaders);
  }

  set(topics: Topic[], bridges: Bridge[]): void {
    const sig = JSON.stringify([topics.map((t) => [t.name, t.members.length]), bridges.map((b) => b.id)]);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const it of this.items) {
      it.halo.material.dispose();
      it.halo.removeFromParent();
      it.label.dispose();
    }
    for (const r of this.rings) {
      r.sprite.material.dispose();
      r.sprite.removeFromParent();
    }
    this.items = [];
    this.rings = [];
    topics.slice(0, TOPIC_COLORS.length).forEach((topic, i) => {
      const color = TOPIC_COLORS[i]!;
      const halo = new Sprite(new SpriteMaterial({ map: this.glowTex, color, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 }));
      halo.renderOrder = -1;
      halo.raycast = () => undefined;
      const label = new Label();
      label.set(topic.name, TOPIC_LABEL, color);
      label.sprite.center.set(0.5, 0.5);
      label.sprite.renderOrder = 7;
      this.group.add(halo, label.sprite);
      this.items.push({ topic, halo, label, color, centre: new Vector3(), r: 1, alpha: 0 });
    });
    for (const b of bridges.slice(0, 12)) {
      const sprite = new Sprite(new SpriteMaterial({ map: this.ringTex, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.renderOrder = 6;
      sprite.raycast = () => undefined;
      this.group.add(sprite);
      this.rings.push({ id: b.id, sprite });
    }
  }

  update(dt: number, head: Vector3): void {
    this.shown += (this.target - this.shown) * Math.min(1, dt * 4);
    this.group.visible = this.shown > 0.01 && this.items.length > 0;
    if (!this.group.visible) return;
    const g = this.graph;
    const root = g.root;
    root.updateMatrixWorld();
    const s = root.scale.x;
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    const headL = head.clone().applyMatrix4(inv);
    let top = -Infinity;
    for (const p of g.positions) top = Math.max(top, p.clone().applyMatrix4(root.matrixWorld).y);
    const shownItems: Item[] = [];
    for (const it of this.items) {
      const pts = it.topic.members.map((id) => g.positions[g.index.get(id) ?? -1]).filter((p): p is Vector3 => !!p);
      if (!pts.length) {
        it.halo.visible = it.label.sprite.visible = false;
        continue;
      }
      it.centre.set(0, 0, 0);
      for (const p of pts) it.centre.add(p);
      it.centre.divideScalar(pts.length);
      const d = pts.map((p) => p.distanceTo(it.centre)).sort((a, b) => a - b);
      it.r = Math.max(d[Math.floor(d.length * 0.85)] ?? 0, 0.06 / s) + 0.05 / s;
      const inside = smooth(headL.distanceTo(it.centre), it.r * 0.9, it.r * 1.7);
      const a = this.shown * inside;
      it.alpha = a;
      it.halo.visible = it.label.sprite.visible = a > 0.01;
      it.halo.position.copy(it.centre);
      it.halo.scale.setScalar(it.r * 2.3);
      it.halo.material.opacity = (this.passthrough ? 0.16 : 0.1) * a;
      it.halo.material.blending = this.passthrough ? NormalBlending : AdditiveBlending;
      it.label.opacity = 0.95 * a;
      if (a > 0.01) shownItems.push(it);
    }
    // the label row above the graph, ordered left to right as seen from where you are
    const C = new Vector3().setFromMatrixPosition(root.matrixWorld);
    const view = C.clone().sub(head).setY(0);
    if (view.lengthSq() < 1e-6) view.set(0, 0, -1);
    view.normalize();
    const right = new Vector3().crossVectors(view, new Vector3(0, 1, 0)).normalize();
    const gd = Math.max(0.6, C.distanceTo(head));
    const hw = 0.032 * gd;
    const lab = shownItems.map((it) => {
      const w = it.centre.clone().applyMatrix4(root.matrixWorld);
      return { it, w, x: w.clone().sub(C).dot(right), ww: hw * it.label.aspectRatio, row: 0 };
    });
    lab.sort((a, b) => a.x - b.x);
    const gap = 0.02 * gd;
    const total = lab.reduce((a, l) => a + l.ww + gap, 0);
    const rows = total > Math.tan((20 * Math.PI) / 180) * 2 * gd ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const row = lab.filter((_, i) => i % rows === r);
      row.forEach((l) => (l.row = r));
      for (let i = 1; i < row.length; i++) row[i]!.x = Math.max(row[i]!.x, row[i - 1]!.x + (row[i - 1]!.ww + row[i]!.ww) / 2 + gap);
      if (row.length) {
        const shift = (row[0]!.x + row[row.length - 1]!.x) / 2 - row.reduce((a, b) => a + b.w.clone().sub(C).dot(right), 0) / row.length;
        for (const l of row) l.x -= shift;
      }
    }
    const lp = this.leaders.geometry.getAttribute('position') as BufferAttribute;
    const lc = this.leaders.geometry.getAttribute('color') as BufferAttribute;
    const col = new Color();
    let k = 0;
    const baseY = Math.min(Math.max(top, head.y - 0.25) + 0.05 * gd, head.y + Math.tan((this.maxElevationDeg * Math.PI) / 180) * gd - rows * (hw + gap));
    for (const l of lab) {
      const pos = C.clone()
        .addScaledVector(right, l.x)
        .addScaledVector(view, -0.15 * gd);
      pos.y = baseY + hw / 2 + l.row * (hw + gap);
      l.it.label.sprite.position.copy(pos.clone().applyMatrix4(inv));
      l.it.label.setHeight(hw, s);
      const foot = pos.clone();
      foot.y -= hw / 2;
      const fl = foot.applyMatrix4(inv);
      lp.setXYZ(k, fl.x, fl.y, fl.z);
      lp.setXYZ(k + 1, l.it.centre.x, l.it.centre.y, l.it.centre.z);
      col.set(l.it.color).multiplyScalar(l.it.alpha);
      lc.setXYZ(k, col.r, col.g, col.b);
      lc.setXYZ(k + 1, col.r * 0.3, col.g * 0.3, col.b * 0.3);
      k += 2;
    }
    this.leaders.geometry.setDrawRange(0, k);
    lp.needsUpdate = true;
    lc.needsUpdate = true;
    for (const r of this.rings) {
      const i = g.index.get(r.id);
      const p = i === undefined ? undefined : g.positions[i];
      r.sprite.visible = !!p;
      if (!p || i === undefined) continue;
      r.sprite.position.copy(p);
      r.sprite.scale.setScalar(Math.max(g.radiusOf(i) * 3.6, 0.03 / s));
      r.sprite.material.opacity = 0.9 * this.shown;
    }
  }
}

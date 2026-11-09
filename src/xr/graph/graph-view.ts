/**
 * The knowledge graph as a "galaxy table" in front of you: stars are notes, threads are links.
 *
 * Rendering is instanced (one draw call for nodes, one for links) so a few thousand notes stay at
 * 72-90 fps on Quest. Visual hierarchy, from first principles (overview first, details on demand):
 *   - colour = topic (from the insight engine), size = how connected a note is
 *   - links inside a topic are faint, links across topics a little brighter, index pages near-silent
 *   - the selected note, its neighbours and their links light up; everything else dims
 *   - only the most important labels show from afar; closer and focused notes earn their names
 */
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  Quaternion,
  Ray,
  Vector3,
  type Camera,
} from '@iwsdk/core';
import type { Insights } from '../../core/insights/engine';
import { nodeRadius } from '../../core/layout/force';
import type { Graph, GraphNode } from '../../core/vault/vault';
import { COLORS, NO_TOPIC, TOPIC_COLORS } from '../theme';
import { FOCUS_LABEL, Label, NODE_LABEL } from './labels';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

const tmpM = new Matrix4();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const UP = new Vector3(0, 1, 0);
const tmpC = new Color();

export interface GraphStyle {
  /** passthrough (AR) uses normal blending so threads stay visible over the real room */
  passthrough: boolean;
}

export class GraphView {
  /** Positioned and scaled by the room; children live in layout units. */
  readonly root = new Group();
  nodes: GraphNode[] = [];
  links: { s: number; t: number; cross: boolean; hub: boolean }[] = [];
  readonly index = new Map<string, number>();
  positions: Vector3[] = [];

  private nodeMesh: InstancedMesh | null = null;
  /** bigger invisible spheres: easier to hit with a ray or a pinch than the visible stars */
  pickMesh: InstancedMesh | null = null;
  private linkMesh: InstancedMesh | null = null;
  private linkAlpha: InstancedBufferAttribute | null = null;
  private labels = new Map<string, Label>();
  private readonly labelGroup = new Group();
  private readonly nodeGeo = new IcosahedronGeometry(1, 2);
  private readonly linkGeo = new CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  private readonly nodeMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private readonly linkMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });

  topicOf = new Map<string, number>();
  private hubs = new Set<string>();
  private important: string[] = [];
  selected: string | null = null;
  hovered: string | null = null;
  /** notes lit by the current context (wall group, search results …) */
  highlight = new Set<string>();
  private neighbours = new Map<string, Set<string>>();
  private styleDirty = true;
  /** time machine: notes not yet born are hidden; each grows in over ~0.3 s */
  private born: Set<string> | null = null;
  private growth = new Float32Array(0);
  /** reduce motion: notes appear without growing */
  reducedMotion = false;

  constructor(private style: GraphStyle = { passthrough: false }) {
    this.root.add(this.labelGroup);
    this.linkMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = iAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vAlpha;');
    };
  }

  setPassthrough(on: boolean): void {
    this.style.passthrough = on;
    this.linkMat.blending = on ? NormalBlending : AdditiveBlending;
    this.linkMat.needsUpdate = true;
    this.styleDirty = true;
  }

  setData(graph: Graph, insights: Insights | null, positions: Map<string, Pos>): void {
    this.nodes = graph.nodes;
    this.index.clear();
    this.nodes.forEach((n, i) => this.index.set(n.id, i));
    this.positions = this.nodes.map((n) => {
      const p = positions.get(n.id);
      return new Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
    });
    this.topicOf = insights?.topicOf ?? new Map();
    const hubCut = Math.max(15, this.nodes.length * 0.2);
    this.hubs = new Set(this.nodes.filter((n) => n.degree > hubCut).map((n) => n.id));
    this.neighbours = new Map(this.nodes.map((n) => [n.id, new Set<string>()]));
    this.links = [];
    for (const l of graph.links) {
      const s = this.index.get(l.source);
      const t = this.index.get(l.target);
      if (s === undefined || t === undefined) continue;
      this.neighbours.get(l.source)!.add(l.target);
      this.neighbours.get(l.target)!.add(l.source);
      const ts = this.topicOf.get(l.source);
      const tt = this.topicOf.get(l.target);
      this.links.push({ s, t, cross: ts !== undefined && tt !== undefined && ts !== tt, hub: this.hubs.has(l.source) || this.hubs.has(l.target) });
    }
    const real = this.nodes.filter((n) => !n.ghost && !n.file);
    this.important = [...real].sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name)).map((n) => n.id);
    this.growth = new Float32Array(this.nodes.length).fill(1);
    this.born = null;
    this.rebuildMeshes();
    this.styleDirty = true;
  }

  /** Only show these notes (time machine); `null` shows everything again. */
  setBorn(ids: Iterable<string> | null): void {
    this.born = ids ? new Set(ids) : null;
    this.styleDirty = true;
  }

  isBorn(id: string): boolean {
    return !this.born || this.born.has(id);
  }

  private rebuildMeshes(): void {
    for (const m of [this.nodeMesh, this.pickMesh, this.linkMesh]) m?.removeFromParent();
    this.nodeMesh?.dispose();
    this.pickMesh?.dispose();
    this.linkMesh?.dispose();
    const n = Math.max(1, this.nodes.length);
    this.nodeMesh = new InstancedMesh(this.nodeGeo, this.nodeMat, n);
    this.nodeMesh.count = this.nodes.length;
    this.nodeMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.nodeMesh.frustumCulled = false;
    this.nodeMesh.name = 'graph-nodes';
    this.pickMesh = new InstancedMesh(this.nodeGeo, new MeshBasicMaterial({ visible: false }), n);
    this.pickMesh.count = this.nodes.length;
    this.pickMesh.frustumCulled = false;
    this.pickMesh.name = 'graph-pick';
    this.pickMesh.userData.graph = this;
    const l = Math.max(1, this.links.length);
    this.linkMesh = new InstancedMesh(this.linkGeo, this.linkMat, l);
    this.linkMesh.count = this.links.length;
    this.linkMesh.frustumCulled = false;
    this.linkMesh.name = 'graph-links';
    this.linkAlpha = new InstancedBufferAttribute(new Float32Array(l), 1);
    this.linkAlpha.setUsage(DynamicDrawUsage);
    this.linkMesh.geometry = this.linkGeo.clone();
    this.linkMesh.geometry.setAttribute('iAlpha', this.linkAlpha);
    // pointer raycasts ignore the visual meshes; only the pick mesh is interactive
    const noRaycast = (): void => undefined;
    this.nodeMesh.raycast = noRaycast;
    this.linkMesh.raycast = noRaycast;
    this.root.add(this.linkMesh, this.nodeMesh, this.pickMesh);
    for (const lab of this.labels.values()) lab.dispose();
    this.labels.clear();
  }

  colorOf(id: string): string {
    const n = this.nodes[this.index.get(id) ?? -1];
    if (!n) return NO_TOPIC;
    if (n.ghost) return COLORS.ghost;
    const t = this.topicOf.get(id);
    return t === undefined ? NO_TOPIC : TOPIC_COLORS[t % TOPIC_COLORS.length]!;
  }

  radiusOf(i: number): number {
    const n = this.nodes[i]!;
    // index pages are not more important just because they list everything
    const deg = this.hubs.has(n.id) ? Math.min(n.degree, 12) : n.degree;
    return nodeRadius({ degree: deg, ghost: n.ghost }) * 0.9;
  }

  neighboursOf(id: string): Set<string> {
    return this.neighbours.get(id) ?? new Set();
  }

  /** World position of a note. */
  worldPos(id: string, out = new Vector3()): Vector3 | null {
    const i = this.index.get(id);
    if (i === undefined) return null;
    return out.copy(this.positions[i]!).applyMatrix4(this.root.matrixWorld);
  }

  /** Nearest note to a ray within `maxDeg` degrees (used while dragging a connection). */
  nearestToRay(ray: Ray, maxDeg = 4, exclude?: string): string | null {
    let best: string | null = null;
    let bestA = (maxDeg * Math.PI) / 180;
    for (let i = 0; i < this.nodes.length; i++) {
      const id = this.nodes[i]!.id;
      if (id === exclude) continue;
      tmpV.copy(this.positions[i]!).applyMatrix4(this.root.matrixWorld).sub(ray.origin);
      const d = tmpV.length();
      if (d < 0.05) continue;
      const a = tmpV.angleTo(ray.direction);
      if (a < bestA) {
        bestA = a;
        best = id;
      }
    }
    return best;
  }

  setSelected(id: string | null): void {
    if (id !== this.selected) {
      this.selected = id;
      this.styleDirty = true;
    }
  }

  setHovered(id: string | null): void {
    if (id !== this.hovered) {
      this.hovered = id;
      this.styleDirty = true;
    }
  }

  setHighlight(ids: Iterable<string>): void {
    this.highlight = new Set(ids);
    this.styleDirty = true;
  }

  markStyleDirty(): void {
    this.styleDirty = true;
  }

  /** Per-frame: node transforms, link transforms, colours and labels. */
  update(camera: Camera, dt = 1 / 72): void {
    if (!this.nodeMesh || !this.pickMesh || !this.linkMesh || !this.linkAlpha) return;
    this.root.updateMatrixWorld();
    let growing = false;
    const grow = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
    for (let i = 0; i < this.nodes.length; i++) {
      const want = this.isBorn(this.nodes[i]!.id) ? 1 : 0;
      const g = this.growth[i]!;
      if (g !== want) {
        const next = Math.abs(want - g) < 0.01 ? want : g + (want - g) * grow;
        this.growth[i] = next;
        growing = true;
      }
    }
    if (growing) this.styleDirty = true;
    const focus = this.selected;
    const lit = new Set<string>(this.highlight);
    if (focus) {
      lit.add(focus);
      for (const m of this.neighboursOf(focus)) lit.add(m);
    }
    if (this.hovered) lit.add(this.hovered);
    const dimOthers = !!focus || this.highlight.size > 0;

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]!;
      const g = this.growth[i] ?? 1;
      const r = this.radiusOf(i) * (n.id === focus ? 1.6 : n.id === this.hovered ? 1.35 : 1) * Math.max(1e-4, g);
      tmpM.makeScale(r, r, r).setPosition(this.positions[i]!);
      this.nodeMesh.setMatrixAt(i, tmpM);
      const pr = g < 0.5 ? 1e-4 : Math.max(r * 2.2, 7);
      tmpM.makeScale(pr, pr, pr).setPosition(this.positions[i]!);
      this.pickMesh.setMatrixAt(i, tmpM);
      if (this.styleDirty) {
        tmpC.set(this.colorOf(n.id));
        if (dimOthers && !lit.has(n.id)) tmpC.multiplyScalar(0.28);
        else if (n.id === focus) tmpC.lerp(new Color(0xffffff), 0.35);
        if (n.ghost) tmpC.multiplyScalar(0.6);
        this.nodeMesh.setColorAt(i, tmpC);
      }
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.pickMesh.instanceMatrix.needsUpdate = true;
    if (this.styleDirty && this.nodeMesh.instanceColor) this.nodeMesh.instanceColor.needsUpdate = true;
    this.pickMesh.computeBoundingSphere();

    // links: a cylinder from s to t, constant width in the world whatever the graph scale. With nothing
    // selected the whole web is the picture, so links are bolder (~5–6 mm, clearly visible at 1.5 m
    // on a Quest 3 panel); once a note is selected the rest steps back and its own links stand out.
    const scale = this.root.getWorldScale(tmpV2).x || 1;
    const calm = !dimOthers;
    const radius = (this.style.passthrough ? (calm ? 0.0032 : 0.0022) : calm ? 0.0027 : 0.0016) / scale;
    for (let k = 0; k < this.links.length; k++) {
      const l = this.links[k]!;
      const a = this.positions[l.s]!;
      const b = this.positions[l.t]!;
      tmpV.subVectors(b, a);
      const len = tmpV.length() || 1e-6;
      tmpQ.setFromUnitVectors(UP, tmpV.multiplyScalar(1 / len));
      const sid = this.nodes[l.s]!.id;
      const tid = this.nodes[l.t]!.id;
      const touchesFocus = !!focus && (sid === focus || tid === focus);
      const w = touchesFocus ? 2.2 : 1;
      tmpM.compose(a, tmpQ, tmpV2.set(radius * w, len, radius * w));
      this.linkMesh.setMatrixAt(k, tmpM);
      if (this.styleDirty) {
        let alpha = calm ? (l.hub ? 0.26 : l.cross ? 0.7 : 0.58) : l.hub ? 0.12 : l.cross ? 0.42 : 0.3;
        if (dimOthers) alpha = touchesFocus || (lit.has(sid) && lit.has(tid) && !focus) ? 0.95 : alpha * 0.25;
        if (this.style.passthrough) alpha = Math.min(1, alpha * 1.3);
        alpha *= Math.min(this.growth[l.s] ?? 1, this.growth[l.t] ?? 1);
        this.linkAlpha.setX(k, alpha);
        tmpC.set(this.colorOf(touchesFocus ? (sid === focus ? tid : sid) : sid));
        if (!touchesFocus) tmpC.lerp(new Color(0x9fb0cc), calm ? 0.22 : 0.5);
        this.linkMesh.setColorAt(k, tmpC);
      }
    }
    this.linkMesh.instanceMatrix.needsUpdate = true;
    if (this.styleDirty) {
      this.linkAlpha.needsUpdate = true;
      if (this.linkMesh.instanceColor) this.linkMesh.instanceColor.needsUpdate = true;
    }
    this.styleDirty = false;
    this.updateLabels(camera, lit, scale);
  }

  /**
   * Label budget: the focused note and its neighbours, the hovered one, then the most connected notes
   * that are near enough to read. Labels keep a constant angular size (~1.3° body text).
   */
  private updateLabels(camera: Camera, lit: Set<string>, scale: number): void {
    const eye = tmpV.setFromMatrixPosition(camera.matrixWorld);
    const want = new Map<string, 'focus' | 'normal'>();
    if (this.selected) want.set(this.selected, 'focus');
    if (this.hovered) want.set(this.hovered, 'focus');
    for (const id of lit) if (want.size < 18 && !want.has(id)) want.set(id, 'normal');
    const budget = this.selected ? 22 : 16;
    for (const id of this.important) {
      if (want.size >= budget) break;
      if (!want.has(id) && this.isBorn(id) && (!this.selected || !this.highlight.size)) want.set(id, 'normal');
    }
    for (const [id, lab] of this.labels)
      if (!want.has(id)) {
        lab.sprite.visible = false;
      }
    for (const [id, kind] of want) {
      const i = this.index.get(id);
      if (i === undefined) continue;
      if ((this.growth[i] ?? 1) < 0.6) {
        const hidden = this.labels.get(id);
        if (hidden) hidden.sprite.visible = false;
        continue;
      }
      let lab = this.labels.get(id);
      if (!lab) {
        lab = new Label();
        this.labels.set(id, lab);
        this.labelGroup.add(lab.sprite);
      }
      const n = this.nodes[i]!;
      lab.set(n.name, kind === 'focus' ? FOCUS_LABEL : NODE_LABEL, n.ghost ? COLORS.textDim : undefined);
      const p = this.positions[i]!;
      lab.sprite.position.set(p.x, p.y + this.radiusOf(i) * 1.25, p.z);
      const world = tmpV2.copy(p).applyMatrix4(this.root.matrixWorld);
      const dist = Math.max(0.3, world.distanceTo(eye));
      // constant angular height: 1.25° for normal labels, 1.6° for the focused one
      const deg = kind === 'focus' ? 1.6 : 1.25;
      lab.setHeight(dist * Math.tan((deg * Math.PI) / 180), scale);
      lab.opacity = kind === 'focus' || lit.has(id) || !this.selected ? 1 : 0.55;
      lab.sprite.visible = true;
    }
  }

  /** Centre of the graph in layout units. */
  centre(): Vector3 {
    const c = new Vector3();
    for (const p of this.positions) c.add(p);
    return this.positions.length ? c.multiplyScalar(1 / this.positions.length) : c;
  }

  /** Graph radius in layout units (90th percentile, so outliers don't shrink the view). */
  radius(): number {
    const c = this.centre();
    const d = this.positions.map((p) => p.distanceTo(c)).sort((a, b) => a - b);
    return Math.max(1, d[Math.floor((d.length - 1) * 0.9)] ?? 1);
  }

  dispose(): void {
    for (const lab of this.labels.values()) lab.dispose();
    this.nodeMesh?.dispose();
    this.pickMesh?.dispose();
    this.linkMesh?.dispose();
    this.nodeGeo.dispose();
    this.linkGeo.dispose();
    this.root.removeFromParent();
  }
}

export function isObject3D(o: unknown): o is Object3D {
  return o instanceof Object3D;
}

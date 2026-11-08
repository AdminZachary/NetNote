/**
 * The map in your hand (World-in-Miniature, Stoakley et al. 1995): a 15 cm holographic copy of the
 * graph projected above your left hand, oriented like the big one, coloured by topic, with your
 * current note and "you are here" marked.
 *   - point at a star on it and pinch: the big graph turns that note round to face you;
 *   - grab the glowing bezel ring and drag: the map turns freely like a ball in your hand, and the
 *     big graph turns with it (a tick on the bezel every 15° you turn, felt and heard).
 *   - slide the knob on the zoom rail beside it: the big graph grows or shrinks to match (the knob
 *     always shows how far in you are, between the furthest and the closest view).
 * The projector base under it stays level and keeps north, so you never lose your bearings.
 * With hand tracking it rests on your left palm: turn the palm towards you and it appears there.
 * Pinch at it to use it (the ray from your right hand), even from just a few centimetres away.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  Quaternion,
  LineSegments,
  CylinderGeometry,
  AdditiveBlending,
  DoubleSide,
  Plane,
} from '@iwsdk/core';
import type { XRPointerEvent } from '../ui/surface';
import { dragRotation, grabPoint } from '../interaction/turn';

/** metres: the graph's radius in your hand */
export const MINI_R = 0.075;
/** metres: length of the zoom rail */
const RAIL_H = MINI_R * 1.6;
const PICK_R = 0.008;

function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class MiniMap {
  readonly group = new Group();
  private readonly geo = new BufferGeometry();
  private readonly mat = new PointsMaterial({ size: 0.009, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0 });
  private readonly points = new Points(this.geo, this.mat);
  private pick: InstancedMesh | null = null;
  private readonly pickGeo = new SphereGeometry(1, 6, 4);
  private readonly pickMat = new MeshBasicMaterial({ visible: false });
  private readonly shell: Line<BufferGeometry, LineBasicMaterial>;
  private readonly focus: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly hover: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly you: Mesh<ConeGeometry, MeshBasicMaterial>;
  private ids: string[] = [];
  private local: Vector3[] = [];
  private centre = new Vector3();
  private k = 1;
  private opacity = 0;
  /** 0..1 wanted visibility (eased) */
  target = 0;
  hovered: string | null = null;
  onPick: ((id: string) => void) | null = null;
  onHover: ((id: string | null) => void) | null = null;
  /** the map was turned by `q` (world space): turn the big graph the same way */
  onRotate: ((q: Quaternion) => void) | null = null;
  /** turning started / ended (for sound and haptics) */
  onTurnTick: (() => void) | null = null;
  private readonly bezel: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly bezelHit: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly ticks: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly base = new Group();
  private readonly baseMats: (LineBasicMaterial | MeshBasicMaterial)[] = [];
  private drag: { pointerId: number; last: Vector3; turned: number } | null = null;
  /** the zoom rail: stays upright and faces you, to the right of the ball */
  private readonly controls = new Group();
  private readonly knob: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly railMats: LineBasicMaterial[] = [];
  private zoomDrag: { pointerId: number } | null = null;
  /** 0 (furthest view) .. 1 (closest view): where the knob sits */
  zoomLevel = 0.5;
  /** the knob was moved to `level` (0..1): zoom the big graph to match */
  onZoom: ((level: number) => void) | null = null;
  /** world pose of the map last frame (for the grab maths) */
  private readonly worldCentre = new Vector3();

  constructor() {
    this.group.name = 'minimap';
    this.group.visible = false;
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.points.raycast = () => undefined;
    this.group.add(this.points);
    const ring: number[] = [];
    for (let i = 0; i <= 64; i++) ring.push(Math.cos((i / 64) * Math.PI * 2), 0, Math.sin((i / 64) * Math.PI * 2));
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array(ring), 3));
    this.shell = new Line(rg, new LineBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false }));
    this.shell.renderOrder = 11;
    this.shell.raycast = () => undefined;
    this.group.add(this.shell);
    const dot = (color: number, r: number): Mesh<SphereGeometry, MeshBasicMaterial> => {
      const m = new Mesh(new SphereGeometry(r, 12, 8), new MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      m.renderOrder = 13;
      m.visible = false;
      m.raycast = () => undefined;
      this.group.add(m);
      return m;
    };
    this.focus = dot(0xffffff, 0.0032);
    this.hover = dot(0xffd166, 0.0042);
    const cone = new ConeGeometry(0.004, 0.011, 12);
    cone.rotateX(Math.PI / 2); // tip along +Z (lookAt aims +Z)
    this.you = new Mesh(cone, new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.you.renderOrder = 13;
    this.you.raycast = () => undefined;
    this.group.add(this.you);

    // the bezel: a glowing ring around the ball's equator, with 15° ticks; grab it to turn the map
    this.bezel = new Mesh(
      new TorusGeometry(MINI_R * 1.2, 0.0016, 8, 96),
      new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }),
    );
    this.bezel.rotation.x = Math.PI / 2;
    this.bezel.renderOrder = 12;
    this.bezel.raycast = () => undefined;
    this.group.add(this.bezel);
    this.bezelHit = new Mesh(new TorusGeometry(MINI_R * 1.2, 0.011, 6, 48), new MeshBasicMaterial({ visible: false }));
    this.bezelHit.rotation.x = Math.PI / 2;
    this.bezelHit.name = 'minimap-bezel';
    this.group.add(this.bezelHit);
    const tk: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = MINI_R * 1.2;
      const r1 = r0 + (i % 6 === 0 ? 0.009 : 0.004);
      tk.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
    }
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(new Float32Array(tk), 3));
    this.ticks = new LineSegments(tg, new LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0, depthWrite: false }));
    this.ticks.renderOrder = 12;
    this.ticks.raycast = () => undefined;
    this.group.add(this.ticks);

    // the projector base: level, north up, with a faint light cone up to the ball
    const disc: number[] = [];
    for (let k = 0; k < 2; k++) {
      const r = MINI_R * (k ? 0.55 : 0.7);
      for (let i = 0; i < 64; i++) {
        const a0 = (i / 64) * Math.PI * 2;
        const a1 = ((i + 1) / 64) * Math.PI * 2;
        disc.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    }
    disc.push(0, 0, -MINI_R * 0.7, 0, 0, -MINI_R * 0.88); // north
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(new Float32Array(disc), 3));
    const dm = new LineBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false });
    const baseLines = new LineSegments(dg, dm);
    baseLines.raycast = () => undefined;
    const beamH = MINI_R * 1.05;
    const beam = new Mesh(
      new CylinderGeometry(MINI_R * 0.95, MINI_R * 0.55, beamH, 32, 1, true).translate(0, beamH / 2, 0),
      new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }),
    );
    beam.raycast = () => undefined;
    beam.renderOrder = 10;
    this.base.add(baseLines, beam);
    this.baseMats.push(dm, beam.material);
    this.base.visible = false;

    // the zoom rail: a short upright track with + at the top and − at the bottom, and a knob on it
    const H = RAIL_H;
    const rail: number[] = [0, -H / 2, 0, 0, H / 2, 0];
    for (let i = 0; i <= 8; i++) rail.push(-0.003, -H / 2 + (i * H) / 8, 0, 0.003, -H / 2 + (i * H) / 8, 0);
    const plus = 0.006;
    rail.push(-plus, H / 2 + 0.014, 0, plus, H / 2 + 0.014, 0, 0, H / 2 + 0.014 - plus, 0, 0, H / 2 + 0.014 + plus, 0);
    rail.push(-plus, -H / 2 - 0.014, 0, plus, -H / 2 - 0.014, 0);
    const railGeo = new BufferGeometry();
    railGeo.setAttribute('position', new BufferAttribute(new Float32Array(rail), 3));
    const railMat = new LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0, depthWrite: false });
    this.railMats.push(railMat);
    const railLines = new LineSegments(railGeo, railMat);
    railLines.raycast = () => undefined;
    railLines.renderOrder = 12;
    this.knob = new Mesh(new SphereGeometry(0.0065, 16, 12), new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false }));
    this.knob.renderOrder = 13;
    this.knob.raycast = () => undefined;
    const railHit = new Mesh(new CylinderGeometry(0.014, 0.014, H + 0.04, 8), new MeshBasicMaterial({ visible: false }));
    railHit.name = 'minimap-zoom';
    this.controls.add(railLines, this.knob, railHit);
    this.controls.name = 'minimap-controls';
    this.controls.visible = false;
    this.bind();
    this.bindZoom();
  }

  /** The level base lives outside the rotating ball: add it to the scene next to `group`. */
  get baseGroup(): Group {
    return this.base;
  }

  /** The zoom rail lives outside the rotating ball too: add it to the scene and make it interactive. */
  get controlsGroup(): Group {
    return this.controls;
  }

  get zooming(): boolean {
    return !!this.zoomDrag;
  }

  get turning(): boolean {
    return !!this.drag || !!this.zoomDrag;
  }

  private bindZoom(): void {
    const g = this.controls as unknown as {
      addEventListener(t: string, f: (e: XRPointerEvent) => void): void;
      setPointerCapture(id: number): void;
      releasePointerCapture(id: number): void;
    };
    // where along the rail the pointer is: the fingertip itself, or where the ray meets the rail's plane
    const levelOf = (e: XRPointerEvent): number | null => {
      let p: Vector3 | null = null;
      if (isTouch(e) && e.point) p = new Vector3(e.point.x, e.point.y, e.point.z);
      else {
        const q = e.pointerQuaternion;
        const o = new Vector3(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
        const d = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
        this.controls.updateMatrixWorld();
        const n = new Vector3(0, 0, 1).applyQuaternion(this.controls.getWorldQuaternion(new Quaternion()));
        const plane = new Plane().setFromNormalAndCoplanarPoint(n, this.controls.getWorldPosition(new Vector3()));
        const denom = n.dot(d);
        if (Math.abs(denom) < 1e-4) return null;
        const t = -plane.distanceToPoint(o) / denom;
        if (t < 0) return null;
        p = o.addScaledVector(d, t);
      }
      const local = this.controls.worldToLocal(p);
      return Math.max(0, Math.min(1, local.y / RAIL_H + 0.5));
    };
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.opacity < 0.6) return;
      this.zoomDrag = { pointerId: e.pointerId };
      g.setPointerCapture(e.pointerId);
      const l = levelOf(e);
      if (l !== null) this.setZoom(l);
      this.onTurnTick?.();
    });
    g.addEventListener('pointermove', (e) => {
      if (this.zoomDrag?.pointerId !== e.pointerId) return;
      const l = levelOf(e);
      if (l !== null) this.setZoom(l);
    });
    g.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (this.zoomDrag?.pointerId !== e.pointerId) return;
      g.releasePointerCapture(e.pointerId);
      this.zoomDrag = null;
    });
  }

  private lastTick = 0.5;
  private setZoom(level: number): void {
    if (Math.abs(level - this.zoomLevel) < 1e-4) return;
    this.zoomLevel = level;
    this.onZoom?.(level);
    if (Math.abs(level - this.lastTick) >= 0.125) {
      this.lastTick = level;
      this.onTurnTick?.();
    }
  }

  private bind(): void {
    const g = this.group as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void };
    const idOf = (e: XRPointerEvent): string | null => (e.object === this.pick && e.instanceId !== undefined ? (this.ids[e.instanceId] ?? null) : null);
    const ray = (e: XRPointerEvent): { o: Vector3; d: Vector3 } => {
      const q = e.pointerQuaternion;
      return {
        o: new Vector3(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z),
        d: new Vector3(0, 0, -1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w)),
      };
    };
    const held = (e: XRPointerEvent): Vector3 => {
      if (isTouch(e) && e.point) return new Vector3(e.point.x, e.point.y, e.point.z).sub(this.worldCentre);
      const { o, d } = ray(e);
      return grabPoint(o, d, this.worldCentre, MINI_R * 1.2 * this.group.scale.x).sub(this.worldCentre);
    };
    g.addEventListener('pointermove', (e) => {
      const dr = this.drag;
      if (dr && dr.pointerId === e.pointerId) {
        const now = held(e);
        const q = dragRotation(dr.last, now);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        if (angle > 1e-4) {
          this.onRotate?.(q);
          dr.turned += angle;
          if (dr.turned > Math.PI / 12) {
            dr.turned = 0;
            this.onTurnTick?.();
          }
        }
        dr.last = now;
        return;
      }
      this.setHover(idOf(e));
    });
    g.addEventListener('pointerleave', () => this.setHover(null));
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.object === this.bezelHit && this.opacity > 0.6) {
        this.drag = { pointerId: e.pointerId, last: held(e), turned: 0 };
        (this.group as unknown as { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId);
        this.onTurnTick?.();
      }
    });
    g.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (this.drag?.pointerId === e.pointerId) {
        (this.group as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture(e.pointerId);
        this.drag = null;
        return;
      }
      const id = idOf(e);
      if (id && this.opacity > 0.6) this.onPick?.(id);
    });
  }

  private setHover(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.onHover?.(id);
  }

  /** Rebuild from the graph (layout units). */
  setData(ids: string[], positions: Vector3[], centre: Vector3, radius: number, colorOf: (id: string) => string): void {
    const n = ids.length;
    this.ids = ids;
    this.centre.copy(centre);
    this.k = MINI_R / Math.max(1e-6, radius);
    const pos = new Float32Array(Math.max(1, n) * 3);
    const col = new Float32Array(Math.max(1, n) * 3);
    const c = new Color();
    this.local = positions.map((p, i) => {
      const l = p.clone().sub(centre).multiplyScalar(this.k);
      pos.set([l.x, l.y, l.z], i * 3);
      c.set(colorOf(ids[i]!));
      col.set([c.r, c.g, c.b], i * 3);
      return l;
    });
    this.geo.setAttribute('position', new BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(col, 3));
    this.geo.setDrawRange(0, n);
    this.shell.scale.setScalar(MINI_R * 1.12);
    if (this.pick) {
      this.pick.removeFromParent();
      this.pick.dispose();
    }
    this.pick = new InstancedMesh(this.pickGeo, this.pickMat, Math.max(1, n));
    this.pick.name = 'minimap-pick';
    this.pick.count = n;
    const m = new Matrix4();
    this.local.forEach((l, i) => this.pick!.setMatrixAt(i, m.makeScale(PICK_R, PICK_R, PICK_R).setPosition(l)));
    this.pick.instanceMatrix.needsUpdate = true;
    this.pick.computeBoundingSphere();
    this.group.add(this.pick);
  }

  /** anchor: world position above the hand; quat: the big graph's orientation; headLocal: head in layout units. */
  place(
    dt: number,
    anchor: Vector3,
    quat: Quaternion,
    focusId: string | null,
    headLocal: Vector3,
    headFwd: Vector3,
    eye: Vector3 = anchor.clone().addScaledVector(headFwd, -0.4),
    baseAt: Vector3 | null = null,
  ): void {
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 6);
    this.group.visible = this.opacity > 0.02;
    this.base.visible = this.group.visible;
    this.controls.visible = this.group.visible;
    if (!this.group.visible) {
      this.setHover(null);
      this.drag = null;
      this.zoomDrag = null;
      return;
    }
    // while you turn it, the ball stays where you grabbed it (it does not chase your other hand)
    if (!this.drag) this.group.position.copy(anchor);
    this.group.quaternion.copy(quat);
    this.group.updateMatrixWorld(true);
    this.worldCentre.copy(this.group.position);
    // the base sits under the ball, or in your palm when the map rests on it
    if (baseAt) this.base.position.copy(baseAt);
    else this.base.position.copy(this.group.position).setY(this.group.position.y - MINI_R * 1.35);
    this.base.quaternion.identity();
    // the zoom rail: upright, facing you, just right of the ball (as you see it)
    const toEye = eye.clone().sub(this.group.position).setY(0);
    if (toEye.lengthSq() < 1e-6) toEye.set(0, 0, 1);
    toEye.normalize();
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), toEye).normalize();
    if (!this.zoomDrag) this.controls.position.copy(this.group.position).addScaledVector(right, MINI_R * 1.55);
    this.controls.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), toEye);
    this.knob.position.set(0, (this.zoomLevel - 0.5) * RAIL_H, 0);
    this.knob.material.opacity = (this.zoomDrag ? 1 : 0.85) * this.opacity;
    this.knob.scale.setScalar(this.zoomDrag ? 1.3 : 1);
    for (const m of this.railMats) m.opacity = (this.zoomDrag ? 0.9 : 0.55) * this.opacity;
    const glow = this.drag ? 1 : this.hovered ? 0.8 : 0.6;
    this.mat.opacity = this.opacity;
    this.shell.material.opacity = 0.35 * this.opacity;
    this.bezel.material.opacity = glow * this.opacity;
    this.ticks.material.opacity = 0.7 * glow * this.opacity;
    this.baseMats[0]!.opacity = 0.45 * this.opacity;
    this.baseMats[1]!.opacity = 0.05 * this.opacity;
    const mark = (m: Mesh<SphereGeometry, MeshBasicMaterial>, id: string | null): void => {
      const i = id ? this.ids.indexOf(id) : -1;
      m.visible = i >= 0;
      if (i >= 0) m.position.copy(this.local[i]!);
      m.material.opacity = this.opacity;
    };
    mark(this.focus, focusId);
    mark(this.hover, this.hovered);
    // you: clamped just outside the ball when you are far away, so it still shows your direction
    const y = headLocal.clone().sub(this.centre).multiplyScalar(this.k);
    if (y.length() > MINI_R * 1.35) y.setLength(MINI_R * 1.35);
    this.you.position.copy(y);
    this.you.updateMatrixWorld();
    const w = new Vector3().setFromMatrixPosition(this.you.matrixWorld);
    this.you.lookAt(w.add(headFwd));
    this.you.material.opacity = this.opacity;
  }

  get visible(): boolean {
    return this.group.visible;
  }
}

function isTouch(e: XRPointerEvent): boolean {
  return e.pointerType === 'touch';
}

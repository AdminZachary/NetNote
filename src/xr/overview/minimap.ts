/**
 * The map in your hand (World-in-Miniature, Stoakley et al. 1995): a 15 cm holographic copy of the
 * graph, oriented like the big one, coloured by topic, with your current note and "you are here".
 *   - turn your left palm towards you and it appears above the palm; turn the palm away and it goes;
 *   - pinch it with both hands at once: turning your hands turns it, pulling them apart or together
 *     zooms, and the big graph follows (the app does the two-hand maths, see NetNoteApp);
 *   - point at a star on it and pinch: the big graph turns that note round to face you.
 * The projector base under it stays level and keeps north, so you never lose your bearings.
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
} from '@iwsdk/core';
import type { XRPointerEvent } from '../ui/surface';

/** metres: the graph's radius in your hand */
export const MINI_R = 0.075;
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
  /** held in both hands: the equator ring glows and the ball stays where it was taken */
  held = false;
  private readonly bezel: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly base = new Group();
  private readonly baseMats: (LineBasicMaterial | MeshBasicMaterial)[] = [];
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

    // the equator: a faint ring that lights up while you hold the map in both hands
    this.bezel = new Mesh(
      new TorusGeometry(MINI_R * 1.15, 0.0012, 8, 96),
      new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }),
    );
    this.bezel.rotation.x = Math.PI / 2;
    this.bezel.renderOrder = 12;
    this.bezel.raycast = () => undefined;
    this.group.add(this.bezel);

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

    this.bind();
  }

  /** The level base lives outside the rotating ball: add it to the scene next to `group`. */
  get baseGroup(): Group {
    return this.base;
  }

  private bind(): void {
    const g = this.group as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void };
    const idOf = (e: XRPointerEvent): string | null => (e.object === this.pick && e.instanceId !== undefined ? (this.ids[e.instanceId] ?? null) : null);
    g.addEventListener('pointermove', (e) => this.setHover(this.held ? null : idOf(e)));
    g.addEventListener('pointerleave', () => this.setHover(null));
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.pickArmed = !this.held;
    });
    g.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      const id = idOf(e);
      // a pinch that became part of holding the map in both hands is not a pick
      if (id && this.pickArmed && !this.held && this.opacity > 0.6) this.onPick?.(id);
      this.pickArmed = false;
    });
  }

  private pickArmed = false;

  /** Cancel a pick in progress (the pinch turned into holding the map). */
  cancelPick(): void {
    this.pickArmed = false;
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
  place(dt: number, anchor: Vector3, quat: Quaternion, focusId: string | null, headLocal: Vector3, headFwd: Vector3, baseAt: Vector3 | null = null): void {
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 6);
    this.group.visible = this.opacity > 0.02;
    this.base.visible = this.group.visible;
    if (!this.group.visible) {
      this.setHover(null);
      return;
    }
    // while you hold it, the ball stays where you took it (it does not chase your palm)
    if (!this.held) this.group.position.copy(anchor);
    this.group.quaternion.copy(quat);
    this.group.updateMatrixWorld(true);
    this.worldCentre.copy(this.group.position);
    // the base sits under the ball, or in your palm when the map rests on it
    if (baseAt) this.base.position.copy(baseAt);
    else this.base.position.copy(this.group.position).setY(this.group.position.y - MINI_R * 1.35);
    this.base.quaternion.identity();
    const glow = this.held ? 1 : 0.35;
    this.mat.opacity = this.opacity;
    this.shell.material.opacity = 0.35 * this.opacity;
    this.bezel.material.opacity = glow * this.opacity;
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

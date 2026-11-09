/**
 * NetNote in the headset: wires the library (notes + insights) to the spatial UI and the input.
 *
 * Flow of a thinking session (the product's core loop):
 *   see    the graph lies in front of you, coloured by topic
 *   read   pinch a star: its card opens on the reading shelf
 *   link   pinch a star and drag it onto another: they connect, and you are asked *why*
 *   write  type (Quest keyboard / voice / Bluetooth keyboard) — the reason is saved in the note
 *   ask    the thinking wall and the insight prompts suggest what to look at next
 */
import {
  BackSide,
  createSystem,
  XRPlane,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PokeInteractable,
  Quaternion,
  Ray,
  RayInteractable,
  SphereGeometry,
  Vector3,
  VisibilityState,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';
import { relatedFor } from '../core/insights/engine';
import { bounds, layoutGraph, type LayoutNode } from '../core/layout/force';
import type { Library } from '../app/library';
import { reasonText, t } from '../app/i18n';
import { GraphView } from './graph/graph-view';
import { RoomManipulator } from './interaction/manipulate';
import { TextInput } from './keyboard/text-input';
import { Environment } from './room/environment';
import {
  angleDiff,
  faceTowards,
  fovFromProjection,
  QUEST_FOV,
  shelfFor,
  shelfPoint,
  unionFov,
  yawOf,
  type Fov,
  type Home,
  type ShelfLayout,
} from './room/placement';
import { COLORS, ERGO } from './theme';
import { Composer } from './ui/composer';
import { Dock, type DockAction } from './ui/dock';
import { Hint } from './ui/hint';
import { NoteCard } from './ui/note-card';
import { SearchPanel } from './ui/search-panel';
import { Surface, type XRPointerEvent } from './ui/surface';
import { PalmUp, palmFacing, palmPose, type PalmPose } from './interaction/palm';
import type { ClusterInfo } from '../core/insights/cluster';
import { sanitizeSavedWall, WALL_AZ, WALL_R, WALL_SCALE, WallGeometry, type SavedWallCard, type WallSpot } from './wall/wall-geometry';
import { WallView, type Ribbon } from './wall/wall-view';
import { TAG_H, WallTag } from './wall/wall-tag';
import { Territories } from './overview/territories';
import { MiniMap, MINI_R } from './overview/minimap';
import { InsightsPanel } from './ui/insights-panel';
import { findTable, findWall, type PlaneInfo, type TableSpot, type WallFit } from './mr/surfaces';
import { INSIGHT_TABS, insightRows, pairKey, type InsightRow, type InsightTab } from '../app/insight-rows';
import { FlowField, type FlowLink } from './motion/flows';
import { Tethers, type TetherSpec } from './motion/tethers';
import { easeOutCubic, follow, MOTION, popScale, reduceMotion, setReduceMotion } from './motion/ease';
import { Sound } from './audio/sfx';
import { CompanionBrain, type SpeechButton } from './companion/brain';
import { Companion } from './companion/companion';
import { ToolsRow, type ToolAction } from './ui/tools';
import { NoteEditor } from './ui/note-editor';
import { joinBlocks, splitBlocks } from '../core/markdown/blocks';
import { rotateAbout, turnSeconds, yawToFace } from './interaction/turn';
import { countAt, nextTourStop, playbackStep, shortestPath, timeline, type Born } from '../core/explore/explore';

type Pos = { x: number; y: number; z: number };

interface ConnectDrag {
  pointerId: number;
  from: string;
  startDir: Vector3;
  moved: boolean;
  target: string | null;
}

interface PanelDrag {
  pointerId: number;
  surface: Surface;
  distance: number;
}

type WriteMode =
  | { kind: 'new' }
  | { kind: 'append'; path: string }
  | { kind: 'reason'; from: string; to: string }
  | { kind: 'search' }
  | { kind: 'answer'; paths: string[]; question: string }
  | { kind: 'rename'; path: string }
  | { kind: 'edit'; path: string; front: string; blocks: string[]; index: number; dirty: boolean };

interface WallZoom {
  z: number;
  hoverAt: number;
  leaveAt: number;
  want: boolean;
}

const FORWARD = new Vector3(0, 0, -1);
const tmp = new Vector3();

export interface AppOptions {
  /** called when the user asks to leave the immersive session */
  onExit?: () => void;
}

export class NetNoteApp {
  readonly graph = new GraphView();
  readonly env = new Environment();
  readonly dock = new Dock();
  readonly hint = new Hint();
  readonly composer = new Composer();
  readonly search = new SearchPanel();
  readonly cards: NoteCard[] = [];
  readonly input: TextInput;
  readonly manip: RoomManipulator;
  readonly wallGeo = new WallGeometry(ERGO.cardWidth, ERGO.cardWidth * 1.25);
  readonly wall = new WallView(this.wallGeo);
  readonly territories = new Territories(this.graph);
  readonly minimap = new MiniMap();
  readonly insightsPanel = new InsightsPanel();
  readonly flows = new FlowField();
  readonly tethers = new Tethers();
  readonly sound = new Sound();
  readonly tools = new ToolsRow();
  readonly editor = new NoteEditor();
  readonly companion = new Companion();
  readonly brain: CompanionBrain;
  /** card motion: where each shelf card is gliding to, when it appeared, when its note changed */
  private motion = new Map<NoteCard, { goal: Vector3; born: number; swap: number }>();
  /** path finder: waiting for the second note / the path found */
  private pathPick: string | null = null;
  private path: string[] | null = null;
  /** a pair the companion is showing */
  private suggestPair: [string, string] | null = null;
  private linkRows: InsightRow[] = [];
  private questionRows: InsightRow[] = [];
  private touring: { visited: string[]; next: number } | null = null;
  private timeMachine: { list: Born[]; i: number; acc: number; perStep: number; interval: number; doneAt: number } | null = null;
  private insightTab: InsightTab = 'links';
  private dismissed = new Set<string>();
  private rowsByKey = new Map<string, InsightRow>();
  private glide: { from: Vector3; to: Vector3; t0: number } | null = null;
  /** the graph turning a note round to face you (yaw about its centre, eased) */
  private turn: { angle: number; done: number; t0: number; dur: number } | null = null;
  /** cards hanging on the wall, and where */
  readonly onWall = new Map<NoteCard, WallSpot>();
  private zoom = new Map<NoteCard, WallZoom>();
  private hoveredCards = new Set<NoteCard>();
  private tags: WallTag[] = [];
  private clusterCache = new Map<string, ClusterInfo>();
  private wallSig = '';
  private wallLoaded = false;
  private wallSaveTimer: ReturnType<typeof setTimeout> | null = null;

  private home: Home = { position: new Vector3(0, 1.6, 0), yaw: 0 };
  private fov: Fov = QUEST_FOV;
  private shelf: ShelfLayout = shelfFor(QUEST_FOV);
  private positions = new Map<string, Pos>();
  private connect: ConnectDrag | null = null;
  private panelDrag: PanelDrag | null = null;
  private rubber: Line;
  private catcher: Mesh;
  private writeMode: WriteMode | null = null;
  private pinned = new Set<string>();
  private moved = new Set<NoteCard>();
  private tour = { read: false, move: false, connect: false, menu: false };
  private immersive = false;
  /** mixed reality: real surfaces found by scene understanding */
  private room: { mixed: boolean; table: TableSpot | null; wall: WallFit | null; searchUntil: number; nextLook: number } = {
    mixed: false,
    table: null,
    wall: null,
    searchUntil: 0,
    nextLook: 0,
  };
  /** detected real-world planes (kept up to date by a small ECS system) */
  planes: Entity[] = [];
  private entities: Entity[] = [];
  /** objects that answer a fingertip (only the menu bar) */
  readonly pokeable: Object3D[] = [];
  private retiring: { entity: Entity | null; surface: Surface }[] = [];
  private toastTimer = 0;
  private lastVersion = -1;

  constructor(
    readonly world: World,
    readonly library: Library,
    private readonly opts: AppOptions = {},
  ) {
    this.input = new TextInput({ document, session: () => world.session });
    // typing (on any keyboard, including a surface keyboard on the desk): hands rest, nothing gets pressed
    this.input.onTyped = () => (Surface.quietUntil = performance.now() + 500);
    // a fingertip press on a panel button: a soft click where you touched it (hands have no motor)
    Surface.onPress = (_s, kind, at) => {
      if (kind === 'touch') this.sound.play('select', at, null);
    };
    this.manip = new RoomManipulator(this.graph.root);
    this.manip.onManipulate = () => this.tourDone('move');

    // an invisible shell around you catches pinches on "empty space" (moving the room)
    this.catcher = new Mesh(
      new SphereGeometry(30, 16, 8),
      new MeshBasicMaterial({ side: BackSide, transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    this.catcher.name = 'room-catcher';
    const rubberGeo = new BufferGeometry();
    rubberGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    this.rubber = new Line(rubberGeo, new LineBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.9, depthTest: false }));
    this.rubber.visible = false;
    this.rubber.frustumCulled = false;
    this.rubber.renderOrder = 20;
    this.rubber.raycast = () => undefined;

    const scene = world.scene;
    scene.add(this.env.group, this.rubber, this.wall.group);
    this.register(this.catcher, false);
    this.register(this.graph.root, false);
    // only the floating menu bar answers a fingertip; every other panel is for the ray (they sit at
    // reading distance, out of reach, and touch there would only fight the ray)
    this.register(this.dock.mesh, true);
    for (const s of [this.composer, this.search, this.insightsPanel]) this.register(s.mesh, false);
    this.register(this.minimap.group, false);
    this.insightsPanel.mesh.visible = false;
    this.insightsPanel.onAction = (id, data) => this.onInsights(id, data);
    this.minimap.onPick = (id) => this.jumpTo(id);
    scene.add(this.minimap.baseGroup);
    this.minimap.onHover = (id) => this.graph.setHovered(id);
    scene.add(this.hint.mesh);
    // motion, sound and the companion
    this.graph.root.add(this.flows.points);
    scene.add(this.tethers.lines);
    this.register(this.tools.mesh, true); // the More row belongs to the menu bar
    this.register(this.editor.mesh, false);
    this.editor.mesh.visible = false;
    this.editor.onAction = (id, data) => this.onEditor(id, data);
    this.tools.mesh.visible = false;
    this.tools.onAction = (id) => this.onTool(id as ToolAction);
    this.register(this.companion.group, false);
    this.register(this.companion.bubble.mesh, false);
    this.companion.bubble.onAction = (id) => this.onCompanion(id as SpeechButton);
    (this.companion.group as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void }).addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.brain.poke(performance.now());
      this.sound.play('pin', this.companion.group.position, this.world.session);
    });
    this.brain = new CompanionBrain(
      {
        suggestions: () =>
          this.linkRows
            .filter((r) => r.pair)
            .map((r) => {
              const [a, b] = r.pair!;
              const name = (id: string): string => this.library.vault?.notes.get(id)?.name ?? id;
              return { a, b, aName: name(a), bName: name(b), why: r.sub };
            }),
        questions: () => this.questionRows.map((r) => r.title),
        writing: () => this.writing || this.search.mesh.visible,
        busy: () => !!this.touring || !!this.timeMachine,
      },
      performance.now(),
    );
    const prefs = readPrefs();
    this.sound.enabled = this.sound.hapticsEnabled = prefs.sound;
    this.brain.enabled = prefs.pet;
    if (prefs.motion !== null) setReduceMotion(!prefs.motion);
    this.syncTools();
    const wake = (): void => this.brain.active(performance.now());
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, wake, { passive: true });
    window.addEventListener('pointerdown', () => this.sound.unlock(), { passive: true });
    this.composer.mesh.visible = false;
    this.search.mesh.visible = false;
    this.hint.mesh.visible = false;

    this.readFovDesktop();
    this.bindGraph();
    this.bindCatcher();
    this.dock.onAction = (id) => this.onDock(id as DockAction);
    this.composer.onAction = (id) => this.onComposer(id);
    this.search.onAction = (id, data) => this.onSearch(id, data);
    this.search.colorOf = (p) => this.graph.colorOf(p);

    library.on('changed', () => this.refresh(false));
    library.on('insights', () => this.refresh(false));
    library.on('opened', () => {
      this.refresh(true);
      void this.restoreWall();
      void this.library
        .getState<string[]>('dismissed')
        .then((d) => {
          this.dismissed = new Set(Array.isArray(d) ? d : []);
          this.renderInsights();
        })
        .catch(() => undefined);
    });

    // scene understanding hands us the real planes as entities; keep a live list of them
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    class PlaneWatch extends createSystem({ planes: { required: [XRPlane] } }) {
      update(): void {
        app.planes = [...this.queries.planes.entities];
      }
    }
    world.registerSystem(PlaneWatch);

    world.visibilityState.subscribe((v) => {
      const now = v !== VisibilityState.NonImmersive;
      if (now && !this.immersive) this.onEnterSession();
      if (!now && this.immersive) this.onExitSession();
      this.immersive = now;
    });
  }

  private register(obj: Object3D, poke: boolean): Entity {
    const e = this.world.createTransformEntity(obj, { persistent: true });
    e.addComponent(RayInteractable);
    if (poke) {
      e.addComponent(PokeInteractable);
      this.pokeable.push(obj);
    }
    this.entities.push(e);
    return e;
  }

  // ---------- data ----------

  /** Rebuild the graph from the library (full = a different vault was opened). */
  refresh(full: boolean): void {
    const vault = this.library.vault;
    if (!vault) return;
    if (!full && vault.version === this.lastVersion) {
      this.graph.markStyleDirty();
      this.renderInsights();
      return;
    }
    this.lastVersion = vault.version;
    const g = vault.graph();
    let insights = null;
    try {
      insights = this.library.insights();
    } catch {
      insights = null;
    }
    const nodes: LayoutNode[] = g.nodes.map((n) => ({ id: n.id, degree: n.degree, topic: insights?.topicOf.get(n.id), ghost: n.ghost }));
    const previous = full ? undefined : this.positions;
    this.positions = layoutGraph(nodes, g.links, { previous: previous?.size ? previous : undefined });
    if (full) void this.library.setState('layout', Object.fromEntries(this.positions));
    this.graph.setData(g, insights, this.positions);
    this.territories.set(insights?.topics ?? [], insights?.bridges ?? []);
    this.minimap.setData(
      this.graph.nodes.map((n) => n.id),
      this.graph.positions,
      this.graph.centre(),
      this.graph.radius(),
      (id) => (this.graph.nodes[this.graph.index.get(id) ?? -1]?.ghost ? '#3a4152' : this.graph.colorOf(id)),
    );
    this.renderInsights();
    if (full) {
      this.fitGraph();
      for (const c of [...this.cards]) this.closeCard(c);
    } else {
      for (const c of this.cards) if (c.path) this.showCard(c.path, c);
    }
  }

  /** Scale the graph to ~1.15 m radius and set it on the "galaxy table" in front of you. */
  fitGraph(): void {
    const b = bounds(this.positions.values());
    const table = this.room.table;
    const scale = (table ? table.radius : ERGO.graphRadius) / b.r;
    this.graph.root.scale.setScalar(scale);
    this.manip.minScale = scale * 0.15;
    this.manip.maxScale = scale * 12;
    const centre = new Vector3(b.cx, b.cy, b.cz);
    const h = this.home;
    const fwd = new Vector3(-Math.sin(h.yaw), 0, -Math.cos(h.yaw));
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), table ? 0 : this.immersive ? ERGO.graphTilt : 0.12);
    this.graph.root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), h.yaw).multiply(tilt);
    const target = h.position.clone().addScaledVector(fwd, this.immersive ? ERGO.graphDistance : ERGO.graphDistance * 1.45);
    target.y = h.position.y - (this.immersive ? ERGO.graphDrop : 0.25);
    // mixed reality: a small galaxy standing on your real table
    if (table) target.set(table.x, table.y + table.radius + 0.04, table.z);
    // put the layout centre at the target point
    this.graph.root.position.copy(target).sub(centre.clone().multiplyScalar(scale).applyQuaternion(this.graph.root.quaternion));
  }

  // ---------- session ----------

  private onEnterSession(): void {
    this.input.end();
    requestAnimationFrame(() => {
      this.readFov();
      this.recenter();
      this.startTour();
    });
    const session = this.world.session;
    const blend = (session as (XRSession & { environmentBlendMode?: string }) | undefined)?.environmentBlendMode;
    const passthrough = blend === 'alpha-blend' || blend === 'additive';
    this.env.visible = !passthrough;
    this.graph.setPassthrough(passthrough);
    this.territories.passthrough = passthrough;
    this.room = { mixed: passthrough, table: null, wall: null, searchUntil: performance.now() + 10000, nextLook: 0 };
    this.flows.setPassthrough(passthrough);
    this.sound.unlock();
    session?.addEventListener('selectstart', () => this.brain.active(performance.now()));
    setTimeout(() => this.brain.insightsReady(performance.now(), new Date().getHours()), 1500);
  }

  private onExitSession(): void {
    this.room = { mixed: false, table: null, wall: null, searchUntil: 0, nextLook: 0 };
    this.wall.setRadius(WALL_R);
    this.input.end();
    this.closeComposer();
    this.manip.cancel();
    this.env.visible = true;
    this.graph.setPassthrough(false);
    this.hint.show('');
    this.readFovDesktop();
    this.recenter();
  }

  private readFov(): void {
    const xrCam = this.world.renderer.xr.getCamera();
    const cams = (xrCam as unknown as { cameras?: { projectionMatrix: { elements: number[] } }[] }).cameras ?? [];
    if (cams.length >= 1) {
      let f = fovFromProjection(cams[0]!.projectionMatrix.elements);
      for (const c of cams.slice(1)) f = unionFov(f, fovFromProjection(c.projectionMatrix.elements));
      if (Number.isFinite(f.left + f.right + f.up + f.down)) this.fov = f;
    }
    this.shelf = shelfFor(this.fov);
  }

  /** A flat window shows far less than a headset: push the shelf back so a whole card fits. */
  private readFovDesktop(): void {
    this.fov = QUEST_FOV;
    this.shelf = { ...shelfFor(QUEST_FOV), radius: 1.75, activeAz: 11, drop: 0.12 };
  }

  private headPose(): { pos: Vector3; quat: Quaternion } {
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    const pos = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const quat = new Quaternion().setFromRotationMatrix(cam.matrixWorld);
    return { pos, quat };
  }

  /** Bring everything back in front of wherever you face now. */
  recenter(): void {
    const { pos, quat } = this.headPose();
    if (pos.y < 0.5) pos.y = 1.2; // seated or reference space without floor
    this.home = { position: pos, yaw: yawOf(quat) };
    this.wall.anchor(pos, this.room.wall ? this.room.wall.yaw : this.home.yaw);
    this.wallSig = '';
    this.fitGraph();
    this.moved.clear();
    this.layoutCards(true);
    this.placeDock(true);
  }

  // ---------- frame ----------

  update(dt: number): void {
    this.flushRetired();
    const { pos: eye, quat } = this.headPose();
    this.catcher.position.copy(eye);
    this.manip.update(dt);
    const reduced = reduceMotion();
    this.graph.reducedMotion = reduced;
    this.graph.update(this.world.camera, dt);
    this.followLazily(eye, quat);
    this.animateCards(dt, reduced);
    for (const s of [this.dock, this.tools, this.composer, this.editor, this.search, this.insightsPanel, ...this.cards, ...this.tags]) s.update();
    this.hint.update();
    this.hint.tick(dt);
    if (this.composer.mesh.visible) this.composer.tick(dt);
    if (this.editor.mesh.visible) this.editor.tick(dt);
    this.updateConnect();
    this.updatePanelDrag();
    this.updateTouchReach();
    this.updateWall(dt);
    this.updateOverview(dt, eye, quat);
    this.lookForRoom(eye, quat);
    this.updateFlows(dt, reduced);
    this.updateTethers();
    this.updateExplore(dt);
    this.updateCompanion(dt, eye, quat, reduced);
    const up = new Vector3(0, 1, 0).applyQuaternion(quat);
    this.sound.listen(eye, FORWARD.clone().applyQuaternion(quat), up);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.nextTourHint();
    }
    // the hint floats above the graph, facing you
    const fwd = FORWARD.clone().applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.home.yaw));
    this.hint.mesh.position.copy(this.home.position).addScaledVector(fwd, 1.6);
    this.hint.mesh.position.y = this.home.position.y + 0.42;
    faceTowards(this.hint.mesh, eye);
  }

  /** Re-anchor the shelf and dock when you have turned far away from them (lazy follow). */
  private followLazily(eye: Vector3, quat: Quaternion): void {
    const yaw = yawOf(quat);
    const d = angleDiff(yaw, this.home.yaw);
    const wz = (angleDiff(this.wall.yaw, yaw) * 180) / Math.PI;
    const atWall = this.onWall.size > 0 && wz > WALL_AZ[0] - 15 && wz < WALL_AZ[1] + 8;
    if (!atWall && Math.abs(d) > (50 * Math.PI) / 180 && !this.manip.active && !this.panelDrag && !this.connect) {
      this.home = { position: eye.clone(), yaw };
      this.layoutCards(false);
    }
    this.placeDock(false, eye, yaw);
  }

  private dockYaw = 0;
  private placeDock(snap: boolean, eye = this.home.position, yaw = this.home.yaw): void {
    if (snap) this.dockYaw = yaw;
    else if (Math.abs(angleDiff(yaw, this.dockYaw)) > (28 * Math.PI) / 180) this.dockYaw += angleDiff(yaw, this.dockYaw) * 0.08;
    // desktop preview: the window is narrower than a headset view, keep the dock just inside it
    const pitch = ((this.immersive ? this.shelf.dockPitch : -17) * Math.PI) / 180;
    // with hands the menu comes within a fingertip's reach (an easy forward reach, 0.5 m from the eyes),
    // but no closer, or it would sit in the path of a hand pointing at the graph;
    // with controllers it stays a little further out, for the ray
    const r = this.immersive ? (this.handsActive() ? 0.5 : 0.55) : 0.95;
    const target = new Vector3(-Math.sin(this.dockYaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, -Math.cos(this.dockYaw) * Math.cos(pitch) * r).add(eye);
    if (snap) this.dock.mesh.position.copy(target);
    else this.dock.mesh.position.lerp(target, 0.12);
    faceTowards(this.dock.mesh, eye);
    // the "More" row sits just above the dock
    this.tools.mesh.position.copy(this.dock.mesh.position).setY(this.dock.mesh.position.y + this.dock.heightM / 2 + this.tools.heightM / 2 + 0.012);
    faceTowards(this.tools.mesh, eye);
  }

  // ---------- graph input ----------

  private bindGraph(): void {
    const pick = (): Object3D | null => this.graph.pickMesh;
    const on = (type: string, fn: (e: XRPointerEvent) => void): void => {
      (this.graph.root as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void }).addEventListener(type, fn);
    };
    const idOf = (e: XRPointerEvent): string | null => {
      if (e.object !== pick() || e.instanceId === undefined) return null;
      return this.graph.nodes[e.instanceId]?.id ?? null;
    };
    on('pointermove', (e) => {
      if (this.connect) return;
      const id = idOf(e);
      if (id && id !== this.graph.hovered) this.sound.play('hover', this.graph.worldPos(id) ?? e.point, this.world.session);
      this.graph.setHovered(id);
    });
    on('pointerleave', () => this.graph.setHovered(null));
    on('pointerdown', (e) => {
      const id = idOf(e);
      if (!id || Surface.quiet(e) || this.atMap(e)) return;
      e.stopPropagation();
      this.stopAutoTour();
      this.turn = null; // a star you grab stays where it is
      this.sound.play('grab', e.point, this.world.session);
      this.connect = { pointerId: e.pointerId, from: id, startDir: dirOf(e), moved: false, target: null };
      this.graph.root.setPointerCapture(e.pointerId);
      this.lastPointer.set(e.pointerId, e);
    });
    on('pointermove', (e) => {
      if (this.connect?.pointerId === e.pointerId) this.lastPointer.set(e.pointerId, e);
    });
    on('pointerup', (e) => {
      const c = this.connect;
      if (!c || c.pointerId !== e.pointerId) return;
      e.stopPropagation();
      this.graph.root.releasePointerCapture(e.pointerId);
      this.connect = null;
      this.rubber.visible = false;
      this.graph.setHighlight([]);
      if (!c.moved) {
        this.select(c.from);
      } else if (c.target && c.target !== c.from) {
        void this.beginConnection(c.from, c.target);
      }
    });
  }

  private lastPointer = new Map<number, XRPointerEvent>();

  /** While dragging from a star: rubber band to the nearest star under the ray. */
  private updateConnect(): void {
    const c = this.connect;
    if (!c) return;
    const e = this.lastPointer.get(c.pointerId);
    if (!e) return;
    const origin = new Vector3(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
    const dir = dirOf(e);
    if (!c.moved && dir.angleTo(c.startDir) > (2.5 * Math.PI) / 180) c.moved = true;
    if (!c.moved) return;
    const from = this.graph.worldPos(c.from);
    if (!from) return;
    const target = this.graph.nearestToRay(new Ray(origin, dir), 3.5, c.from);
    c.target = target;
    const to = target ? this.graph.worldPos(target)! : origin.clone().addScaledVector(dir, origin.distanceTo(from));
    const attr = this.rubber.geometry.getAttribute('position') as Float32BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    (this.rubber.material as LineBasicMaterial).color.set(target ? COLORS.gold : COLORS.textDim);
    this.rubber.visible = true;
    this.graph.setHighlight(target ? [c.from, target] : [c.from]);
  }

  private bindCatcher(): void {
    const on = (type: string, fn: (e: XRPointerEvent) => void): void => {
      (this.catcher as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void }).addEventListener(type, fn);
    };
    let mouse: { id: number; x: number; y: number } | null = null;
    on('pointerdown', (e) => {
      if (Surface.quiet(e) || this.atMap(e)) return;
      this.stopAutoTour();
      this.catcher.setPointerCapture(e.pointerId);
      if (isScreenPointer(e)) {
        mouse = { id: e.pointerId, x: e.point.x, y: e.point.y };
        this.mouseLast = dirOf(e);
        return;
      }
      this.manip.begin(e.pointerId, e.pointerPosition);
    });
    on('pointermove', (e) => {
      if (mouse && mouse.id === e.pointerId) {
        const d = dirOf(e);
        const last = this.mouseLast ?? d;
        const dYaw = Math.atan2(d.x, -d.z) - Math.atan2(last.x, -last.z);
        const dPitch = Math.asin(Math.max(-1, Math.min(1, d.y))) - Math.asin(Math.max(-1, Math.min(1, last.y)));
        this.mouseLast = d;
        const pivot = this.graph.worldPos(this.graph.selected ?? '') ?? this.graphCentreWorld();
        const right = new Vector3(1, 0, 0).applyQuaternion(this.headPose().quat);
        this.manip.orbit(pivot, dYaw * 2.5, -dPitch * 2.5, right);
        return;
      }
      this.manip.move(e.pointerId, e.pointerPosition);
    });
    on('pointerup', (e) => {
      this.catcher.releasePointerCapture(e.pointerId);
      if (mouse && mouse.id === e.pointerId) {
        mouse = null;
        return;
      }
      this.manip.end(e.pointerId);
    });
    on('wheel', (e) => {
      const dy = e.deltaY ?? e.nativeEvent?.deltaY ?? 0;
      this.manip.zoom(this.graphCentreWorld(), Math.exp(-dy * 0.0015));
    });
    // a click on empty space closes unpinned cards (the original behaviour)
    on('click', () => {
      if (this.manip.active) return;
    });
  }

  private mouseLast: Vector3 | null = null;

  private graphCentreWorld(): Vector3 {
    return this.graph.centre().applyMatrix4(this.graph.root.matrixWorld);
  }

  // ---------- reading ----------

  select(path: string, opts: { auto?: boolean; turned?: boolean } = {}): void {
    const vault = this.library.vault;
    if (!vault) return;
    if (!opts.auto) {
      this.stopAutoTour();
      this.stopTimeMachine();
      if (this.pathPick) {
        const from = this.pathPick;
        this.pathPick = null;
        this.hint.show('');
        for (const c of this.cards)
          if (c.pathPicking) {
            c.pathPicking = false;
            c.invalidate();
          }
        if (from !== path) this.findPath(from, path);
      } else if (this.path && !this.path.includes(path)) {
        this.path = null;
        this.graph.setHighlight([]);
      }
      if (this.suggestPair && !this.suggestPair.includes(path)) {
        this.suggestPair = null;
        this.graph.setHighlight(this.path ?? []);
      }
    }
    if (!vault.notes.has(path)) {
      // a ghost: offer to write the missing note
      const node = this.graph.nodes[this.graph.index.get(path) ?? -1];
      if (node?.ghost) this.openComposer({ kind: 'new' }, node.name);
      return;
    }
    this.graph.setSelected(path);
    if (!opts.turned) this.turnTo(path);
    this.showCard(path);
    this.sound.play('select', this.graph.worldPos(path) ?? this.home.position, this.world.session);
    this.tourDone('read');
  }

  /** Show `path` in the active card (or in `card` when refreshing a pinned one). */
  showCard(path: string, card?: NoteCard): void {
    const vault = this.library.vault;
    const view = vault?.view(path);
    if (!vault || !view) return;
    let c = card ?? this.cards.find((x) => !this.pinned.has(x.path ?? '') && !this.onWall.has(x));
    if (!c) c = this.newCard();
    let related: { path: string; name: string; reason: string }[] = [];
    try {
      const ins = this.library.insights();
      const name = (p: string): string => vault.notes.get(p)?.name ?? p;
      related = relatedFor(ins, path).map((r) => ({ path: r.other, name: name(r.other), reason: reasonText(r, name) }));
    } catch {
      related = [];
    }
    const m = this.motion.get(c);
    if (m && c.path !== path) m.swap = performance.now();
    if (!card) this.brain.opened({ path, name: view.note.name, backlinks: view.backlinks.length }, performance.now());
    c.show({
      view,
      color: this.graph.colorOf(path),
      related,
      resolve: (target) => vault.resolve(target, path),
      pinned: this.pinned.has(path),
      onWall: this.onWall.has(c),
    });
    c.mesh.visible = true;
    this.layoutCards(false);
  }

  private newCard(): NoteCard {
    const c = new NoteCard(ERGO.cardWidth);
    c.onAction = (id, data, s) => this.onCard(s as NoteCard, id, data);
    this.register(c.mesh, false);
    this.bindPanelDrag(c);
    const m = c.mesh as unknown as { addEventListener(t: string, f: () => void): void };
    m.addEventListener('pointerenter', () => this.hoveredCards.add(c));
    m.addEventListener('pointerleave', () => this.hoveredCards.delete(c));
    this.cards.unshift(c);
    this.motion.set(c, { goal: new Vector3(), born: performance.now(), swap: 0 });
    c.mesh.scale.setScalar(reduceMotion() ? 1 : MOTION.popFrom);
    this.sound.play('open', this.home.position, null);
    return c;
  }

  /**
   * Take a panel out of the scene. It disappears now, but its entity is only torn down at the start of
   * the next frame: the tap that closed it is still being delivered to it, and tearing it down in the
   * middle of that delivery breaks the pointer system and stops the whole render loop.
   */
  private retire(s: Surface): void {
    s.mesh.visible = false;
    s.onAction = null;
    const e = this.entities.find((x) => x.object3D === s.mesh);
    if (e) this.entities.splice(this.entities.indexOf(e), 1);
    this.retiring.push({ entity: e ?? null, surface: s });
  }

  private flushRetired(): void {
    if (!this.retiring.length) return;
    const list = this.retiring;
    this.retiring = [];
    for (const { entity, surface } of list) {
      try {
        if (entity) entity.dispose();
        else surface.dispose();
      } catch (err) {
        console.warn('panel cleanup failed', err);
      }
    }
  }

  private closeCard(c: NoteCard): void {
    if (!this.cards.includes(c) && !this.onWall.has(c)) return; // already closed (a double tap)
    if (c.path) this.pinned.delete(c.path);
    const i = this.cards.indexOf(c);
    if (i >= 0) this.cards.splice(i, 1);
    this.moved.delete(c);
    this.hoveredCards.delete(c);
    this.zoom.delete(c);
    this.motion.delete(c);
    this.sound.play('close', c.mesh.position, null);
    if (this.onWall.delete(c)) this.wallChanged();
    this.retire(c);
    if (this.graph.selected === c.path) this.graph.setSelected(this.cards[0]?.path ?? null);
  }

  /** Active card at the shelf's sweet spot; pinned cards fan out to its right, then to the left. */
  private layoutCards(snap: boolean): void {
    const s = this.shelf;
    const shelf = this.cards.filter((c) => !this.onWall.has(c));
    const active = shelf.filter((c) => !this.pinned.has(c.path ?? ''));
    const pinned = shelf.filter((c) => this.pinned.has(c.path ?? ''));
    const slots: [NoteCard, number][] = [];
    if (active[0]) slots.push([active[0], s.activeAz]);
    pinned.forEach((c, i) => {
      const k = Math.floor(i / 2) + 1;
      const az = i % 2 === 0 ? s.activeAz + k * (s.cardDeg + 3) : s.activeAz - k * (s.cardDeg + 3) - 4;
      slots.push([c, az]);
    });
    for (const [c, az] of slots) {
      if (this.moved.has(c)) continue;
      const p = shelfPoint(this.home, az, -s.drop, s.radius);
      this.motion.get(c)?.goal.copy(p);
      if (snap || !c.mesh.userData.placed) {
        c.mesh.position.copy(p);
        c.mesh.userData.placed = true;
      }
      faceTowards(c.mesh, this.home.position);
    }
  }

  private onCard(card: NoteCard, id: string, data: string | undefined): void {
    const path = card.path;
    if (!path) return;
    if (id !== 'path') this.stopAutoTour();
    switch (id) {
      case 'close':
        this.closeCard(card);
        this.layoutCards(false);
        break;
      case 'path':
        if (this.pathPick === path) {
          this.pathPick = null;
          this.hint.show('');
        } else {
          this.pathPick = path;
          this.toastTimer = 0;
          this.hint.show(t().pathPick);
        }
        card.pathPicking = this.pathPick === path;
        card.invalidate();
        break;
      case 'pin':
        this.sound.play('pin', card.mesh.position, this.world.session);
        if (this.pinned.has(path)) this.pinned.delete(path);
        else this.pinned.add(path);
        this.showCard(path, card);
        break;
      case 'edit':
        this.openEditor(path);
        break;
      case 'rename':
        this.openComposer({ kind: 'rename', path }, this.library.vault?.notes.get(path)?.name ?? '');
        break;
      case 'delete':
        if (!card.confirmDelete) {
          card.confirmDelete = true;
          card.invalidate();
          break;
        }
        void this.library
          .deleteNote(path)
          .then(() => {
            for (const c of this.cards.filter((x) => x.path === path)) this.closeCard(c);
            this.layoutCards(false);
            this.toast(t().deleted);
          })
          .catch((e: unknown) => this.toast(e instanceof Error ? e.message : String(e)));
        break;
      case 'wall':
        if (this.onWall.has(card)) this.takeDown(card);
        else this.putOnWall(card);
        break;
      case 'tab':
        card.setTab(data as 'out' | 'in' | 'related');
        break;
      case 'row':
        if (data) this.select(data);
        break;
      case 'link': {
        const target = data ? this.library.vault?.resolve(data, path) : null;
        if (target) this.select(target);
        else if (data) this.openComposer({ kind: 'new' }, data);
        break;
      }
      case 'accept':
        if (data) void this.beginConnection(path, data);
        break;
    }
  }

  // ---------- moving panels by their top edge ----------

  private bindPanelDrag(s: Surface): void {
    const m = s.mesh as unknown as { addEventListener(t: string, f: (e: XRPointerEvent) => void): void };
    m.addEventListener('pointerdown', (e) => {
      // the top strip is the handle (taller on the wall, where cards hang at half size)
      if (!e.uv || e.uv.y < (s instanceof NoteCard && this.onWall.has(s) ? 0.8 : 0.9)) return;
      const origin = new Vector3(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
      this.panelDrag = { pointerId: e.pointerId, surface: s, distance: origin.distanceTo(s.mesh.position) };
      this.lastPointer.set(e.pointerId, e);
      s.mesh.setPointerCapture(e.pointerId);
    });
    m.addEventListener('pointermove', (e) => {
      if (this.panelDrag?.pointerId === e.pointerId) this.lastPointer.set(e.pointerId, e);
    });
    m.addEventListener('pointerup', (e) => {
      if (this.panelDrag?.pointerId === e.pointerId) {
        s.mesh.releasePointerCapture(e.pointerId);
        this.panelDrag = null;
        if (s instanceof NoteCard) this.dropCard(s);
      }
    });
  }

  private updatePanelDrag(): void {
    const d = this.panelDrag;
    if (!d) return;
    const e = this.lastPointer.get(d.pointerId);
    if (!e) return;
    const origin = new Vector3(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
    const target = origin.clone().addScaledVector(dirOf(e), d.distance);
    if (target.distanceTo(d.surface.mesh.position) > 0.01 && d.surface instanceof NoteCard) this.moved.add(d.surface);
    d.surface.mesh.position.lerp(target, 0.5);
    faceTowards(d.surface.mesh, this.headPose().pos);
    // shrinks to wall size while it's over the wall, so you see how it will hang there
    if (d.surface instanceof NoteCard) {
      const over = this.wallGeo.inZone(this.locateOnWall(d.surface.mesh.position));
      const want = over ? WALL_SCALE : 1;
      d.surface.mesh.scale.setScalar(d.surface.mesh.scale.x + (want - d.surface.mesh.scale.x) * 0.25);
    }
  }

  // ---------- writing ----------

  private openComposer(mode: WriteMode, initial = ''): void {
    const vault = this.library.vault;
    if (!vault) return;
    this.writeMode = mode;
    const tr = t();
    let title = tr.newNoteTitle;
    let context = '';
    let placeholder = '';
    let skippable = false;
    let accent: string = COLORS.accent;
    if (mode.kind === 'append') {
      title = tr.edit;
      context = vault.notes.get(mode.path)?.name ?? '';
      accent = this.graph.colorOf(mode.path);
    } else if (mode.kind === 'reason') {
      title = tr.whyLinked;
      context = `${vault.notes.get(mode.from)?.name ?? mode.from}  ↔  ${vault.notes.get(mode.to)?.name ?? mode.to}`;
      placeholder = tr.reasonPlaceholder;
      skippable = true;
      accent = COLORS.gold;
    } else if (mode.kind === 'rename') {
      title = tr.renameTitle;
      context = vault.notes.get(mode.path)?.name ?? '';
      accent = this.graph.colorOf(mode.path);
    } else if (mode.kind === 'answer') {
      title = tr.answerTitle;
      context = mode.question;
      accent = COLORS.gold;
    }
    const render = (): void =>
      this.composer.set({
        title,
        context,
        placeholder,
        text: this.input.text,
        caret: this.input.caret,
        keyboardOpen: this.input.keyboardOpen,
        skippable,
        accent,
        hint: tr.keyboardHint,
      });
    this.input.begin(initial, render, { multiline: mode.kind !== 'reason' && mode.kind !== 'rename' });
    this.input.onSubmit = () => void this.saveComposer();
    this.input.onCancel = () => this.cancelComposer();
    render();
    // the writing card sits low and close, where the keyboard will appear just beneath it
    // (the menu steps aside meanwhile, so nothing sits between the card and the keyboard)
    const p = shelfPoint(this.home, 0, -0.1, 0.62);
    this.composer.mesh.position.copy(p);
    faceTowards(this.composer.mesh, this.home.position);
    this.composer.mesh.visible = true;
    this.dock.mesh.visible = false;
    if (!this.immersive) this.input.showKeyboard(); // desktop: type straight away
  }

  /** Is a writing panel (the writing card or the note editor) open? */
  get writing(): boolean {
    return this.composer.mesh.visible || this.editor.mesh.visible;
  }

  // ---------- editing a note, block by block ----------

  private openEditor(path: string): void {
    const note = this.library.vault?.notes.get(path);
    if (!note) return;
    this.closeComposer();
    const { front, blocks } = splitBlocks(note.raw);
    // a title-only note still gets a block to write in
    if (!blocks.length) blocks.push('');
    const mode: WriteMode = { kind: 'edit', path, front, blocks, index: blocks.length - 1, dirty: false };
    this.writeMode = mode;
    const render = (): void => {
      if (this.writeMode !== mode) return;
      if (this.input.text !== mode.blocks[mode.index]) {
        mode.blocks[mode.index] = this.input.text;
        mode.dirty = true;
      }
      this.editor.set({
        name: note.name,
        accent: this.graph.colorOf(path),
        blocks: mode.blocks,
        index: mode.index,
        text: this.input.text,
        caret: this.input.caret,
        keyboardOpen: this.input.keyboardOpen,
        dirty: mode.dirty,
      });
    };
    this.input.begin(mode.blocks[mode.index]!, render, { multiline: true });
    this.input.onSubmit = () => void this.saveEditor();
    this.input.onCancel = () => this.closeEditor();
    render();
    const p = shelfPoint(this.home, 0, -0.06, 0.66);
    this.editor.mesh.position.copy(p);
    faceTowards(this.editor.mesh, this.home.position);
    this.editor.mesh.visible = true;
    this.dock.mesh.visible = false;
    this.tools.mesh.visible = false;
    if (!this.immersive) this.input.showKeyboard();
  }

  /** A pinch on the text: put the cursor where it landed, and bring up the keyboard. */
  private placeCaret(at: number | null): void {
    if (at !== null) this.input.setCaret(at);
    this.input.showKeyboard();
  }

  private onEditor(id: string, data: string | undefined): void {
    const mode = this.writeMode;
    if (mode?.kind !== 'edit') return;
    const choose = (i: number): void => {
      mode.blocks[mode.index] = this.input.text;
      mode.index = Math.max(0, Math.min(mode.blocks.length - 1, i));
      this.input.setText(mode.blocks[mode.index]!);
    };
    switch (id) {
      case 'type':
        this.placeCaret(this.editor.caretAtPoint(this.editor.lastPoint));
        break;
      case 'block':
        choose(Number(data));
        break;
      case 'prev':
        choose(mode.index - 1);
        break;
      case 'next':
        choose(mode.index + 1);
        break;
      case 'word':
        this.input.deleteWord();
        break;
      case 'clear':
        this.input.clear();
        break;
      case 'below':
        mode.blocks[mode.index] = this.input.text;
        mode.blocks.splice(mode.index + 1, 0, '');
        mode.dirty = true;
        choose(mode.index + 1);
        this.input.showKeyboard();
        break;
      case 'remove':
        mode.blocks.splice(mode.index, 1);
        if (!mode.blocks.length) mode.blocks.push('');
        mode.dirty = true;
        mode.index = Math.min(mode.index, mode.blocks.length - 1);
        this.input.setText(mode.blocks[mode.index]!);
        break;
      case 'save':
        void this.saveEditor();
        break;
      case 'cancel':
        this.closeEditor();
        break;
    }
  }

  private async saveEditor(): Promise<void> {
    const mode = this.writeMode;
    if (mode?.kind !== 'edit') return;
    mode.blocks[mode.index] = this.input.end();
    const raw = joinBlocks({ front: mode.front, blocks: mode.blocks });
    this.closeEditor();
    try {
      await this.library.saveNote(mode.path, raw);
      this.toast(t().saved);
      this.brain.saved(performance.now());
      this.showCard(mode.path);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }

  private closeEditor(): void {
    this.input.end();
    this.editor.mesh.visible = false;
    this.dock.mesh.visible = true;
    if (this.writeMode?.kind === 'edit') this.writeMode = null;
  }

  private onComposer(id: string): void {
    if (id === 'type') this.placeCaret(this.composer.caretAtPoint(this.composer.lastPoint));
    else if (id === 'delete') this.input.deleteWord();
    else if (id === 'save') void this.saveComposer();
    else if (id === 'cancel') {
      if (this.writeMode?.kind === 'reason') void this.saveComposer(true);
      else this.cancelComposer();
    }
  }

  private cancelComposer(): void {
    this.input.end();
    this.closeComposer();
  }

  private closeComposer(): void {
    this.composer.mesh.visible = false;
    this.dock.mesh.visible = true;
    this.writeMode = null;
  }

  private async saveComposer(skipText = false): Promise<void> {
    const mode = this.writeMode;
    const text = this.input.end().trim();
    this.closeComposer();
    if (!mode) return;
    const lib = this.library;
    try {
      if (mode.kind === 'new') {
        if (!text) return;
        const [first, ...rest] = text.split('\n');
        const title = (first ?? '').replace(/^#+\s*/, '').slice(0, 80) || t().newNoteTitle;
        const body = rest.join('\n').trim();
        const path = await lib.createNote(title, 'Inbox', `# ${title}\n\n${body}\n`);
        this.toast(t().saved);
        this.brain.created(performance.now());
        this.select(path);
      } else if (mode.kind === 'append') {
        if (!text) return;
        const note = lib.vault?.notes.get(mode.path);
        if (!note) return;
        await lib.saveNote(mode.path, note.raw.replace(/\s+$/, '') + '\n\n' + text + '\n');
        this.toast(t().saved);
        this.brain.saved(performance.now());
        this.showCard(mode.path);
      } else if (mode.kind === 'rename') {
        if (!text) return;
        const changed = await lib.rename(mode.path, text);
        const now = changed[0]; // the note's new path comes first, then the notes whose links were updated
        this.toast(t().renamed(changed.length));
        if (!now) return;
        // the same cards (on the shelf or on the wall) now show the renamed note
        for (const c of this.cards.filter((x) => x.path === mode.path)) {
          if (this.pinned.delete(mode.path)) this.pinned.add(now);
          this.showCard(now, c);
        }
        this.graph.setSelected(now);
        this.wallChanged();
      } else if (mode.kind === 'answer') {
        if (!text) return;
        const vault = lib.vault;
        if (!vault) return;
        const [first, ...rest] = text.split('\n');
        const title = (first ?? '').replace(/^#+\s*/, '').slice(0, 80) || t().answerTitle;
        const probe = `Inbox/${title}.md`;
        const sources = mode.paths.map((p) => `[[${vault.linkText(probe, p)}]]`).join(' · ');
        const body = [rest.join('\n').trim(), mode.question ? `> ${mode.question}` : '', `${t().sources}: ${sources}`].filter(Boolean).join('\n\n');
        const path = await lib.createNote(title, 'Inbox', `# ${title}\n\n${body}\n`);
        this.toast(t().saved);
        this.addToGroup(path, mode.paths);
      } else if (mode.kind === 'reason') {
        const written = await lib.link(mode.from, mode.to, skipText ? '' : text);
        this.toast(t().linked);
        this.brain.linked(performance.now());
        this.sound.play('link', this.graph.worldPos(mode.to) ?? this.home.position, this.world.session);
        this.tourDone('connect');
        this.select(written);
      }
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err));
    }
  }

  /** A new connection: ask why (one line, optional), then write it into the note. */
  private beginConnection(from: string, to: string): Promise<void> {
    const vault = this.library.vault;
    if (!vault?.notes.has(from) || (!vault.notes.has(to) && !vault.attachments.has(to))) {
      this.toast(t().noLinks);
      return Promise.resolve();
    }
    this.graph.setHighlight([from, to]);
    this.openComposer({ kind: 'reason', from, to });
    return Promise.resolve();
  }

  // ---------- the thinking wall ----------

  private locateOnWall(p: Vector3): WallSpot & { r: number } {
    return this.wallGeo.locate(this.wall.origin, this.wall.yaw, p);
  }

  private wallSpots(except?: NoteCard): WallSpot[] {
    return [...this.onWall].filter(([c]) => c !== except).map(([, s]) => s);
  }

  /** Hang a card on the wall at `spot` (or the next free place). A note is on the wall at most once. */
  putOnWall(card: NoteCard, spot?: WallSpot): void {
    const path = card.path;
    if (!path) return;
    const dup = [...this.onWall.keys()].find((c) => c !== card && c.path === path);
    if (dup) {
      this.closeCard(card);
      this.zoomOf(dup).want = true; // already there: bring it forward so you see where
      return;
    }
    if (!this.onWall.size) this.wall.anchor(this.home.position, this.home.yaw);
    const others = this.wallSpots(card);
    this.onWall.set(card, this.wallGeo.settle(spot ?? this.wallGeo.nextFree(others) ?? { az: -40, h: 0 }, others));
    this.pinned.delete(path);
    this.moved.delete(card);
    this.showCard(path, card);
    this.wallChanged();
  }

  /** Take a card off the wall: it becomes a pinned card on the reading shelf. */
  private takeDown(card: NoteCard): void {
    if (!card.path || !this.onWall.delete(card)) return;
    this.zoom.delete(card);
    card.mesh.scale.setScalar(1);
    this.pinned.add(card.path);
    this.moved.delete(card);
    this.showCard(card.path, card);
    this.wallChanged();
  }

  /** A carried card was let go: near the wall it sticks there (next to a card = same group). */
  private dropCard(card: NoteCard): void {
    const s = this.locateOnWall(card.mesh.position);
    if (this.wallGeo.inZone(s)) {
      if (this.onWall.has(card)) {
        this.onWall.set(card, this.wallGeo.settle(s, this.wallSpots(card)));
        this.moved.delete(card);
        this.wallChanged();
      } else this.putOnWall(card, s);
    } else if (this.onWall.has(card)) {
      // pulled off the wall: it stays where you left it, pinned
      this.onWall.delete(card);
      card.mesh.scale.setScalar(1);
      if (card.path) this.pinned.add(card.path);
      this.moved.add(card);
      if (card.path) this.showCard(card.path, card);
      this.wallChanged();
    } else card.mesh.scale.setScalar(1);
  }

  /** Bring a note into a wall group (a missing piece, or an answer you just wrote). */
  private addToGroup(path: string, groupPaths: string[]): void {
    if ([...this.onWall.keys()].some((c) => c.path === path)) return;
    const group = [...this.onWall].filter(([c]) => c.path && groupPaths.includes(c.path)).map(([, s]) => s);
    const spot = group.length ? this.wallGeo.besideGroup(group, this.wallSpots()) : this.wallGeo.nextFree(this.wallSpots());
    const card = this.newCard();
    this.onWall.set(card, spot ?? { az: -40, h: 0 });
    this.showCard(path, card);
    const pose = this.wallGeo.pose(this.wall.origin, this.wall.yaw, this.onWall.get(card)!);
    card.mesh.position.set(pose.x, pose.y, pose.z);
    card.mesh.scale.setScalar(pose.scale);
    this.wallChanged();
  }

  private zoomOf(c: NoteCard): WallZoom {
    let z = this.zoom.get(c);
    if (!z) this.zoom.set(c, (z = { z: 0, hoverAt: 0, leaveAt: 0, want: false }));
    return z;
  }

  private updateWall(dt: number): void {
    const now = performance.now();
    const carrying = this.panelDrag?.surface instanceof NoteCard ? this.panelDrag.surface : null;
    const lookAt = new Vector3(this.wall.origin.x, this.wall.origin.y + 0.05, this.wall.origin.z);
    for (const [c, spot] of this.onWall) {
      if (c === carrying) continue;
      // a card you keep pointing at comes forward to reading size; it goes back when you look away
      const z = this.zoomOf(c);
      if (this.hoveredCards.has(c)) {
        z.leaveAt = 0;
        z.hoverAt ||= now;
        if (now - z.hoverAt > 280) z.want = true;
      } else {
        z.hoverAt = 0;
        if (z.want) {
          z.leaveAt ||= now;
          if (now - z.leaveAt > 450) {
            z.want = false;
            z.leaveAt = 0;
          }
        }
      }
      z.z += ((z.want ? 1 : 0) - z.z) * Math.min(1, dt * 8);
      const pose = this.wallGeo.pose(this.wall.origin, this.wall.yaw, spot, z.z);
      c.mesh.position.lerp(tmp.set(pose.x, pose.y, pose.z), Math.min(1, dt * 12));
      c.mesh.scale.setScalar(c.mesh.scale.x + (pose.scale - c.mesh.scale.x) * Math.min(1, dt * 12));
      c.mesh.renderOrder = z.z > 0.05 ? 12 : 10;
      faceTowards(c.mesh, lookAt);
    }
    const version = this.library.vault?.version ?? 0;
    const sig = [...this.onWall].map(([c, s]) => `${c.path}@${s.az.toFixed(1)},${s.h.toFixed(2)}`).join('|') + '#' + version;
    if (sig !== this.wallSig) {
      this.wallSig = sig;
      const items = [...this.onWall].filter(([c]) => c.path);
      const groups = this.wallGeo.groups(items, ([, s]) => s);
      this.wall.setTrays(groups.map((g) => g.map(([, s]) => s)));
      this.layoutTags(groups.map((g) => g.map(([c, s]) => ({ path: c.path!, spot: s }))));
      this.wall.setRibbons(this.wallRibbons(items));
    }
    const over = carrying ? this.locateOnWall(carrying.mesh.position) : null;
    this.wall.setSurface(carrying ? 2 : this.onWall.size ? 1 : 0, over && this.wallGeo.inZone(over) ? over : null);
  }

  private wallRibbons(items: [NoteCard, WallSpot][]): Ribbon[] {
    const out: Ribbon[] = [];
    let sugg: { a: string; b: string }[] = [];
    try {
      sugg = this.library.insights().suggestions;
    } catch {
      sugg = [];
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]![0].path!;
        const b = items[j]![0].path!;
        if (this.graph.neighboursOf(a).has(b)) out.push({ a: items[i]![1], b: items[j]![1], color: 0x5ee7ff });
        else if (sugg.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a)))
          out.push({ a: items[i]![1], b: items[j]![1], color: 0xffd166, dashed: true });
      }
    return out;
  }

  private layoutTags(groups: { path: string; spot: WallSpot }[][]): void {
    while (this.tags.length > groups.length) {
      const tag = this.tags.pop()!;
      this.retire(tag);
    }
    const vault = this.library.vault;
    const name = (p: string): string => vault?.notes.get(p)?.name ?? p;
    groups.forEach((g, i) => {
      let tag = this.tags[i];
      if (!tag) {
        const created = new WallTag();
        created.onAction = (id, data) => {
          if (id === 'add' && data) this.addToGroup(data, created.paths);
          if (id === 'answer') this.openComposer({ kind: 'answer', paths: created.paths, question: created.question });
        };
        this.register(created.mesh, false);
        this.tags.push(created);
        tag = created;
      }
      const b = this.wallGeo.bounds(g.map((x) => x.spot));
      // above the group (reading upward ≤ ~28° is fine); only a group hung very high gets its label below
      const above = b.h1 + 0.03 + TAG_H <= 0.75;
      const h = above ? b.h1 + 0.03 + TAG_H / 2 : b.h0 - 0.03 - TAG_H / 2;
      const pose = this.wallGeo.pose(this.wall.origin, this.wall.yaw, { az: (b.a0 + b.a1) / 2, h });
      tag.mesh.position.set(pose.x, pose.y, pose.z);
      faceTowards(tag.mesh, new Vector3(this.wall.origin.x, this.wall.origin.y + 0.05, this.wall.origin.z));
      tag.mesh.visible = true;
      const paths = g.map((x) => x.path).sort();
      const key = paths.join('|') + '#' + (vault?.version ?? 0);
      let info = this.clusterCache.get(key) ?? null;
      if (!info) {
        try {
          info = this.library.cluster(paths);
          this.clusterCache.set(key, info);
        } catch {
          info = null;
        }
      }
      tag.set(paths, info, name);
    });
  }

  private wallChanged(): void {
    this.wallSig = '';
    if (!this.wallLoaded) return;
    if (this.wallSaveTimer) clearTimeout(this.wallSaveTimer);
    this.wallSaveTimer = setTimeout(() => {
      const cards: SavedWallCard[] = [...this.onWall].filter(([c]) => c.path).map(([c, s]) => ({ path: c.path!, az: +s.az.toFixed(2), h: +s.h.toFixed(3) }));
      void this.library.setState('wall', cards).catch(() => undefined);
    }, 400);
  }

  /** Put back the wall saved with this library. */
  private async restoreWall(): Promise<void> {
    this.wallLoaded = false;
    for (const c of [...this.onWall.keys()]) this.closeCard(c);
    let saved: SavedWallCard[] = [];
    try {
      saved = sanitizeSavedWall(await this.library.getState('wall'));
    } catch {
      saved = [];
    }
    const vault = this.library.vault;
    if (vault) this.wall.anchor(this.home.position, this.home.yaw);
    for (const it of saved) {
      if (!vault?.notes.has(it.path)) continue;
      const card = this.newCard();
      this.onWall.set(card, this.wallGeo.clamp(it));
      this.showCard(it.path, card);
      const pose = this.wallGeo.pose(this.wall.origin, this.wall.yaw, this.onWall.get(card)!);
      card.mesh.position.set(pose.x, pose.y, pose.z);
      card.mesh.scale.setScalar(pose.scale);
    }
    this.wallLoaded = true;
    this.wallSig = '';
  }

  // ---------- mixed reality: the real table and wall ----------

  /** Plain description of the planes the headset found. */
  private planeInfos(): PlaneInfo[] {
    const out: PlaneInfo[] = [];
    for (const e of this.planes) {
      const plane = e.getValue(XRPlane, '_plane') as (XRPlane & { semanticLabel?: string }) | undefined;
      const obj = e.object3D;
      if (!plane || !obj) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const p of plane.polygon) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
      obj.updateMatrixWorld();
      const c = new Vector3().setFromMatrixPosition(obj.matrixWorld);
      const n = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(obj.matrixWorld));
      out.push({
        orientation: plane.orientation ?? (Math.abs(n.y) > 0.7 ? 'horizontal' : 'vertical'),
        label: plane.semanticLabel ?? '',
        x: c.x,
        y: c.y,
        z: c.z,
        width: x1 - x0,
        depth: z1 - z0,
        normalYaw: Math.atan2(-n.x, -n.z),
      });
    }
    return out;
  }

  /** For the first seconds of a mixed-reality session, look for a table and a wall to use. */
  private lookForRoom(eye: Vector3, quat: Quaternion): void {
    const r = this.room;
    const now = performance.now();
    if (!r.mixed || now > r.searchUntil || now < r.nextLook || (r.table && r.wall)) return;
    r.nextLook = now + 500;
    const planes = this.planeInfos();
    if (!planes.length) return;
    const head = { x: eye.x, y: eye.y, z: eye.z, yaw: yawOf(quat) };
    if (!r.table) {
      r.table = findTable(planes, head);
      if (r.table) {
        this.fitGraph();
        this.toast(t().mrTable);
      }
    }
    if (!r.wall) {
      r.wall = findWall(planes, head);
      if (r.wall) {
        this.wall.setRadius(r.wall.radius);
        this.wall.anchor(this.home.position, r.wall.yaw);
        this.wallSig = '';
        if (!r.table) this.toast(t().mrWall);
      }
    }
  }

  // ---------- overview: territories, the map in your hand, insights ----------

  private updateOverview(dt: number, eye: Vector3, quat: Quaternion): void {
    if (this.turn) {
      const tn = this.turn;
      const k = reduceMotion() ? 1 : Math.min(1, (performance.now() - tn.t0) / (tn.dur * 1000));
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const step = tn.angle * e - tn.done;
      tn.done += step;
      this.graph.root.updateMatrixWorld();
      rotateAbout(this.graph.root, this.graphCentreWorld(), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), step));
      if (k >= 1) this.turn = null;
    }
    if (this.glide) {
      const k = Math.min(1, (performance.now() - this.glide.t0) / 450);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.graph.root.position.lerpVectors(this.glide.from, this.glide.to, e);
      if (k >= 1) this.glide = null;
    }
    this.territories.target = this.writing ? 0.3 : 1;
    this.territories.maxElevationDeg = this.immersive ? 18 : 9;
    this.territories.update(dt, eye);
    // on your left palm when you turn it towards you; else (shown from the menu) above the left
    // controller, or beside the menu
    const fwd = FORWARD.clone().applyQuaternion(quat).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const anchor = new Vector3();
    const palm = this.immersive ? this.leftPalm() : null;
    const palmUp = this.palmUp.update(palm ? palmFacing(palm, eye) : null, dt);
    if (palmUp !== this.wasPalmUp) {
      this.wasPalmUp = palmUp;
      if (palm) this.sound.play(palmUp ? 'open' : 'close', palm.centre, null);
    }
    this.updateMapHold();
    // palm away and not held: the map goes (a short grace so a wobble of the wrist does not flicker it);
    // while both hands pinch it stays whatever the palm does, and goes soon after you let go
    if (palmUp) this.mapLinger = 0.4;
    else if (this.mapHold) this.mapLinger = 0.3;
    else this.mapLinger = Math.max(0, this.mapLinger - dt);
    const onHand = palmUp || !!this.mapHold || this.mapLinger > 0;
    this.minimap.target = onHand || this.mapPinned ? 1 : 0;
    const baseAt: Vector3 | null = null;
    const left = this.immersive && !palm ? this.leftHand() : null;
    if (onHand && palm) {
      // it appears between your hands (where both can reach it) and stays put there
      if (!this.mapSpot) {
        const right = this.joints('right', ['wrist', 'middle-finger-phalanx-proximal']);
        if (right) {
          const r = right[0]!.clone().lerp(right[1]!, 0.55);
          this.mapSpot = palm.centre.clone().lerp(r, 0.5);
          this.mapSpot.y += 0.04;
        } else this.mapSpot = palm.centre.clone().addScaledVector(palm.normal, MINI_R * 1.3);
      }
      anchor.copy(this.mapSpot);
    } else if (this.mapSpot && this.minimap.visible && !this.mapPinned) {
      anchor.copy(this.mapSpot); // fading out where it was, not jumping away
    } else if (left) anchor.copy(left).setY(left.y + 0.13);
    else {
      const side = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
      anchor
        .copy(this.dock.mesh.position)
        .addScaledVector(side, -0.34)
        .setY(this.dock.mesh.position.y + MINI_R + 0.03);
    }
    this.graph.root.updateMatrixWorld();
    const headLocal = eye.clone().applyMatrix4(this.graph.root.matrixWorld.clone().invert());
    this.minimap.place(dt, anchor, this.graph.root.quaternion, this.graph.selected, headLocal, fwd, baseAt);
    if (!this.minimap.visible && !onHand) this.mapSpot = null; // next time, where your hands are then
  }

  private mapPinned = false;
  private readonly palmUp = new PalmUp();
  private wasPalmUp = false;
  /** where the map was put when it appeared between your hands (it stays there) */
  private mapSpot: Vector3 | null = null;
  private mapLinger = 0;

  /** The left palm (centre and facing) from the tracked hand joints, or null without a left hand. */
  private leftPalm(): PalmPose | null {
    const j = this.joints('left', ['wrist', 'index-finger-metacarpal', 'pinky-finger-metacarpal', 'middle-finger-phalanx-proximal']);
    return j ? palmPose(j[0]!, j[1]!, j[2]!, j[3]!, 'left') : null;
  }

  private readonly pinches = {
    left: { on: false, grab: false, at: new Vector3() },
    right: { on: false, grab: false, at: new Vector3() },
  };
  /** both hands are holding the map: the line between the two pinches last frame */
  private mapHold: { prev: Vector3 } | null = null;

  /** World positions of some joints of one tracked hand, or null. */
  private joints(hand: 'left' | 'right', names: XRHandJoint[]): Vector3[] | null {
    const session = this.world.session;
    const src = session ? [...session.inputSources].find((s) => s.handedness === hand && s.hand) : undefined;
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame?.() as XRFrame | null | undefined;
    const ref = xr.getReferenceSpace();
    if (!src?.hand || !frame?.getJointPose || !ref) return null;
    this.world.player.updateMatrixWorld();
    const origin = this.world.player.matrixWorld;
    const out: Vector3[] = [];
    for (const name of names) {
      const space = src.hand.get(name);
      const pose = space ? frame.getJointPose(space, ref) : undefined;
      if (!pose) return null;
      const p = pose.transform.position;
      out.push(new Vector3(p.x, p.y, p.z).applyMatrix4(origin));
    }
    return out;
  }

  /**
   * Holding the map in both hands: while it is out, a pinch made near it (within arm's reach) takes
   * hold of it.
   * With both hands holding, turning the line between your hands turns the big graph the same way, and
   * changing their distance zooms it, about its centre. Rotation follows the hands one to one; zoom
   * is the ratio of hand distances, so it feels like stretching the map itself.
   */
  private updateMapHold(): void {
    const reach = 0.45; // both hands pinching anywhere near the map work it
    const centre = this.minimap.group.position;
    for (const h of ['left', 'right'] as const) {
      const st = this.pinches[h];
      const j = this.immersive ? this.joints(h, ['thumb-tip', 'index-finger-tip']) : null;
      if (!j) {
        st.on = st.grab = false;
        continue;
      }
      const gap = j[0]!.distanceTo(j[1]!);
      const was = st.on;
      st.on = was ? gap < 0.035 : gap < 0.018; // hysteresis, so a held pinch does not flicker
      st.at.copy(j[0]!).lerp(j[1]!, 0.5);
      if (st.on && !was) st.grab = this.minimap.visible && st.at.distanceTo(centre) < reach;
      if (!st.on) st.grab = false;
    }
    const { left: l, right: r } = this.pinches;
    if (l.grab && r.grab) {
      const v = r.at.clone().sub(l.at);
      if (!this.mapHold) {
        this.mapHold = { prev: v };
        this.minimap.held = true;
        this.minimap.cancelPick();
        this.turn = null;
        this.glide = null;
        this.manip.cancel();
        this.sound.play('grab', centre, null);
        return;
      }
      const prev = this.mapHold.prev;
      if (v.length() < 0.01 || prev.length() < 0.01) return;
      const root = this.graph.root;
      root.updateMatrixWorld();
      const pivot = this.graphCentreWorld();
      const q = new Quaternion().setFromUnitVectors(prev.clone().normalize(), v.clone().normalize());
      rotateAbout(root, pivot, q);
      const want = Math.max(this.manip.minScale, Math.min(this.manip.maxScale, root.scale.x * (v.length() / prev.length())));
      const k = want / root.scale.x;
      root.position.sub(pivot).multiplyScalar(k).add(pivot);
      root.scale.setScalar(want);
      root.updateMatrixWorld();
      this.mapHold.prev = v;
    } else if (this.mapHold) {
      this.mapHold = null;
      this.minimap.held = false;
      this.sound.play('release', centre, null);
    }
  }

  /** A pinch made right at the hand map belongs to the map, not to the room behind it. */
  private atMap(e: XRPointerEvent): boolean {
    if (!this.minimap.visible || isScreenPointer(e)) return false;
    const p = e.pointerPosition;
    return this.minimap.group.position.distanceTo(new Vector3(p.x, p.y, p.z)) < 0.45;
  }

  private touchOn = { left: true, right: true };

  /**
   * Fingertip touch only wakes up when a fingertip is right at a panel (a few cm in front of it).
   * Left to itself the touch pointer claims the hand from 15 cm away, and a hand pointing at the
   * graph from near the menu would lose its ray.
   */
  private updateTouchReach(): void {
    const input = (
      this.world as unknown as { input?: { xr?: { multiPointers?: Record<'left' | 'right', { toggleSubPointer(k: string, on: boolean): boolean }> } } }
    ).input;
    const mp = input?.xr?.multiPointers;
    if (!mp || !this.immersive) return;
    const panels = [this.dock, this.tools].filter((p) => p.mesh.visible);
    for (const h of ['left', 'right'] as const) {
      const tipObj = this.world.player.indexTipSpaces[h];
      tipObj.updateMatrixWorld();
      const tip = new Vector3().setFromMatrixPosition(tipObj.matrixWorld);
      const wasOn = this.touchOn[h];
      const near = panels.some((p) => {
        const l = p.mesh.worldToLocal(tip.clone());
        const margin = wasOn ? 0.05 : 0.03;
        const inside = Math.abs(l.x) < p.widthM / 2 + margin && Math.abs(l.y) < p.heightM / 2 + margin;
        return inside && l.z < (wasOn ? 0.09 : 0.06) && l.z > -0.08;
      });
      this.touchOn[h] = near;
      mp[h].toggleSubPointer('touch', near); // a no-op unless it changes
    }
  }

  /** Are hands (not controllers) being tracked? */
  private handsActive(): boolean {
    const session = this.world.session;
    return !!session && [...session.inputSources].some((s) => !!s.hand);
  }

  /** World position of the left hand / controller grip, or null when it is not tracked. */
  private leftHand(): Vector3 | null {
    const session = this.world.session;
    if (!session || ![...session.inputSources].some((s) => s.handedness === 'left')) return null;
    const grip = (this.world as unknown as { player?: { gripSpaces?: { left?: Object3D } } }).player?.gripSpaces?.left;
    if (!grip) return null;
    grip.updateMatrixWorld();
    const p = new Vector3().setFromMatrixPosition(grip.matrixWorld);
    return p.lengthSq() > 1e-6 ? p : null;
  }

  /**
   * Turn the whole graph about its centre so `id` comes round to the side facing you. Small turns
   * (under 12°) are skipped: the note is already in front of you.
   */
  turnTo(id: string): boolean {
    this.graph.root.updateMatrixWorld();
    const at = this.graph.worldPos(id);
    if (!at) return false;
    const c = this.graphCentreWorld();
    const eye = this.headPose().pos;
    // inside the graph (zoomed right in) turning would swing it past you: glide instead
    const radiusW = this.graph.radius() * this.graph.root.scale.x;
    if (eye.distanceTo(c) < radiusW * 1.05) return false;
    const angle = yawToFace(c, at, eye);
    if (Math.abs(angle) < (12 * Math.PI) / 180) return true;
    this.manip.cancel();
    this.glide = null;
    this.turn = { angle, done: 0, t0: performance.now(), dur: turnSeconds(angle) };
    return true;
  }

  /** Bring a note in front of you: turn the graph (or, when you are inside it, glide it ~1.4 m in front). */
  jumpTo(id: string): void {
    if (this.turnTo(id)) {
      this.select(id, { turned: true });
      return;
    }
    const at = this.graph.worldPos(id);
    if (!at) return;
    const { pos, quat } = this.headPose();
    const fwd = FORWARD.clone().applyQuaternion(quat).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const want = pos.clone().addScaledVector(fwd, 1.4);
    want.y = pos.y - 0.12;
    this.glide = { from: this.graph.root.position.clone(), to: this.graph.root.position.clone().add(want.sub(at)), t0: performance.now() };
    this.select(id, { turned: true });
  }

  private openInsights(): void {
    this.onSearch('close', undefined);
    this.renderInsights();
    const p = shelfPoint(this.home, -this.shelf.activeAz, -this.shelf.drop + 0.02, this.immersive ? 1.0 : this.shelf.radius);
    this.insightsPanel.mesh.position.copy(p);
    faceTowards(this.insightsPanel.mesh, this.home.position);
    this.insightsPanel.mesh.visible = true;
    this.dock.setActive('topics', true);
  }

  private closeInsights(): void {
    this.insightsPanel.mesh.visible = false;
    this.insightsPanel.setActive(null);
    this.dock.setActive('topics', false);
    this.graph.setHighlight([]);
  }

  private renderInsights(): void {
    const vault = this.library.vault;
    if (!vault) return;
    let ins;
    try {
      ins = this.library.insights();
    } catch {
      return;
    }
    const ctx = {
      name: (id: string) => vault.notes.get(id)?.name ?? this.graph.nodes[this.graph.index.get(id) ?? -1]?.name ?? id,
      linked: (a: string, b: string) => this.graph.neighboursOf(a).has(b),
      exists: (id: string) => vault.notes.has(id),
      dismissed: this.dismissed,
    };
    const counts: Partial<Record<InsightTab, number>> = {};
    this.rowsByKey.clear();
    let rows: InsightRow[] = [];
    for (const tab of INSIGHT_TABS) {
      const r = insightRows(ins, tab, ctx);
      counts[tab] = r.length;
      for (const row of r) this.rowsByKey.set(row.key, row);
      if (tab === this.insightTab) rows = r;
      if (tab === 'links') this.linkRows = r;
      if (tab === 'questions') this.questionRows = r;
    }
    const summary = t().insightsSummary(ins.topics.length, counts.links ?? 0, counts.questions ?? 0);
    this.insightsPanel.set(this.insightTab, rows, counts, summary);
  }

  private onInsights(id: string, data: string | undefined): void {
    if (id === 'close') return this.closeInsights();
    if (id === 'tab' && data) {
      this.insightTab = data as InsightTab;
      this.insightsPanel.setActive(null);
      this.graph.setHighlight([]);
      return this.renderInsights();
    }
    const row = data ? this.rowsByKey.get(data) : undefined;
    if (!row) return;
    this.insightsPanel.setActive(row.key);
    this.graph.setHighlight(row.ids);
    switch (id) {
      case 'row':
      case 'open':
        if (row.open && this.library.vault?.notes.has(row.open)) this.select(row.open);
        break;
      case 'link':
        if (row.pair) void this.beginConnection(row.pair[0], row.pair[1]);
        break;
      case 'write':
        if (row.draft) this.openComposer({ kind: 'new' }, row.draft.title + (row.draft.body ? '\n' + row.draft.body : ''));
        break;
      case 'dismiss':
        if (row.pair) {
          this.dismissed.add(pairKey(row.pair[0], row.pair[1]));
          void this.library.setState('dismissed', [...this.dismissed]).catch(() => undefined);
          this.graph.setHighlight([]);
          this.renderInsights();
        }
        break;
    }
  }

  // ---------- dock & search ----------

  private onDock(a: DockAction): void {
    this.tourDone('menu');
    if (a !== 'more') this.stopAutoTour();
    switch (a) {
      case 'more':
        this.tools.mesh.visible = !this.tools.mesh.visible;
        this.dock.setActive('more', this.tools.mesh.visible);
        break;
      case 'new':
        this.openComposer({ kind: 'new' });
        break;
      case 'search':
        this.openSearch();
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'topics':
        if (this.insightsPanel.mesh.visible) this.closeInsights();
        else this.openInsights();
        break;
      case 'map':
        this.mapPinned = !this.mapPinned;
        this.minimap.target = this.mapPinned ? 1 : 0;
        this.dock.setActive('map', this.mapPinned);
        break;
      case 'wall': {
        // put the card you are reading on the wall (or just show where the wall is)
        const active = this.cards.find((c) => !this.pinned.has(c.path ?? '') && !this.onWall.has(c));
        if (active) this.putOnWall(active);
        this.toast(t().wallHint);
        break;
      }
      case 'exit':
        this.input.end();
        if (this.immersive) this.world.exitXR();
        this.opts.onExit?.();
        break;
      default:
        this.toast(a);
    }
  }

  private openSearch(): void {
    const vault = this.library.vault;
    if (!vault) return;
    if (this.insightsPanel.mesh.visible) this.closeInsights();
    const render = (): void => {
      const q = this.input.text;
      const results = vault.search(q, 7);
      this.search.set(q, results, this.input.keyboardOpen);
      this.graph.setHighlight(results.map((r) => r.path));
    };
    this.writeMode = { kind: 'search' };
    this.input.begin('', render, { multiline: false });
    this.input.onSubmit = () => {
      const first = this.search.results[0];
      if (first) this.onSearch('result', first.path);
    };
    this.input.onCancel = () => this.onSearch('close', undefined);
    render();
    const p = shelfPoint(this.home, -this.shelf.activeAz, -this.shelf.drop, 0.9);
    this.search.mesh.position.copy(p);
    faceTowards(this.search.mesh, this.home.position);
    this.search.mesh.visible = true;
    this.dock.setActive('search', true);
    if (!this.immersive) this.input.showKeyboard();
  }

  private onSearch(id: string, data: string | undefined): void {
    if (id === 'type') this.input.showKeyboard();
    else if (id === 'close' || id === 'result') {
      this.input.end();
      this.search.mesh.visible = false;
      this.dock.setActive('search', false);
      this.graph.setHighlight([]);
      this.writeMode = null;
      if (id === 'result' && data) this.select(data);
    }
  }

  // ---------- onboarding (first five minutes) ----------

  private startTour(): void {
    this.nextTourHint();
  }

  private tourDone(step: keyof NetNoteApp['tour']): void {
    if (this.tour[step]) return;
    this.tour[step] = true;
    if (this.toastTimer <= 0) this.nextTourHint();
  }

  private nextTourHint(): void {
    const tr = t();
    const order: [keyof NetNoteApp['tour'], string][] = [
      ['read', tr.tipPinch],
      ['move', tr.tipDrag],
      ['connect', tr.tipConnect],
      ['menu', tr.tipMenu],
    ];
    const i = order.findIndex(([k]) => !this.tour[k]);
    if (i < 0 || !this.immersive) this.hint.show('');
    else this.hint.show(order[i]![1], `${i + 1}/${order.length}`);
  }

  // ---------- motion ----------

  /** Shelf cards glide to their place and grow in; a card that changes note dims for a moment. */
  private animateCards(dt: number, reduced: boolean): void {
    const now = performance.now();
    const dragging = this.panelDrag?.surface;
    for (const c of this.cards) {
      const m = this.motion.get(c);
      if (!m || this.onWall.has(c) || c === dragging) continue;
      if (!this.moved.has(c) && c.mesh.userData.placed) {
        if (reduced) c.mesh.position.copy(m.goal);
        else c.mesh.position.lerp(m.goal, follow(MOTION.glide, dt));
        faceTowards(c.mesh, this.home.position);
      }
      const age = (now - m.born) / 1000;
      c.mesh.scale.setScalar(popScale(age, reduced));
      const sw = (now - m.swap) / 1000;
      c.mesh.material.opacity = !reduced && sw < MOTION.swapSeconds ? 0.45 + 0.55 * easeOutCubic(sw / MOTION.swapSeconds) : 1;
    }
  }

  /** Particles along the links of the note you are reading, the path found, or the pair shown. */
  private updateFlows(dt: number, reduced: boolean): void {
    const g = this.graph;
    const focus = g.selected;
    const links: FlowLink[] = [];
    const P = (i: number): Vector3 => g.positions[i]!;
    if (this.path || this.suggestPair) {
      const chain = this.path ?? this.suggestPair!;
      for (let k = 0; k < chain.length - 1; k++) {
        const a = g.index.get(chain[k]!);
        const b = g.index.get(chain[k + 1]!);
        if (a !== undefined && b !== undefined) links.push({ a: P(a), b: P(b), kind: 'gold' });
      }
    }
    if (focus && g.index.has(focus) && g.isBorn(focus)) {
      const f = g.index.get(focus)!;
      for (const l of g.links) {
        if (l.s === f && g.isBorn(g.nodes[l.t]!.id)) links.push({ a: P(f), b: P(l.t), kind: 'out' });
        else if (l.t === f && g.isBorn(g.nodes[l.s]!.id)) links.push({ a: P(l.s), b: P(f), kind: 'in' });
      }
    }
    const key = `${focus}|${(this.path ?? this.suggestPair ?? []).join(',')}|${this.library.vault?.version}|${this.timeMachine?.i ?? -1}`;
    this.flows.set(links, key);
    const scale = g.root.getWorldScale(tmp).x || 1;
    const halfH = this.immersive ? 1000 : this.world.renderer.domElement.height / 2;
    this.flows.update(dt, scale, halfH, reduced);
  }

  /** A thread from each shelf card's left edge to its star. */
  private updateTethers(): void {
    const specs: TetherSpec[] = [];
    const dim = this.writing ? 0.35 : 1;
    for (const c of this.cards) {
      if (!c.path || !c.mesh.visible || this.onWall.has(c) || !this.graph.isBorn(c.path)) continue;
      const to = this.graph.worldPos(c.path);
      if (!to) continue;
      c.mesh.updateMatrixWorld();
      const from = c.mesh.localToWorld(new Vector3(-c.widthM / 2, c.heightM * 0.3, 0));
      const centre = c.mesh.getWorldPosition(new Vector3());
      const out = from.clone().sub(centre).setY(0).normalize();
      const pinned = this.pinned.has(c.path);
      specs.push({ from, out, to, color: pinned ? COLORS.violet : COLORS.accent, opacity: (pinned ? 0.55 : 0.8) * dim * c.mesh.material.opacity });
    }
    this.tethers.set(specs);
  }

  // ---------- exploring: path finder, tour, time machine ----------

  private findPath(from: string, to: string): void {
    const p = shortestPath(from, to, this.graphNeighbours());
    if (!p) {
      this.path = null;
      this.toast(t().pathNone);
      this.sound.play('error', this.graph.worldPos(to) ?? this.home.position, this.world.session);
      return;
    }
    this.path = p;
    this.graph.setHighlight(p);
    this.toast(t().pathFound(p.length - 1));
    this.brain.path(p.length - 1, performance.now());
    this.sound.play('link', this.graph.worldPos(to) ?? this.home.position, this.world.session);
  }

  private graphNeighbours(): Map<string, Set<string>> {
    return new Map(this.graph.nodes.map((n) => [n.id, this.graph.neighboursOf(n.id)]));
  }

  private startAutoTour(): void {
    this.stopTimeMachine();
    this.path = null;
    this.suggestPair = null;
    this.graph.setHighlight([]);
    const vault = this.library.vault;
    if (!vault) return;
    this.touring = { visited: [], next: performance.now() + 7000 };
    const cur = this.graph.selected;
    if (!cur || !vault.notes.has(cur)) {
      const hub = this.graph.nodes.filter((n) => vault.notes.has(n.id)).sort((a, b) => b.degree - a.degree)[0];
      if (hub) this.select(hub.id, { auto: true });
    }
    this.toast(t().tourOn);
    this.brain.tour(performance.now());
    this.syncTools();
  }

  private stopAutoTour(): void {
    if (!this.touring) return;
    this.touring = null;
    this.toast(t().tourOff);
    this.syncTools();
  }

  private startTimeMachine(): void {
    this.stopAutoTour();
    const vault = this.library.vault;
    if (!vault) return;
    const list = timeline(this.graph.nodes.filter((n) => vault.notes.has(n.id)).map((n) => ({ id: n.id, at: n.created || n.mtime })));
    if (list.length < 2) return this.toast(t().timeFew);
    const { perStep, interval } = playbackStep(list.length);
    this.path = null;
    this.suggestPair = null;
    this.graph.setHighlight([]);
    this.timeMachine = { list, i: 0, acc: 0, perStep, interval, doneAt: 0 };
    this.graph.setBorn([]);
    this.sound.play('whoosh', this.graphCentreWorld(), null);
    this.brain.timeMachine(performance.now());
    this.syncTools();
  }

  private stopTimeMachine(): void {
    if (!this.timeMachine) return;
    this.timeMachine = null;
    this.graph.setBorn(null);
    this.hint.show('');
    this.syncTools();
  }

  private updateExplore(dt: number): void {
    const now = performance.now();
    const tour = this.touring;
    if (tour && now > tour.next && !this.writing) {
      const vault = this.library.vault;
      const cur = this.graph.selected;
      if (cur) tour.visited.push(cur);
      if (tour.visited.length > 40) tour.visited.shift();
      const next = nextTourStop(
        cur,
        this.graphNeighbours(),
        (id) => this.graph.nodes[this.graph.index.get(id) ?? -1]?.degree ?? 0,
        tour.visited,
        Math.random,
        (id) => !!vault?.notes.has(id),
      );
      if (next) {
        this.select(next, { auto: true });
        this.sound.play('chime', this.graph.worldPos(next) ?? this.home.position, null);
      }
      tour.next = now + 7000;
    }
    const tm = this.timeMachine;
    if (!tm) return;
    if (tm.doneAt) {
      if (now > tm.doneAt) {
        this.stopTimeMachine();
        this.toast(t().timeDone);
      }
      return;
    }
    tm.acc += dt;
    if (tm.acc < tm.interval) return;
    tm.acc = 0;
    tm.i = Math.min(tm.list.length, tm.i + tm.perStep);
    // everything born up to the newest note's moment, plus the ghosts and files those notes point at
    const upTo = countAt(tm.list, tm.list[tm.i - 1]!.at);
    tm.i = Math.max(tm.i, upTo);
    const born = new Set(tm.list.slice(0, tm.i).map((b) => b.id));
    for (const n of this.graph.nodes) if ((n.ghost || n.file) && [...this.graph.neighboursOf(n.id)].some((m) => born.has(m))) born.add(n.id);
    this.graph.setBorn(born);
    const d = new Date(tm.list[tm.i - 1]!.at);
    this.toastTimer = 0;
    this.hint.show(t().timeOn(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, tm.i, tm.list.length));
    if (tm.i >= tm.list.length) tm.doneAt = now + 1500;
  }

  private onTool(a: ToolAction): void {
    switch (a) {
      case 'tour':
        if (this.touring) this.stopAutoTour();
        else this.startAutoTour();
        break;
      case 'time':
        if (this.timeMachine) this.stopTimeMachine();
        else this.startTimeMachine();
        break;
      case 'sound':
        this.sound.enabled = this.sound.hapticsEnabled = !this.sound.enabled;
        if (this.sound.enabled) this.sound.unlock();
        this.toast(this.sound.enabled ? t().soundOn : t().soundOff);
        break;
      case 'motion':
        setReduceMotion(!reduceMotion());
        this.toast(reduceMotion() ? t().motionOff : t().motionOn);
        break;
      case 'pet':
        this.brain.enabled = !this.brain.enabled;
        if (!this.brain.enabled) this.brain.hush();
        this.toast(this.brain.enabled ? t().petOn : t().petOff);
        break;
    }
    writePrefs({ sound: this.sound.enabled, pet: this.brain.enabled, motion: !reduceMotion() });
    this.syncTools();
  }

  private syncTools(): void {
    this.tools.setActive('tour', !!this.touring);
    this.tools.setActive('time', !!this.timeMachine);
    this.tools.setActive('sound', this.sound.enabled);
    this.tools.setActive('motion', !reduceMotion());
    this.tools.setActive('pet', this.brain.enabled);
  }

  // ---------- the companion ----------

  private updateCompanion(dt: number, eye: Vector3, quat: Quaternion, reduced: boolean): void {
    const now = performance.now();
    this.brain.tick(now);
    for (const a of this.brain.acts.splice(0)) this.companion.play(a);
    // fades away while you write, search or read the insights: it never covers what you work on
    const busyPanel = this.writing || this.search.mesh.visible || this.insightsPanel.mesh.visible;
    this.companion.shown = this.brain.enabled && !busyPanel ? 1 : 0;
    // just outside the lower-left corner of the card you read, a little in front of it (never behind
    // or over its text); with no card open, at the left end of the menu
    const card = this.cards.find((c) => c.mesh.visible && c.path && !this.onWall.has(c) && !this.pinned.has(c.path));
    const size = 0.075;
    const at = new Vector3();
    if (card) {
      card.mesh.updateMatrixWorld();
      card.mesh.localToWorld(at.set(-card.widthM / 2 - size * 0.55, -card.heightM / 2 + size * 0.5, 0.05));
    } else {
      this.dock.mesh.updateMatrixWorld();
      this.dock.mesh.localToWorld(at.set(-this.dock.widthM / 2 - size * 0.8, size * 0.2, 0.03));
    }
    const look = this.brain.focus[0] ? this.graph.worldPos(this.brain.focus[0]) : null;
    this.companion.setBadge(this.brain.waiting);
    this.companion.update(dt, at, eye, size * (this.immersive ? 1 : 1.25), this.brain.mood, this.brain.enabled ? this.brain.speech : null, reduced, look);
    void quat;
  }

  private onCompanion(id: SpeechButton): void {
    const s = this.brain.speech;
    const now = performance.now();
    const pair = s?.pair;
    switch (id) {
      case 'insights':
        this.brain.hush();
        this.insightTab = 'questions';
        this.openInsights();
        return;
      case 'next':
        this.brain.presentNext(now);
        return;
      case 'show':
        if (!pair) return;
        // the pair lights up, gold flows between them, and the graph turns them towards you
        this.stopAutoTour();
        this.path = null;
        this.select(pair[0], { auto: true });
        this.suggestPair = pair;
        this.graph.setHighlight(pair);
        this.sound.play('link', this.graph.worldPos(pair[1]) ?? this.home.position, this.world.session);
        if (s) s.buttons = ['connect', 'dismiss'];
        this.companion.bubble.invalidate();
        return;
      case 'connect':
        this.brain.hush();
        if (pair) void this.beginConnection(pair[0], pair[1]);
        return;
      case 'dismiss':
        if (!pair) return;
        this.dismissed.add(pairKey(pair[0], pair[1]));
        void this.library.setState('dismissed', [...this.dismissed]).catch(() => undefined);
        this.suggestPair = null;
        this.graph.setHighlight([]);
        this.renderInsights();
        this.brain.say(t().petDismissed, now, { force: true, ms: 2200 });
        return;
    }
  }

  /** Repaint every panel after the language changed. */
  relabel(): void {
    for (const s of [this.dock, this.tools, this.composer, this.search, ...this.cards]) s.invalidate();
    for (const c of this.cards) if (c.path) this.showCard(c.path, c);
    this.nextTourHint();
  }

  toast(text: string): void {
    this.hint.show(text);
    this.hint.update();
    this.toastTimer = 2.2;
  }

  get state(): {
    cards: (string | null)[];
    wall: (string | null)[];
    groups: string[][];
    selected: string | null;
    composer: boolean;
    search: boolean;
    insights: boolean;
    minimap: boolean;
    path: string[] | null;
    pathPick: string | null;
    touring: boolean;
    timeMachine: { shown: number; total: number } | null;
    tools: boolean;
    sound: boolean;
    reducedMotion: boolean;
    companion: { enabled: boolean; mood: string; speech: string | null; visible: boolean };
    flows: number;
    tethers: number;
  } {
    return {
      cards: this.cards.filter((c) => !this.onWall.has(c)).map((c) => c.path),
      wall: [...this.onWall.keys()].map((c) => c.path),
      groups: this.tags.map((x) => x.paths),
      selected: this.graph.selected,
      composer: this.writing,
      search: this.search.mesh.visible,
      insights: this.insightsPanel.mesh.visible,
      minimap: this.minimap.visible,
      path: this.path,
      pathPick: this.pathPick,
      touring: !!this.touring,
      timeMachine: this.timeMachine ? { shown: this.timeMachine.i, total: this.timeMachine.list.length } : null,
      tools: this.tools.mesh.visible,
      sound: this.sound.enabled,
      reducedMotion: reduceMotion(),
      companion: { enabled: this.brain.enabled, mood: this.brain.mood, speech: this.brain.speech?.text ?? null, visible: this.companion.group.visible },
      flows: this.flows.points.visible ? this.flows.points.geometry.drawRange.count : 0,
      tethers: this.tethers.lines.visible ? this.tethers.lines.geometry.drawRange.count / 48 : 0,
    };
  }
}

function dirOf(e: XRPointerEvent): Vector3 {
  const q = e.pointerQuaternion;
  return tmp
    .copy(FORWARD)
    .applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))
    .clone()
    .normalize();
}

function isScreenPointer(e: XRPointerEvent): boolean {
  return /mouse|touch|pen|screen/i.test(e.pointerType);
}

interface Prefs {
  sound: boolean;
  pet: boolean;
  /** null: follow the system's reduce-motion setting */
  motion: boolean | null;
}

const PREFS_KEY = 'netnote.prefs';

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { sound: p?.sound ?? true, pet: p?.pet ?? true, motion: typeof p?.motion === 'boolean' ? p.motion : null };
  } catch {
    return { sound: true, pet: true, motion: null };
  }
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: preferences last for this visit */
  }
}

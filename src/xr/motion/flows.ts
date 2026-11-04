/**
 * Data flowing along the links of the note you are reading: small soft dots travel from the note to
 * what it links to (cyan), towards it from what links to it (violet), and along suggested or found
 * paths (gold). It shows direction without arrows and draws the eye along the thread.
 *
 * Human factors: slow (a third of a link per second), tiny (5 mm) and dim; only for the focused note,
 * none at all when nothing is focused, and frozen in place when reduce-motion is on.
 * All motion runs in the vertex shader: one draw call, no per-frame CPU work.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, type Vector3 } from '@iwsdk/core';
import { COLORS } from '../theme';
import { damp, MOTION } from './ease';

export type FlowKind = 'out' | 'in' | 'gold';

export interface FlowLink {
  /** start and end in graph layout units (particles travel a → b) */
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  kind: FlowKind;
}

export interface Particle {
  link: number;
  phase: number;
}

export const FLOW_MAX = 1600;

/** Spread a particle budget over links, more on longer ones, 1–6 each, evenly spaced along the link. */
export function planParticles(links: readonly FlowLink[], budget = FLOW_MAX): Particle[] {
  if (!links.length) return [];
  const len = links.map((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y, l.b.z - l.a.z));
  const mean = len.reduce((s, x) => s + x, 0) / len.length || 1;
  const want = len.map((d) => Math.max(1, Math.min(6, Math.round((3 * d) / mean))));
  const total = want.reduce((s, x) => s + x, 0);
  const k = total > budget ? budget / total : 1;
  const out: Particle[] = [];
  links.forEach((_, i) => {
    const n = Math.max(1, Math.floor(want[i]! * k));
    // golden-ratio offset per link so neighbouring links are not in lock-step
    const off = (i * 0.618034) % 1;
    for (let j = 0; j < n && out.length < budget; j++) out.push({ link: i, phase: (off + j / n) % 1 });
  });
  return out;
}

const COLOR: Record<FlowKind, string> = { out: COLORS.accent, in: COLORS.violet, gold: COLORS.gold };

export class FlowField {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private opacity = 0;
  private want = 0;
  private sig = '';
  private time = 0;

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(FLOW_MAX * 3), 3));
    g.setAttribute('aEnd', new BufferAttribute(new Float32Array(FLOW_MAX * 3), 3));
    g.setAttribute('aPhase', new BufferAttribute(new Float32Array(FLOW_MAX), 1));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(FLOW_MAX * 3), 3));
    g.setDrawRange(0, 0);
    const mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: 0.005 }, uHalfH: { value: 900 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aEnd; attribute float aPhase; attribute vec3 aColor;
        uniform float uTime; uniform float uSize; uniform float uHalfH;
        varying vec3 vColor; varying float vFade;
        void main(){
          float t = fract(aPhase + uTime);
          vec3 p = mix(position, aEnd, t);
          vColor = aColor;
          vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.85, 1.0, t));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * projectionMatrix[1][1] * uHalfH / max(0.05, -mv.z), 1.5, 24.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying vec3 vColor; varying float vFade;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vColor, a * vFade * uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, mat);
    this.points.name = 'flows';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.raycast = () => undefined;
    this.points.visible = false;
  }

  setPassthrough(on: boolean): void {
    this.points.material.blending = on ? NormalBlending : AdditiveBlending;
    this.points.material.needsUpdate = true;
  }

  /** New set of links to flow along (cheap to call every frame: rebuilds only when they change). */
  set(links: readonly FlowLink[], key: string): void {
    this.want = links.length ? 1 : 0;
    if (key === this.sig) return;
    this.sig = key;
    if (!links.length) return; // keep the old ones while fading out
    const ps = planParticles(links);
    const g = this.points.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const end = g.getAttribute('aEnd') as BufferAttribute;
    const ph = g.getAttribute('aPhase') as BufferAttribute;
    const col = g.getAttribute('aColor') as BufferAttribute;
    const c = new Color();
    ps.forEach((p, i) => {
      const l = links[p.link]!;
      pos.setXYZ(i, l.a.x, l.a.y, l.a.z);
      end.setXYZ(i, l.b.x, l.b.y, l.b.z);
      ph.setX(i, p.phase);
      c.set(COLOR[l.kind]);
      col.setXYZ(i, c.r, c.g, c.b);
    });
    for (const a of [pos, end, ph, col]) a.needsUpdate = true;
    g.setDrawRange(0, ps.length);
    this.opacity = Math.min(this.opacity, 0.2); // new threads fade in
  }

  /** `scale`: graph world scale (particle size stays 5 mm in the world). */
  update(dt: number, scale: number, halfHeightPx: number, reduced: boolean): void {
    this.opacity = damp(this.opacity, this.want, 5, dt);
    this.points.visible = this.opacity > 0.01;
    if (!this.points.visible) return;
    if (!reduced) this.time = (this.time + dt * MOTION.flowSpeed) % 1000;
    const u = this.points.material.uniforms;
    u.uTime!.value = this.time;
    u.uOpacity!.value = this.opacity * 0.75;
    u.uSize!.value = 0.005 / Math.max(1e-6, scale);
    u.uHalfH!.value = halfHeightPx;
  }
}

/** Positions helper so callers can pass three.js vectors directly. */
export const xyz = (v: Vector3): { x: number; y: number; z: number } => ({ x: v.x, y: v.y, z: v.z });

/**
 * What the thinking wall looks like: a faint curved frame (a grid while you carry a card, with a glow
 * where it will land), gold trays behind groups, and ribbons between the cards on it (cyan = linked,
 * dashed gold = a possible link the insight engine found).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { WALL_AZ, WALL_H, type WallGeometry, type WallSpot } from './wall-geometry';

const D2R = Math.PI / 180;

export interface Ribbon {
  a: WallSpot;
  b: WallSpot;
  color: number;
  dashed?: boolean;
}

export class WallView {
  readonly group = new Group();
  readonly origin = new Vector3(0, 1.6, 0);
  yaw = 0;
  private readonly surface: Mesh<CylinderGeometry, ShaderMaterial>;
  private readonly trayMat: ShaderMaterial;
  private trays: Mesh[] = [];
  private readonly ribbons: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly ribMax = 4000;
  private readonly span: number;
  private readonly height: number;
  private readonly surfaceY: number;

  constructor(private readonly geo: WallGeometry) {
    this.span = WALL_AZ[1] - WALL_AZ[0] + 8;
    this.height = WALL_H[1] - WALL_H[0] + geo.ch + 0.12;
    this.surfaceY = (WALL_H[0] + WALL_H[1]) / 2;
    this.surface = new Mesh(
      this.surfaceGeometry(),
      new ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uGrid: { value: 0 }, uDrop: { value: new Vector2(-1, -1) }, uSpan: { value: new Vector2(this.span, this.height) } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity; uniform float uGrid; uniform vec2 uDrop; uniform vec2 uSpan; varying vec2 vUv;
          void main(){
            vec2 m = vUv * uSpan;
            vec2 g = abs(fract(vec2(m.x / 10.0, m.y / 0.2) + 0.5) - 0.5) / fwidth(vec2(m.x / 10.0, m.y / 0.2));
            float grid = 1.0 - min(min(g.x, g.y), 1.0);
            vec2 e = min(vUv, 1.0 - vUv) * uSpan * vec2(0.02, 1.0);
            float edge = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y));
            float drop = 0.0;
            if (uDrop.x >= 0.0) { vec2 d = (vUv - uDrop) * uSpan * vec2(0.0227, 1.0); drop = exp(-dot(d, d) * 18.0); }
            float a = (grid * 0.35 * uGrid + edge * 0.9) * uOpacity + drop * 0.35 * step(0.3, uOpacity);
            gl_FragColor = vec4(mix(vec3(0.37,0.9,1.0), vec3(1.0,0.82,0.4), drop), a);
          }`,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.surface.name = 'wall-surface';
    this.surface.renderOrder = 1;
    this.surface.visible = false;
    this.surface.frustumCulled = false;
    this.surface.raycast = () => undefined;
    this.group.add(this.surface);

    this.trayMat = new ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `varying vec2 vUv; void main(){
          vec2 e = min(vUv, 1.0 - vUv);
          float edge = 1.0 - smoothstep(0.0, 0.012, min(e.x * 4.0, e.y * 3.0));
          gl_FragColor = vec4(1.0, 0.82, 0.4, 0.07 + edge * 0.55);
        }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array(this.ribMax * 3), 3));
    rg.setAttribute('color', new BufferAttribute(new Float32Array(this.ribMax * 4), 4));
    this.ribbons = new Mesh(rg, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));
    this.ribbons.frustumCulled = false;
    this.ribbons.renderOrder = 2;
    this.ribbons.visible = false;
    this.ribbons.raycast = () => undefined;
    this.group.add(this.ribbons);
  }

  private surfaceGeometry(): CylinderGeometry {
    const r = this.geo.radius + 0.03;
    return new CylinderGeometry(r, r, this.height, 64, 1, true, Math.PI + (-WALL_AZ[1] - 4) * D2R, this.span * D2R);
  }

  /** Fit the ring to a real wall (mixed reality) or back to the default. */
  setRadius(r: number): void {
    if (Math.abs(r - this.geo.radius) < 1e-3) return;
    this.geo.radius = r;
    this.surface.geometry.dispose();
    this.surface.geometry = this.surfaceGeometry();
  }

  anchor(origin: Vector3, yaw: number): void {
    this.origin.copy(origin);
    this.yaw = yaw;
    this.surface.position.set(origin.x, origin.y + this.surfaceY, origin.z);
    this.surface.rotation.set(0, yaw, 0);
  }

  setTrays(groups: WallSpot[][]): void {
    while (this.trays.length > groups.length) {
      const t = this.trays.pop()!;
      t.removeFromParent();
      t.geometry.dispose();
    }
    groups.forEach((g, i) => {
      const b = this.geo.bounds(g);
      const pad = 2.2;
      const geo = new CylinderGeometry(
        this.geo.radius + 0.015,
        this.geo.radius + 0.015,
        b.h1 - b.h0 + 0.08,
        24,
        1,
        true,
        Math.PI + (-b.a1 - pad) * D2R,
        (b.a1 - b.a0 + pad * 2) * D2R,
      );
      let t = this.trays[i];
      if (!t) {
        t = new Mesh(geo, this.trayMat);
        t.renderOrder = 2;
        t.frustumCulled = false;
        t.raycast = () => undefined;
        this.group.add(t);
        this.trays.push(t);
      } else {
        t.geometry.dispose();
        t.geometry = geo;
      }
      t.position.set(this.origin.x, this.origin.y + (b.h0 + b.h1) / 2, this.origin.z);
      t.rotation.set(0, this.yaw, 0);
    });
  }

  setRibbons(pairs: Ribbon[]): void {
    const pos = this.ribbons.geometry.getAttribute('position') as BufferAttribute;
    const col = this.ribbons.geometry.getAttribute('color') as BufferAttribute;
    let v = 0;
    const SEG = 16;
    const W = 0.0045;
    const P = (az: number, h: number, out: Vector3): Vector3 => {
      const a = this.yaw - az * D2R;
      return out.set(this.origin.x - Math.sin(a) * (this.geo.radius + 0.008), this.origin.y + h, this.origin.z - Math.cos(a) * (this.geo.radius + 0.008));
    };
    const p0 = new Vector3();
    const p1 = new Vector3();
    const n = new Vector3();
    const side = new Vector3();
    const c = new Color();
    for (const pr of pairs) {
      c.set(pr.color);
      for (let s = 0; s < SEG; s++) {
        if (pr.dashed && s % 2) continue;
        if (v + 6 > this.ribMax) break;
        const u0 = s / SEG;
        const u1 = (s + 1) / SEG;
        P(pr.a.az + (pr.b.az - pr.a.az) * u0, pr.a.h + (pr.b.h - pr.a.h) * u0, p0);
        P(pr.a.az + (pr.b.az - pr.a.az) * u1, pr.a.h + (pr.b.h - pr.a.h) * u1, p1);
        n.set(p0.x - this.origin.x, 0, p0.z - this.origin.z).normalize();
        side
          .subVectors(p1, p0)
          .cross(n)
          .normalize()
          .multiplyScalar(W / 2);
        const quad = [p0.clone().add(side), p0.clone().sub(side), p1.clone().add(side), p1.clone().sub(side)];
        for (const k of [0, 1, 2, 2, 1, 3]) {
          const q = quad[k]!;
          pos.setXYZ(v, q.x, q.y, q.z);
          col.setXYZW(v, c.r, c.g, c.b, 0.85);
          v++;
        }
      }
    }
    this.ribbons.geometry.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.ribbons.visible = v > 0;
  }

  /** mode 0 hidden · 1 faint frame (cards on it) · 2 carrying a card (grid); dropAt in wall coordinates. */
  setSurface(mode: 0 | 1 | 2, dropAt: WallSpot | null): void {
    const want = mode === 2 ? 0.6 : mode === 1 ? 0.16 : 0;
    const u = this.surface.material.uniforms as { uOpacity: { value: number }; uGrid: { value: number }; uDrop: { value: Vector2 } };
    u.uOpacity.value += (want - u.uOpacity.value) * 0.2;
    u.uGrid.value += ((mode === 2 ? 1 : 0) - u.uGrid.value) * 0.2;
    this.surface.visible = u.uOpacity.value > 0.01;
    if (dropAt && mode === 2) u.uDrop.value.set((WALL_AZ[1] + 4 - dropAt.az) / this.span, (dropAt.h - this.surfaceY) / this.height + 0.5);
    else u.uDrop.value.set(-1, -1);
  }

  /** In MR the wall can sit on a real wall: pass its plane and the ring is placed against it. */
  set visible(v: boolean) {
    this.group.visible = v;
  }
}

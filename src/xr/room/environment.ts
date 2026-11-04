/**
 * The VR backdrop: a deep blue dome with a faint horizon and still stars, so the threads of the graph
 * read clearly and there is a stable "up" (no motion in the periphery, nothing to make you queasy).
 * Hidden in mixed reality, where your own room is the backdrop.
 */
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Group, Mesh, Points, PointsMaterial, ShaderMaterial, SphereGeometry } from '@iwsdk/core';
import { seeded } from '../../core/layout/force';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 top = vec3(0.012, 0.018, 0.045);
  vec3 mid = vec3(0.03, 0.05, 0.11);
  vec3 low = vec3(0.01, 0.012, 0.025);
  vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, h)) : mix(mid, low, smoothstep(0.0, 0.35, -h));
  c += vec3(0.05, 0.12, 0.2) * exp(-abs(h) * 22.0) * 0.45; // horizon glow
  gl_FragColor = vec4(c, 1.0);
}`;

export class Environment {
  readonly group = new Group();

  constructor() {
    const sky = new Mesh(
      new SphereGeometry(60, 32, 16),
      new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false }),
    );
    sky.name = 'sky';
    sky.raycast = () => undefined;
    sky.renderOrder = -10;
    this.group.add(sky);

    const rnd = seeded(42);
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // uniform on a sphere, biased above the horizon
      const u = rnd() * 2 - 1;
      const y = Math.abs(u) * (rnd() < 0.8 ? 1 : -1);
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 50, y * 50, Math.sin(a) * r * 50], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const stars = new Points(
      g,
      new PointsMaterial({
        color: 0x9fc8ff,
        size: 0.09,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    stars.name = 'stars';
    stars.raycast = () => undefined;
    this.group.add(stars);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}

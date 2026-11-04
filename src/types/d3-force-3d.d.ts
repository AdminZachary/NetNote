declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimLink<N> {
    source: string | N;
    target: string | N;
  }
  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }
  export interface Simulation<N> {
    nodes(): N[];
    nodes(n: N[]): this;
    force(name: string): unknown;
    force(name: string, f: Force<N> | null | unknown): this;
    alpha(): number;
    alpha(a: number): this;
    alphaDecay(a: number): this;
    alphaMin(a: number): this;
    velocityDecay(a: number): this;
    randomSource(r: () => number): this;
    tick(n?: number): this;
    stop(): this;
    restart(): this;
    on(type: string, fn: (() => void) | null): this;
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], dims?: number): Simulation<N>;
  export interface LinkForce<N> extends Force<N> {
    links(l: SimLink<N>[]): this;
    id(fn: (n: N) => string): this;
    distance(d: number | ((l: SimLink<N>) => number)): this;
    strength(s: number | ((l: SimLink<N>) => number)): this;
  }
  export function forceLink<N>(links?: SimLink<N>[]): LinkForce<N>;
  export interface ManyBody<N> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
    distanceMax(d: number): this;
    theta(t: number): this;
  }
  export function forceManyBody<N>(): ManyBody<N>;
  export interface Center<N> extends Force<N> {
    strength(s: number): this;
  }
  export function forceCenter<N>(x?: number, y?: number, z?: number): Center<N>;
  export interface Collide<N> extends Force<N> {
    radius(r: number | ((n: N) => number)): this;
  }
  export function forceCollide<N>(r?: number | ((n: N) => number)): Collide<N>;
  export interface Axis<N> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
  }
  export function forceX<N>(x?: number): Axis<N>;
  export function forceY<N>(y?: number): Axis<N>;
  export function forceZ<N>(z?: number): Axis<N>;
}

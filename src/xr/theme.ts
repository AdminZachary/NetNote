/** Visual language shared by every surface: one palette, one type scale, one set of distances. */

export const COLORS = {
  bg: '#05070f',
  panel: 'rgba(12, 18, 34, 0.92)',
  panelSolid: '#0c1222',
  panelEdge: 'rgba(120, 200, 255, 0.35)',
  text: '#e8f1ff',
  textDim: '#9fb0cc',
  textFaint: '#6b7a96',
  accent: '#5ee7ff',
  accentSoft: 'rgba(94, 231, 255, 0.16)',
  violet: '#b18cff',
  gold: '#ffd166',
  goldSoft: 'rgba(255, 209, 102, 0.16)',
  danger: '#ff7a8a',
  ok: '#7ef0b2',
  ghost: '#7d8aa6',
} as const;

/** Topic colours: distinct hues, similar brightness, readable on the dark sky and in passthrough. */
export const TOPIC_COLORS = ['#5ee7ff', '#ffb86b', '#b18cff', '#7ef0b2', '#ff7aa8', '#ffe066', '#6ea8ff', '#ff9e7a', '#9be37a', '#e0a3ff'];
export const NO_TOPIC = '#8ea0c0';

export const FONT = '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif';

/**
 * Comfortable distances and angles (metres / degrees), from Meta's spatial design guidance and our own
 * testing: reading at ~1.1 m, content slightly below eye level, nothing needing a neck turn > 30°.
 */
export const ERGO = {
  shelfRadius: 1.1,
  /** card centre below the eyes (≈ 9°) */
  shelfDrop: 0.17,
  cardWidth: 0.7,
  /** text never smaller than this angular height (degrees) */
  minTextDeg: 1.2,
  graphDistance: 2.8,
  graphRadius: 1.15,
  graphDrop: 0.4,
  graphTilt: 0.3,
  menuSize: 0.16,
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Obsidian / JSON Canvas boards: their cards and arrows are links and text too. */

export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  color?: string;
}

export interface CanvasLayout {
  nodes: CanvasNode[];
  edges: { from: string; to: string; label?: string }[];
}

interface RawCanvas {
  nodes?: unknown;
  edges?: unknown;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Turn a board into searchable markdown (so links and words count) plus a layout we can draw. */
export function parseCanvas(raw: string): { markdown: string; layout: CanvasLayout } {
  let data: RawCanvas = {};
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object') data = parsed as RawCanvas;
  } catch {
    data = {};
  }
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter((n): n is Obj => !!n && typeof n === 'object');
  const edges = (Array.isArray(data.edges) ? data.edges : []).filter((e): e is Obj => !!e && typeof e === 'object');
  const parts: string[] = [];
  for (const n of nodes) {
    const type = str(n.type);
    if (type === 'text' && str(n.text)) parts.push(str(n.text)!);
    else if (type === 'file' && str(n.file)) parts.push(`[[${str(n.file)!.replace(/\.md$/i, '')}${str(n.subpath) ?? ''}]]`);
    else if (type === 'link' && str(n.url)) parts.push(`<${str(n.url)!}>`);
    else if (type === 'group' && str(n.label)) parts.push(`## ${str(n.label)!}`);
  }
  for (const e of edges) if (str(e.label)) parts.push(str(e.label)!);
  return {
    markdown: parts.join('\n\n'),
    layout: {
      nodes: nodes.slice(0, 400).map((n) => ({
        id: str(n.id) ?? '',
        type: str(n.type) ?? 'text',
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: num(n.width, 250),
        h: num(n.height, 60),
        text: str(n.type) === 'text' ? (str(n.text) ?? '').slice(0, 400) : undefined,
        file: str(n.file),
        url: str(n.url),
        label: str(n.label),
        color: str(n.color),
      })),
      edges: edges.slice(0, 800).map((e) => ({ from: str(e.fromNode) ?? '', to: str(e.toNode) ?? '', label: str(e.label) })),
    },
  };
}

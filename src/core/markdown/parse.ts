/**
 * Markdown / Obsidian note parsing.
 *
 * Pure functions only (no DOM, no file system), so they run in the browser, in a worker and in tests.
 */

export type Scalar = string;
export type FrontmatterValue = Scalar | Scalar[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedLink {
  kind: 'wiki' | 'md';
  /** `![[x]]` / `![](x)` */
  embed: boolean;
  /** Link target as written, without `#heading` and alias. */
  target: string;
  subpath: string | null;
  alias: string | null;
  /** Character offset in the body (after front matter). */
  index: number;
  /** Length of the whole link syntax in the body. */
  length: number;
}

export interface Heading {
  level: number;
  text: string;
}

export interface NoteMeta {
  frontmatter: Frontmatter;
  title: string;
  h1: string | null;
  aliases: string[];
  tags: string[];
  links: ParsedLink[];
  headings: Heading[];
  words: number;
  /** Offset of the body inside the full file content. */
  bodyOffset: number;
}

const FRONTMATTER_RE = /^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Minimal YAML subset: scalars, inline arrays and block lists. Enough for Obsidian front matter. */
export function parseFrontmatter(content: string): { data: Frontmatter; body: string; offset: number } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { data: {}, body: content, offset: 0 };
  const data: Frontmatter = {};
  let currentKey: string | null = null;
  for (const rawLine of (m[1] ?? '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(rawLine);
    if (listItem && currentKey) {
      const existing = data[currentKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(cleanScalar(listItem[1] ?? ''));
      data[currentKey] = list;
      continue;
    }
    const kv = /^([\p{L}\p{N}_-]+)\s*:\s*(.*)$/u.exec(rawLine);
    if (!kv) continue;
    currentKey = kv[1] ?? '';
    const value = (kv[2] ?? '').trim();
    if (value === '') data[currentKey] = [];
    else if (value.startsWith('[') && value.endsWith(']')) data[currentKey] = value.slice(1, -1).split(',').map(cleanScalar).filter(Boolean);
    else data[currentKey] = cleanScalar(value);
  }
  return { data, body: content.slice(m[0].length), offset: m[0].length };
}

function cleanScalar(v: string): string {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

export function toArray(v: FrontmatterValue | undefined | null): string[] {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v)
    .split(/[,\s]+/)
    .filter(Boolean);
}

/** Blank out fenced code, inline code and HTML comments (keeping offsets) so links/tags inside them are ignored. */
export function stripCode(text: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/```[\s\S]*?(```|$)/g, blank)
    .replace(/~~~[\s\S]*?(~~~|$)/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
const TAG_RE = /(^|[\s(（，。,;；])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

function splitOnce(s: string, sep: string): [string, string | null] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
}

export function extractLinks(body: string): ParsedLink[] {
  const text = stripCode(body);
  const links: ParsedLink[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const [targetPart, alias] = splitOnce(m[2] ?? '', '|');
    const [target, sub] = splitOnce(targetPart, '#');
    if (!target.trim()) continue; // [[#Heading]] points inside the same note
    links.push({
      kind: 'wiki',
      embed: m[1] === '!',
      target: target.trim(),
      subpath: sub ? sub.trim() : null,
      alias: alias ? alias.trim() : null,
      index: m.index ?? 0,
      length: m[0].length,
    });
  }
  for (const m of text.matchAll(MDLINK_RE)) {
    let href = m[3] ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue; // external URL / anchor
    let sub: string | null = null;
    const hash = href.indexOf('#');
    if (hash >= 0) {
      sub = href.slice(hash + 1);
      href = href.slice(0, hash);
    }
    try {
      href = decodeURIComponent(href);
    } catch {
      /* keep raw */
    }
    links.push({
      kind: 'md',
      embed: m[1] === '!',
      target: href,
      subpath: sub,
      alias: m[2] || null,
      index: m.index ?? 0,
      length: m[0].length,
    });
  }
  return links.sort((a, b) => a.index - b.index);
}

export function extractTags(body: string, frontmatter: Frontmatter = {}): string[] {
  const tags = new Set<string>();
  for (const t of [...toArray(frontmatter.tags), ...toArray(frontmatter.tag)]) tags.add(t.replace(/^#/, ''));
  const text = stripCode(body).replace(/^#{1,6}\s/gm, '  ');
  for (const m of text.matchAll(TAG_RE)) tags.add((m[2] ?? '').replace(/\/+$/, ''));
  return [...tags].filter(Boolean);
}

export function extractHeadings(body: string): Heading[] {
  return [...stripCode(body).matchAll(HEADING_RE)].map((m) => ({ level: (m[1] ?? '').length, text: m[2] ?? '' }));
}

const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Word count that treats each CJK character as a word (how Chinese/Japanese writers count). */
export function countWords(body: string): number {
  const text = stripCode(body);
  const cjk = (text.match(CJK_CHAR) ?? []).length;
  const latin = (text.replace(CJK_CHAR, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return cjk + latin;
}

export function parseNote(content: string, basename: string): NoteMeta {
  const { data, body, offset } = parseFrontmatter(content);
  const headings = extractHeadings(body);
  const h1 = headings.find((h) => h.level === 1);
  const title = typeof data.title === 'string' && data.title ? data.title : basename;
  return {
    frontmatter: data,
    title,
    h1: h1 ? h1.text : null,
    aliases: [...toArray(data.aliases), ...toArray(data.alias)],
    tags: extractTags(body, data),
    links: extractLinks(body),
    headings,
    words: countWords(body),
    bodyOffset: offset,
  };
}

/** Markdown -> plain readable text for previews (keeps link labels, drops syntax). */
export function readable(s: string): string {
  return s
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:[-*+>]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/!?\[\[|\]\]/g, '')
    .trim();
}

/** Plain-text context around a character index of the full file (backlink previews). */
export function contextAround(content: string, index: number, radius = 70): string {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  let lineEnd = content.indexOf('\n', index);
  if (lineEnd < 0) lineEnd = content.length;
  const start = Math.max(lineStart, index - radius);
  const end = Math.min(lineEnd, index + radius);
  let s = content.slice(start, end).trim();
  if (start > lineStart) s = '…' + s;
  if (end < lineEnd) s = s + '…';
  return readable(s);
}

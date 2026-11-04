/**
 * In-memory model of a vault: notes, attachments, link resolution (Obsidian rules), the link graph,
 * backlinks, search and the write operations a thinking session needs.
 *
 * The model knows nothing about storage. Every mutation returns the paths it changed; the app layer
 * persists them (see storage/). That keeps this file pure and fully unit-testable.
 */
import { contextAround, parseNote, type NoteMeta } from '../markdown/parse';
import { parseCanvas, type CanvasLayout } from './canvas';
import { basename, dirname, extname, join, normalize, sanitizeName } from './paths';

export const NOTE_EXTS = new Set(['.md', '.markdown', '.mdx', '.txt']);
export const CANVAS_EXT = '.canvas';

export type NoteKind = 'md' | 'txt' | 'canvas';
export type FileKind = 'image' | 'pdf' | 'audio' | 'video' | 'code' | 'file';

export function fileKind(p: string): FileKind {
  const ext = extname(p);
  if (/^\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (/^\.(mp3|wav|m4a|ogg|flac|aac)$/.test(ext)) return 'audio';
  if (/^\.(mp4|webm|mov|m4v|ogv)$/.test(ext)) return 'video';
  if (/^\.(json|csv|tsv|ya?ml|js|ts|py|html|css|xml|ini|toml|sh)$/.test(ext)) return 'code';
  return 'file';
}

export function isNotePath(p: string): boolean {
  const ext = extname(p);
  return NOTE_EXTS.has(ext) || ext === CANVAS_EXT;
}

/** A file as storage hands it to the model. */
export interface SourceFile {
  path: string;
  /** Text content for notes. Attachments leave it undefined. */
  content?: string;
  mtime: number;
  ctime?: number;
  size?: number;
}

export interface Note extends NoteMeta {
  path: string;
  name: string;
  kind: NoteKind;
  ext: string;
  folder: string;
  /** Text we analyse. For canvases this is the markdown we derived from the board. */
  content: string;
  /** The file's raw text (differs from content only for canvases). */
  raw: string;
  canvas: CanvasLayout | null;
  mtime: number;
  ctime: number;
  size: number;
  created: number;
}

export interface Attachment {
  path: string;
  name: string;
  folder: string;
  kind: FileKind;
  mtime: number;
  size: number;
}

export interface GraphNode {
  id: string;
  name: string;
  title: string;
  folder: string;
  tags: string[];
  words: number;
  mtime: number;
  created: number;
  kind?: NoteKind | FileKind;
  ghost?: boolean;
  file?: boolean;
  in: number;
  out: number;
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

export interface Graph {
  vault: string;
  version: number;
  nodes: GraphNode[];
  links: GraphLink[];
  tags: { tag: string; count: number }[];
  folders: { folder: string; count: number }[];
}

export interface Backlink {
  path: string;
  name: string;
  contexts: string[];
}

export interface Outgoing {
  target: string;
  path: string | null;
  name: string;
  exists: boolean;
  file?: boolean;
  kind?: FileKind;
}

export interface Mention {
  path: string;
  name: string;
  context: string;
}

export interface NoteView {
  note: Note;
  backlinks: Backlink[];
  outgoing: Outgoing[];
  mentions: Mention[];
}

export interface SearchHit {
  path: string;
  name: string;
  folder: string;
  score: number;
  snippet: string;
}

export interface VaultStats {
  vault: string;
  notes: number;
  links: number;
  unresolved: number;
  orphans: number;
  tags: number;
  attachments: number;
  words: number;
}

const lower = (s: string): string => s.toLocaleLowerCase();
const stripMd = (p: string): string => p.replace(/\.md$/i, '');
const isExternal = (t: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(t);

/** When was this note born? front matter `created`/`date` > YYYY-MM-DD in the name > file time. */
function createdTime(meta: NoteMeta, name: string, mtime: number, ctime: number): number {
  for (const key of ['created', 'date', 'created_at', '创建时间', '日期']) {
    const v = meta.frontmatter[key];
    if (typeof v === 'string' && v) {
      const t = Date.parse(v.replace(' ', 'T'));
      if (!Number.isNaN(t)) return t;
    }
  }
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
    if (!Number.isNaN(t)) return t;
  }
  return Math.min(ctime || mtime, mtime);
}

export class VaultError extends Error {
  constructor(
    readonly code: 'exists' | 'missing' | 'invalid-name' | 'read-only',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export class Vault {
  readonly notes = new Map<string, Note>();
  readonly attachments = new Map<string, Attachment>();
  version = 0;

  private byName = new Map<string, string[]>();
  private byPath = new Map<string, string>();
  private byAlias = new Map<string, string>();
  private attByBase: Map<string, string> | null = null;
  private graphCache: Graph | null = null;

  constructor(public name: string) {}

  static from(name: string, files: Iterable<SourceFile>): Vault {
    const v = new Vault(name);
    for (const f of files) v.ingest(f);
    v.touch();
    return v;
  }

  // ---------- loading ----------

  private ingest(f: SourceFile): void {
    const path = normalize(f.path);
    if (!isNotePath(path)) {
      this.attachments.set(path, {
        path,
        name: basename(path),
        folder: dirname(path),
        kind: fileKind(path),
        mtime: f.mtime,
        size: f.size ?? 0,
      });
      return;
    }
    const raw = f.content ?? '';
    const ext = extname(path);
    const kind: NoteKind = ext === CANVAS_EXT ? 'canvas' : ext === '.txt' ? 'txt' : 'md';
    const name = basename(path, ext);
    let content = raw;
    let canvas: CanvasLayout | null = null;
    if (kind === 'canvas') {
      const c = parseCanvas(raw);
      content = c.markdown;
      canvas = c.layout;
    }
    const meta = parseNote(content, name);
    const ctime = f.ctime ?? f.mtime;
    this.notes.set(path, {
      ...meta,
      path,
      name,
      kind,
      ext,
      folder: dirname(path),
      content,
      raw,
      canvas,
      mtime: f.mtime,
      ctime,
      size: f.size ?? raw.length,
      created: createdTime(meta, name, f.mtime, ctime),
    });
  }

  private touch(): void {
    this.version++;
    this.graphCache = null;
    this.attByBase = null;
    this.byName = new Map();
    this.byPath = new Map();
    this.byAlias = new Map();
    for (const n of this.notes.values()) {
      const key = lower(n.name);
      this.byName.set(key, [...(this.byName.get(key) ?? []), n.path]);
      this.byPath.set(lower(stripMd(n.path)), n.path);
      if (n.ext !== '.md') {
        this.byPath.set(lower(n.path), n.path);
        const full = lower(basename(n.path));
        this.byName.set(full, [...(this.byName.get(full) ?? []), n.path]);
      }
      for (const a of n.aliases) this.byAlias.set(lower(a), n.path);
    }
  }

  // ---------- resolution ----------

  /** Resolve a link target written in `fromPath` to a note path (Obsidian's shortest-path rules). */
  resolve(target: string, fromPath = ''): string | null {
    if (!target) return null;
    let t = target.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const fromDir = dirname(fromPath);
    const ext = extname(t);
    if (ext && ext !== '.md' && !this.byName.has(lower(basename(t))) && !this.byPath.has(lower(t.replace(/^\//, '')))) return null; // an attachment, not a note
    t = stripMd(t);
    if (fromDir) {
      const hit = this.byPath.get(lower(join(fromDir, t)));
      if (hit) return hit;
    }
    const abs = normalize(t.replace(/^\//, ''));
    const direct = this.byPath.get(lower(abs));
    if (direct) return direct;
    const candidates = this.byName.get(lower(basename(t)));
    if (candidates?.length) {
      if (t.includes('/')) {
        const suffix = candidates.find((c) => lower(stripMd(c)).endsWith(lower(t)));
        if (suffix) return suffix;
      }
      const same = candidates.find((c) => dirname(c) === fromDir);
      if (same) return same;
      return [...candidates].sort((a, b) => a.length - b.length)[0] ?? null;
    }
    return this.byAlias.get(lower(t)) ?? null;
  }

  isAttachmentTarget(target: string): boolean {
    const ext = extname(target.split('#')[0] ?? '');
    return !!ext && !NOTE_EXTS.has(ext) && ext !== CANVAS_EXT;
  }

  /** Find an attachment the way Obsidian does: relative, absolute, then by base name anywhere. */
  findAttachment(target: string, fromPath = ''): string | null {
    let t = (target.split('#')[0] ?? '').replace(/^\.\//, '');
    try {
      t = decodeURI(t);
    } catch {
      /* keep raw */
    }
    if (!t) return null;
    for (const c of [join(dirname(fromPath), t), normalize(t.replace(/^\//, ''))]) if (this.attachments.has(c)) return c;
    if (!this.attByBase) {
      this.attByBase = new Map();
      for (const a of this.attachments.keys()) {
        const b = lower(basename(a));
        if (!this.attByBase.has(b)) this.attByBase.set(b, a);
      }
    }
    return this.attByBase.get(lower(basename(t))) ?? null;
  }

  // ---------- graph ----------

  graph(): Graph {
    if (this.graphCache) return this.graphCache;
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphLink>();
    const tagCounts = new Map<string, number>();
    const folderCounts = new Map<string, number>();
    for (const n of this.notes.values()) {
      nodes.set(n.path, {
        id: n.path,
        name: n.name,
        title: n.title,
        folder: n.folder,
        tags: n.tags,
        words: n.words,
        mtime: n.mtime,
        created: n.created,
        kind: n.kind === 'md' ? undefined : n.kind,
        in: 0,
        out: 0,
        degree: 0,
      });
      for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      const top = n.folder.split('/')[0] ?? '';
      folderCounts.set(top, (folderCounts.get(top) ?? 0) + 1);
    }
    for (const n of this.notes.values()) {
      for (const l of n.links) {
        if (isExternal(l.target)) continue;
        let target = this.resolve(l.target, n.path);
        if (!target && this.isAttachmentTarget(l.target)) {
          const file = this.findAttachment(l.target, n.path);
          if (!file) continue;
          target = file;
          if (!nodes.has(file)) {
            const a = this.attachments.get(file);
            nodes.set(file, {
              id: file,
              name: basename(file),
              title: basename(file),
              folder: dirname(file),
              tags: [],
              kind: fileKind(file),
              file: true,
              words: 0,
              mtime: a?.mtime ?? 0,
              created: a?.mtime ?? 0,
              in: 0,
              out: 0,
              degree: 0,
            });
          }
        }
        if (!target) {
          const ghostName = stripMd(basename(l.target));
          target = 'ghost:' + lower(ghostName);
          if (!nodes.has(target))
            nodes.set(target, {
              id: target,
              name: ghostName,
              title: ghostName,
              folder: '',
              tags: [],
              ghost: true,
              words: 0,
              mtime: 0,
              created: 0,
              in: 0,
              out: 0,
              degree: 0,
            });
        }
        if (target === n.path) continue;
        const key = n.path + '\u0000' + target;
        const e = edges.get(key);
        if (e) e.weight++;
        else edges.set(key, { source: n.path, target, weight: 1 });
      }
    }
    for (const e of edges.values()) {
      const s = nodes.get(e.source);
      const t = nodes.get(e.target);
      if (s) s.out++;
      if (t) t.in++;
    }
    for (const node of nodes.values()) node.degree = node.in + node.out;
    this.graphCache = {
      vault: this.name,
      version: this.version,
      nodes: [...nodes.values()],
      links: [...edges.values()],
      tags: [...tagCounts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
      folders: [...folderCounts].sort((a, b) => b[1] - a[1]).map(([folder, count]) => ({ folder, count })),
    };
    return this.graphCache;
  }

  stats(): VaultStats {
    const g = this.graph();
    const real = g.nodes.filter((n) => !n.ghost && !n.file);
    return {
      vault: this.name,
      notes: real.length,
      links: g.links.length,
      unresolved: g.nodes.filter((n) => n.ghost).length,
      orphans: real.filter((n) => n.degree === 0).length,
      tags: g.tags.length,
      attachments: this.attachments.size,
      words: real.reduce((s, n) => s + n.words, 0),
    };
  }

  // ---------- reading ----------

  view(path: string): NoteView | null {
    const n = this.notes.get(path);
    if (!n) return null;
    const backlinks: Backlink[] = [];
    for (const other of this.notes.values()) {
      if (other.path === path) continue;
      const hits = other.links.filter((l) => this.resolve(l.target, other.path) === path);
      if (hits.length)
        backlinks.push({
          path: other.path,
          name: other.name,
          contexts: hits.slice(0, 3).map((l) => contextAround(other.content, l.index + other.bodyOffset)),
        });
    }
    const outgoing: Outgoing[] = [];
    const seen = new Set<string>();
    for (const l of n.links) {
      if (isExternal(l.target)) continue;
      const resolved = this.resolve(l.target, path);
      if (!resolved && this.isAttachmentTarget(l.target)) {
        const file = this.findAttachment(l.target, path);
        if (file && !seen.has(file)) {
          seen.add(file);
          outgoing.push({ target: l.target, path: file, name: basename(file), exists: true, file: true, kind: fileKind(file) });
        }
        continue;
      }
      const key = resolved ?? 'ghost:' + lower(l.target);
      if (seen.has(key)) continue;
      seen.add(key);
      outgoing.push({
        target: l.target,
        path: resolved,
        name: resolved ? (this.notes.get(resolved)?.name ?? resolved) : stripMd(basename(l.target)),
        exists: !!resolved,
      });
    }
    const mentions: Mention[] = [];
    if (n.name.length >= 2) {
      const needle = lower(n.name);
      for (const other of this.notes.values()) {
        if (other.path === path || backlinks.some((b) => b.path === other.path)) continue;
        const idx = lower(other.content).indexOf(needle);
        if (idx >= 0) mentions.push({ path: other.path, name: other.name, context: contextAround(other.content, idx) });
        if (mentions.length >= 10) break;
      }
    }
    return { note: n, backlinks, outgoing, mentions };
  }

  search(query: string, limit = 30): SearchHit[] {
    const q = lower(query.trim());
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const tagQuery = q.startsWith('#') ? q.slice(1) : null;
    const results: SearchHit[] = [];
    for (const n of this.notes.values()) {
      const name = lower(n.name);
      const content = lower(n.content);
      if (tagQuery !== null) {
        let score = 0;
        if (n.tags.some((t) => lower(t) === tagQuery || lower(t).startsWith(tagQuery + '/'))) score = 50;
        else if (n.tags.some((t) => lower(t).includes(tagQuery))) score = 20;
        if (score) results.push({ path: n.path, name: n.name, folder: n.folder, score, snippet: '#' + n.tags.join('  #') });
        continue;
      }
      let score = 0;
      let allTerms = true;
      for (const t of terms) {
        let s = 0;
        if (name === t) s += 100;
        else if (name.startsWith(t)) s += 60;
        else if (name.includes(t)) s += 40;
        if (n.aliases.some((a) => lower(a).includes(t))) s += 30;
        if (lower(n.path).includes(t)) s += 10;
        if (n.tags.some((tag) => lower(tag).includes(t))) s += 15;
        let count = 0;
        let i = content.indexOf(t);
        while (i >= 0 && count < 20) {
          count++;
          i = content.indexOf(t, i + t.length);
        }
        s += Math.min(count, 10) * 3;
        if (!s) {
          allTerms = false;
          break;
        }
        score += s;
      }
      if (!allTerms || !score) continue;
      const first = content.indexOf(terms[0] ?? '');
      results.push({
        path: n.path,
        name: n.name,
        folder: n.folder,
        score,
        snippet: first >= 0 ? contextAround(n.content, first, 60) : n.folder,
      });
    }
    return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
  }

  // ---------- writing ----------

  /** Create or replace a text note. Returns the normalised path. */
  write(path: string, content: string, now = Date.now()): string {
    let p = normalize(path);
    const ext = extname(p);
    if (ext === CANVAS_EXT) throw new VaultError('read-only', 'Canvas boards are edited in Obsidian');
    if (!NOTE_EXTS.has(ext)) p += '.md';
    const prev = this.notes.get(p);
    this.ingest({ path: p, content, mtime: now, ctime: prev?.ctime ?? now, size: content.length });
    this.touch();
    return p;
  }

  /** A new note named `name` in `folder`. Picks "name 2", "name 3" … when the name is taken and `unique` is set. */
  create(name: string, folder = '', content?: string, { unique = false, now = Date.now() } = {}): string {
    const clean = sanitizeName(name);
    if (!clean) throw new VaultError('invalid-name', 'A note needs a name');
    let path = join(folder, clean + '.md');
    let i = 2;
    while (this.notes.has(path)) {
      if (!unique) throw new VaultError('exists', `"${clean}" already exists`);
      path = join(folder, `${clean} ${i++}.md`);
    }
    return this.write(path, content ?? `# ${basename(path, '.md')}\n\n`, now);
  }

  remove(path: string): boolean {
    const had = this.notes.delete(path) || this.attachments.delete(path);
    if (had) this.touch();
    return had;
  }

  /**
   * Rename a note and rewrite links that pointed at it (as Obsidian does).
   * Returns every path whose content changed, the renamed note first.
   */
  rename(from: string, toName: string, now = Date.now()): string[] {
    const note = this.notes.get(from);
    if (!note) throw new VaultError('missing', 'Note not found');
    if (note.kind === 'canvas') throw new VaultError('read-only', 'Canvas boards are renamed in Obsidian');
    const clean = sanitizeName(toName);
    if (!clean) throw new VaultError('invalid-name', 'A note needs a name');
    const to = join(note.folder, clean + note.ext);
    if (to === from) return [];
    if (this.notes.has(to)) throw new VaultError('exists', `"${clean}" already exists`);
    // find referrers before the old name disappears
    const referrers: { path: string; content: string }[] = [];
    for (const other of this.notes.values()) {
      if (other.kind === 'canvas') continue;
      const hits = other.links.filter((l) => l.kind === 'wiki' && this.resolve(l.target, other.path) === from);
      if (!hits.length) continue;
      let text = other.raw;
      // replace from the back so offsets stay valid
      for (const l of [...hits].sort((a, b) => b.index - a.index)) {
        const start = l.index + other.bodyOffset;
        const original = text.slice(start, start + l.length);
        const sub = l.subpath ? '#' + l.subpath : '';
        const alias = l.alias ? '|' + l.alias : '';
        const newTarget = l.target.includes('/') ? join(dirname(l.target), clean) : clean;
        const replacement = `${l.embed ? '!' : ''}[[${newTarget}${sub}${alias}]]`;
        if (original.startsWith('[[') || original.startsWith('![[')) text = text.slice(0, start) + replacement + text.slice(start + l.length);
      }
      referrers.push({ path: other.path === from ? to : other.path, content: text });
    }
    this.notes.delete(from);
    this.ingest({ path: to, content: note.raw, mtime: now, ctime: note.ctime, size: note.size });
    for (const r of referrers) {
      const prev = this.notes.get(r.path);
      this.ingest({ path: r.path, content: r.content, mtime: now, ctime: prev?.ctime ?? now });
    }
    this.touch();
    return [to, ...referrers.map((r) => r.path).filter((p) => p !== to)];
  }

  /** The text of `[[target]]` as written from `from`: the shortest name that still resolves to it. */
  linkText(fromPath: string, toPath: string): string {
    const to = this.notes.get(toPath);
    const name = to ? (to.ext === '.md' ? to.name : basename(toPath)) : basename(toPath);
    return this.resolve(name, fromPath) === toPath ? name : stripMd(toPath);
  }

  /**
   * Link two notes: append `[[to]]` (and an optional reason) to `from`.
   * With a reason the link gets its own line "- [[B]] — reason" under a "Connections" heading, so the
   * thought behind the connection is kept in the note itself. Returns the changed path.
   */
  link(fromPath: string, toPath: string, reason = '', now = Date.now()): string {
    let from = this.notes.get(fromPath);
    let to: { path: string } | undefined = this.notes.get(toPath) ?? this.attachments.get(toPath);
    if (!from || !to) throw new VaultError('missing', 'Note not found');
    if (from.kind === 'canvas') {
      // boards can't hold a link we write: write it into the other side instead
      const other = this.notes.get(toPath);
      if (!other || other.kind === 'canvas') throw new VaultError('read-only', 'Neither side is an editable note');
      [from, to] = [other, from];
    }
    const target = this.linkText(from.path, to.path);
    const link = `[[${target}]]`;
    const r = reason.trim().replace(/\s+/g, ' ');
    let text = from.raw.replace(/\s+$/, '');
    if (r) {
      const heading = /^##\s+(Connections|相关|联系)\s*$/m;
      const line = `- ${link} — ${r}`;
      if (heading.test(text)) {
        const m = heading.exec(text)!;
        const after = text.slice(m.index + m[0].length);
        const nextHeading = after.search(/\n#{1,6}\s/);
        const insertAt = nextHeading < 0 ? text.length : m.index + m[0].length + nextHeading;
        text = text.slice(0, insertAt).replace(/\s+$/, '') + '\n' + line + text.slice(insertAt);
      } else text += `\n\n## Connections\n${line}`;
    } else {
      const lines = text.split('\n');
      const last = lines[lines.length - 1] ?? '';
      if (/^(相关|Related)\s*[:：]/.test(last)) lines[lines.length - 1] = last + ' · ' + link;
      else lines.push('', `Related: ${link}`);
      text = lines.join('\n');
    }
    return this.write(from.path, text + '\n', now);
  }
}

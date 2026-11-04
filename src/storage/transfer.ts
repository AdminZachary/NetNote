/**
 * Getting notes in and out: a .zip of a vault, a picked folder, or loose Markdown files; and back out
 * as a .zip that opens in Obsidian (or any Markdown editor) unchanged.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { isNotePath } from '../core/vault/vault';
import { normalize } from '../core/vault/paths';

export interface ImportedFile {
  path: string;
  content?: string;
  bytes?: Uint8Array;
  mtime: number;
}

const IGNORED = /(^|\/)(\.obsidian|\.git|\.trash|node_modules|__MACOSX)(\/|$)|(^|\/)\.[^/]*$|\.DS_Store$/;
/** Attachments larger than this are skipped: the headset is for thinking, not a file server. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function shouldImport(path: string): boolean {
  return !!path && !IGNORED.test(path);
}

/** "MyVault/a.md", "MyVault/b/c.md" → "a.md", "b/c.md" when every file shares one top folder. */
export function stripCommonRoot<T extends { path: string }>(files: T[]): T[] {
  if (!files.length) return files;
  const first = files[0]!.path.split('/')[0];
  if (!first || !files.every((f) => f.path.includes('/') && f.path.split('/')[0] === first)) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
}

export function readZip(data: Uint8Array, now = Date.now()): ImportedFile[] {
  const entries = unzipSync(data);
  const out: ImportedFile[] = [];
  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue;
    const path = normalize(rawPath);
    if (!shouldImport(path)) continue;
    if (isNotePath(path)) out.push({ path, content: strFromU8(bytes).replace(/^\ufeff/, ''), mtime: now });
    else if (bytes.byteLength <= MAX_ATTACHMENT_BYTES) out.push({ path, bytes, mtime: now });
  }
  return stripCommonRoot(out);
}

/** Files from `<input type=file webkitdirectory>` or a drop. */
export async function readFileList(files: Iterable<File>): Promise<ImportedFile[]> {
  const out: ImportedFile[] = [];
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const path = normalize(rel);
    if (!shouldImport(path)) continue;
    if (path.toLowerCase().endsWith('.zip')) {
      out.push(...readZip(new Uint8Array(await f.arrayBuffer()), f.lastModified));
      continue;
    }
    if (isNotePath(path)) out.push({ path, content: (await f.text()).replace(/^\ufeff/, ''), mtime: f.lastModified });
    else if (f.size <= MAX_ATTACHMENT_BYTES) out.push({ path, bytes: new Uint8Array(await f.arrayBuffer()), mtime: f.lastModified });
  }
  return stripCommonRoot(out);
}

export interface ExportFile {
  path: string;
  content?: string;
  bytes?: Uint8Array;
  mtime: number;
}

/** Zip stores DOS dates (1980–2099); anything outside becomes "now". */
function zipDate(ms: number): Date {
  const d = new Date(ms);
  const y = d.getFullYear();
  return Number.isFinite(y) && y >= 1980 && y <= 2099 ? d : new Date();
}

export function writeZip(files: ExportFile[]): Uint8Array {
  const tree: Zippable = {};
  for (const f of files) {
    const data = f.bytes ?? strToU8(f.content ?? '');
    tree[f.path] = [data, { mtime: zipDate(f.mtime) }];
  }
  return zipSync(tree, { level: 6 });
}

/** POSIX path helpers for vault-relative paths ("folder/note.md"). The browser has no `path` module. */

export function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const b = p.slice(p.lastIndexOf('/') + 1);
  return ext && b.toLowerCase().endsWith(ext.toLowerCase()) ? b.slice(0, b.length - ext.length) : b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
}

export function stripExt(p: string): string {
  const e = extname(p);
  return e ? p.slice(0, -e.length) : p;
}

/** Characters that are not allowed in file names on Windows/macOS. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

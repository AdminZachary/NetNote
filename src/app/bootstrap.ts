/**
 * First-run and start-up decisions, kept out of the DOM so they are unit-tested:
 * which library to open, and seeding the bundled sample library the very first time.
 */
import type { ImportedFile } from '../storage/transfer';
import type { Library } from './library';

export const SAMPLE_NAME = 'Learning & memory (sample)';

/** Turn `import.meta.glob('/sample-vault/**')` output into importable files. */
export function sampleFiles(modules: Record<string, string>, now = Date.now()): ImportedFile[] {
  return Object.entries(modules)
    .map(([key, content]) => ({ path: key.replace(/^.*?sample-vault\//, ''), content, mtime: now }))
    .filter((f) => f.path && !f.path.startsWith('.'))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Pick the library to open: the last one used if it still exists, otherwise the most recently
 * updated, otherwise a freshly seeded sample. Returns its id.
 */
export async function chooseLibrary(library: Library, sample: ImportedFile[], lastId: string | null): Promise<string> {
  const all = await library.list();
  if (lastId && all.some((v) => v.id === lastId)) return lastId;
  if (all.length) return [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id;
  return library.add({ name: SAMPLE_NAME, origin: 'sample', files: sample });
}

import { describe, expect, it } from 'vitest';
import { chooseLibrary, SAMPLE_NAME, sampleFiles } from '../../src/app/bootstrap';
import { Library } from '../../src/app/library';
import { MemoryStore } from '../../src/storage/store';

describe('bootstrap', () => {
  it('turns glob keys into vault paths', () => {
    const f = sampleFiles({ '/sample-vault/B.md': 'b', '/sample-vault/sub/A.md': 'a', '/sample-vault/.hidden.md': 'x' }, 5);
    expect(f.map((x) => x.path)).toEqual(['B.md', 'sub/A.md']);
    expect(f[0]!.mtime).toBe(5);
  });

  it('seeds the sample library on first run only', async () => {
    const lib = new Library(new MemoryStore());
    const files = sampleFiles({ '/sample-vault/A.md': '# A' });
    const id = await chooseLibrary(lib, files, null);
    const all = await lib.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe(SAMPLE_NAME);
    expect(await chooseLibrary(lib, files, null)).toBe(id);
    expect(await lib.list()).toHaveLength(1);
  });

  it('reopens the last library if it still exists, else the most recent', async () => {
    let now = 0;
    const lib = new Library(new MemoryStore(), () => (now += 10));
    const a = await lib.add({ name: 'a', origin: 'import', files: [] });
    const b = await lib.add({ name: 'b', origin: 'import', files: [] });
    expect(await chooseLibrary(lib, [], a)).toBe(a);
    expect(await chooseLibrary(lib, [], 'gone')).toBe(b);
  });
});

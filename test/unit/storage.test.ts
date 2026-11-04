import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Library } from '../../src/app/library';
import { IdbStore, MemoryStore, type VaultStore } from '../../src/storage/store';
import { readZip, shouldImport, stripCommonRoot, writeZip } from '../../src/storage/transfer';

const stores: [string, () => Promise<VaultStore>][] = [
  ['MemoryStore', () => Promise.resolve(new MemoryStore())],
  ['IdbStore', () => IdbStore.open(new IDBFactory())],
];

describe.each(stores)('%s', (_name, make) => {
  it('stores vaults, files and state, and deletes them together', async () => {
    const s = await make();
    await s.putVault({ id: 'a', name: 'A', createdAt: 1, updatedAt: 1, origin: 'empty' });
    await s.putVault({ id: 'b', name: 'B', createdAt: 1, updatedAt: 2, origin: 'empty' });
    await s.putFiles([
      { vaultId: 'a', path: 'x.md', content: 'x', mtime: 1, ctime: 1, size: 1 },
      { vaultId: 'b', path: 'x.md', content: 'other', mtime: 1, ctime: 1, size: 5 },
    ]);
    await s.setState('a', 'wall', { cards: [1, 2] });
    expect((await s.listVaults()).map((v) => v.id)).toEqual(['b', 'a']);
    expect((await s.getFile('a', 'x.md'))?.content).toBe('x');
    expect(await s.getState('a', 'wall')).toEqual({ cards: [1, 2] });
    await s.deleteFiles('a', ['x.md']);
    expect(await s.listFiles('a')).toEqual([]);
    await s.deleteVault('a');
    expect(await s.getState('a', 'wall')).toBeUndefined();
    expect((await s.listFiles('b')).length).toBe(1);
  });
});

describe('transfer', () => {
  it('round-trips a vault through a zip, dropping Obsidian internals and the shared root folder', () => {
    const zip = writeZip([
      { path: 'Vault/a.md', content: '# A [[b]]', mtime: 1 },
      { path: 'Vault/sub/b.md', content: 'b', mtime: 1 },
      { path: 'Vault/.obsidian/app.json', content: '{}', mtime: 1 },
      { path: 'Vault/pic.png', bytes: new Uint8Array([1, 2, 3]), mtime: 1 },
    ]);
    const files = readZip(zip, 5);
    expect(files.map((f) => f.path).sort()).toEqual(['a.md', 'pic.png', 'sub/b.md']);
    expect(files.find((f) => f.path === 'a.md')?.content).toBe('# A [[b]]');
    expect([...(files.find((f) => f.path === 'pic.png')?.bytes ?? [])]).toEqual([1, 2, 3]);
  });
  it('filters hidden files and keeps mixed roots', () => {
    expect(shouldImport('.git/config')).toBe(false);
    expect(shouldImport('notes/.DS_Store')).toBe(false);
    expect(shouldImport('notes/a.md')).toBe(true);
    expect(stripCommonRoot([{ path: 'a/x.md' }, { path: 'b/y.md' }]).map((f) => f.path)).toEqual(['a/x.md', 'b/y.md']);
  });
});

describe('Library', () => {
  const setup = async (): Promise<Library> => {
    let t = 1000;
    const lib = new Library(new MemoryStore(), () => ++t);
    const id = await lib.add({
      name: 'Test',
      origin: 'import',
      files: [
        { path: 'A.md', content: '# A', mtime: 1 },
        { path: 'B.md', content: '# B\nmentions A', mtime: 1 },
      ],
    });
    await lib.open(id);
    return lib;
  };
  it('persists writes so a fresh open sees them', async () => {
    const lib = await setup();
    const events: string[][] = [];
    lib.on('changed', (e) => events.push(e.paths));
    const p = await lib.createNote('Idea', 'inbox', '# Idea\nfirst thought');
    await lib.link('A.md', p, 'it starts here');
    await lib.rename('B.md', 'Bee');
    await lib.open(lib.meta!.id);
    const v = lib.vault!;
    expect([...v.notes.keys()].sort()).toEqual(['A.md', 'Bee.md', 'inbox/Idea.md']);
    expect(v.notes.get('A.md')!.raw).toContain('[[Idea]] — it starts here');
    expect(events).toEqual([['inbox/Idea.md'], ['A.md'], ['Bee.md', 'B.md']]);
  });
  it('recomputes insights only when the vault changed', async () => {
    const lib = await setup();
    const a = lib.insights();
    expect(lib.insights()).toBe(a);
    await lib.saveNote('A.md', '# A\nchanged');
    expect(lib.insights()).not.toBe(a);
  });
  it('exports a zip with every file', async () => {
    const lib = await setup();
    const files = readZip(await lib.exportZip());
    expect(files.map((f) => f.path).sort()).toEqual(['A.md', 'B.md']);
  });
});

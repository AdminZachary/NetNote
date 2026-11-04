import { describe, expect, it } from 'vitest';
import { Vault, VaultError, type SourceFile } from '../../src/core/vault/vault';

const files = (spec: Record<string, string | null>): SourceFile[] =>
  Object.entries(spec).map(([path, content]) => ({ path, content: content ?? undefined, mtime: 1000, ctime: 900 }));

describe('Vault resolution', () => {
  const v = Vault.from(
    'test',
    files({
      'Home.md': '[[Idea]] [[sub/Deep]] [[Missing]] [[Alias Name]] ![[pic.png]] [[log.txt]]',
      'Idea.md': '---\naliases: [Alias Name]\n---\n# Idea',
      'sub/Deep.md': 'deep [[Idea]]',
      'sub/Idea.md': 'a second Idea in sub',
      'log.txt': 'plain text [[Home]]',
      'pic.png': null,
    }),
  );
  it('prefers the same folder, then the shortest path', () => {
    expect(v.resolve('Idea', 'sub/Deep.md')).toBe('sub/Idea.md');
    expect(v.resolve('Idea', 'Home.md')).toBe('Idea.md');
  });
  it('resolves paths, aliases and non-md notes; leaves attachments to findAttachment', () => {
    expect(v.resolve('sub/Deep')).toBe('sub/Deep.md');
    expect(v.resolve('Alias Name')).toBe('Idea.md');
    expect(v.resolve('log.txt')).toBe('log.txt');
    expect(v.resolve('pic.png')).toBeNull();
    expect(v.findAttachment('pic.png', 'sub/Deep.md')).toBe('pic.png');
  });
  it('builds a graph with ghosts, attachments and degrees', () => {
    const g = v.graph();
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get('ghost:missing')?.ghost).toBe(true);
    expect(byId.get('pic.png')).toMatchObject({ file: true, kind: 'image' });
    expect(byId.get('Idea.md')!.in).toBe(1); // one source note, two links (weight 2)
    expect(g.links.find((l) => l.source === 'Home.md' && l.target === 'Idea.md')?.weight).toBe(2);
    expect(v.stats()).toMatchObject({ notes: 5, unresolved: 1, attachments: 1 });
  });
  it('view() lists backlinks with context, outgoing links and unlinked mentions', () => {
    const view = v.view('Home.md')!;
    expect(view.backlinks.map((b) => b.path)).toEqual(['log.txt']);
    expect(view.backlinks[0]!.contexts[0]).toContain('plain text');
    expect(view.outgoing.find((o) => o.target === 'Missing')).toMatchObject({ exists: false, path: null });
    expect(view.outgoing.find((o) => o.target === 'pic.png')).toMatchObject({ file: true, kind: 'image' });
    const idea = v.view('sub/Idea.md')!;
    expect(idea.mentions.map((m) => m.path).sort()).toEqual(['Home.md', 'Idea.md']);
  });
  it('search ranks names over content and supports #tags', () => {
    const s = Vault.from('s', files({ 'Memory.md': 'about #learning', 'Other.md': 'memory memory memory' }));
    expect(s.search('memory').map((h) => h.path)).toEqual(['Memory.md', 'Other.md']);
    expect(s.search('#learn').map((h) => h.path)).toEqual(['Memory.md']);
    expect(s.search('  ')).toEqual([]);
  });
});

describe('Vault writing', () => {
  it('create() refuses duplicates unless unique, and sanitises names', () => {
    const v = Vault.from('w', files({ 'A.md': '# A' }));
    expect(() => v.create('A')).toThrow(VaultError);
    expect(v.create('A', '', undefined, { unique: true })).toBe('A 2.md');
    expect(v.create('a/b:c', 'inbox')).toBe('inbox/a b c.md');
    expect(() => v.create('   ')).toThrow(/name/);
  });
  it('link() appends a Related line, or a reasoned line under Connections', () => {
    const v = Vault.from('w', files({ 'A.md': '# A\n', 'B.md': '# B' }));
    v.link('A.md', 'B.md');
    expect(v.notes.get('A.md')!.raw).toBe('# A\n\nRelated: [[B]]\n');
    v.write('C.md', '# C');
    v.link('A.md', 'C.md');
    expect(v.notes.get('A.md')!.raw).toContain('Related: [[B]] · [[C]]');
    v.link('B.md', 'A.md', 'same  mechanism');
    v.link('B.md', 'C.md', 'contrast');
    expect(v.notes.get('B.md')!.raw).toBe('# B\n\n## Connections\n- [[A]] — same mechanism\n- [[C]] — contrast\n');
    expect(v.graph().links.some((l) => l.source === 'B.md' && l.target === 'C.md')).toBe(true);
  });
  it('link() writes into the other side when the source is a canvas', () => {
    const v = Vault.from('w', files({ 'Board.canvas': '{"nodes":[]}', 'N.md': 'n' }));
    expect(v.link('Board.canvas', 'N.md')).toBe('N.md');
    expect(v.notes.get('N.md')!.raw).toContain('[[Board.canvas]]');
  });
  it('rename() moves the note and rewrites wiki links, keeping alias and heading', () => {
    const v = Vault.from('w', files({ 'Old.md': 'self', 'X.md': 'see [[Old#Part|nice]] and ![[Old]] and [[Other]]', 'Other.md': '' }));
    const changed = v.rename('Old.md', 'New');
    expect(changed).toEqual(['New.md', 'X.md']);
    expect(v.notes.has('Old.md')).toBe(false);
    expect(v.notes.get('X.md')!.raw).toBe('see [[New#Part|nice]] and ![[New]] and [[Other]]');
    expect(v.resolve('New', 'X.md')).toBe('New.md');
    expect(() => v.rename('New.md', 'Other')).toThrow(/exists/);
  });
  it('canvas boards become searchable text and cannot be overwritten', () => {
    const v = Vault.from(
      'w',
      files({
        'A.md': 'a',
        'Board.canvas': JSON.stringify({
          nodes: [
            { id: '1', type: 'file', file: 'A.md' },
            { id: '2', type: 'text', text: 'unique idea' },
          ],
          edges: [],
        }),
      }),
    );
    expect(v.graph().links.some((l) => l.source === 'Board.canvas' && l.target === 'A.md')).toBe(true);
    expect(v.search('unique')[0]!.path).toBe('Board.canvas');
    expect(() => v.write('Board.canvas', '{}')).toThrow(VaultError);
  });
  it('created time comes from front matter, then the name, then the file', () => {
    const v = Vault.from('w', files({ 'a.md': '---\ncreated: 2024-03-04\n---\n', '2023-01-02 log.md': '', 'c.md': '' }));
    expect(new Date(v.notes.get('a.md')!.created).getUTCFullYear()).toBe(2024);
    expect(new Date(v.notes.get('2023-01-02 log.md')!.created).getFullYear()).toBe(2023);
    expect(v.notes.get('c.md')!.created).toBe(900);
  });
});

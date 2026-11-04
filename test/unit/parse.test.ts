import { describe, expect, it } from 'vitest';
import { contextAround, countWords, extractLinks, extractTags, parseFrontmatter, parseNote, readable } from '../../src/core/markdown/parse';

describe('parseFrontmatter', () => {
  it('reads scalars, inline arrays and block lists', () => {
    const { data, body, offset } = parseFrontmatter('---\ntitle: "Hello"\ntags: [a, b]\naliases:\n  - One\n  - Two\n---\nBody');
    expect(data).toEqual({ title: 'Hello', tags: ['a', 'b'], aliases: ['One', 'Two'] });
    expect(body).toBe('Body');
    expect(offset).toBeGreaterThan(0);
  });
  it('accepts CJK keys and a BOM, and leaves notes without front matter alone', () => {
    expect(parseFrontmatter('﻿---\n日期: 2024-01-02\n---\nx').data).toEqual({ 日期: '2024-01-02' });
    expect(parseFrontmatter('# Title').offset).toBe(0);
  });
});

describe('extractLinks', () => {
  it('finds wiki links with alias, heading and embeds, plus relative markdown links', () => {
    const links = extractLinks('See [[A|alias]], [[B#Part]] and ![[pic.png]] and [doc](sub/C.md#x) and [web](https://x.y)');
    expect(links.map((l) => [l.kind, l.target, l.alias, l.subpath, l.embed])).toEqual([
      ['wiki', 'A', 'alias', null, false],
      ['wiki', 'B', null, 'Part', false],
      ['wiki', 'pic.png', null, null, true],
      ['md', 'sub/C.md', 'doc', 'x', false],
    ]);
  });
  it('ignores links inside code and same-note heading links', () => {
    expect(extractLinks('`[[no]]`\n```\n[[no2]]\n```\n[[#Heading]] [[yes]]').map((l) => l.target)).toEqual(['yes']);
  });
  it('records index and length so links can be rewritten in place', () => {
    const body = 'ab [[Target|x]] cd';
    const [l] = extractLinks(body);
    expect(body.slice(l!.index, l!.index + l!.length)).toBe('[[Target|x]]');
  });
});

describe('tags, words and previews', () => {
  it('collects front matter and inline tags but not headings or code', () => {
    expect(extractTags('# Heading\ntext #idea and #topic/sub `#code`', { tags: ['fm'] }).sort()).toEqual(['fm', 'idea', 'topic/sub'].sort());
  });
  it('counts each CJK character as a word', () => {
    expect(countWords('知识图谱 helps memory')).toBe(6);
  });
  it('parseNote uses the title from front matter, else the file name', () => {
    expect(parseNote('---\ntitle: T\n---\n# H1', 'file').title).toBe('T');
    expect(parseNote('# H1\ntext', 'file')).toMatchObject({ title: 'file', h1: 'H1' });
  });
  it('readable keeps link labels and drops syntax', () => {
    expect(readable('- **Bold** [[A|label]] and [[B]] `c`')).toBe('Bold label and B c');
  });
  it('contextAround stays on one line and marks cuts', () => {
    const s = 'first line\n' + 'x'.repeat(100) + ' needle ' + 'y'.repeat(100) + '\nlast';
    const ctx = contextAround(s, s.indexOf('needle'), 20);
    expect(ctx.startsWith('…') && ctx.endsWith('…') && ctx.includes('needle')).toBe(true);
    expect(ctx).not.toContain('first');
  });
});

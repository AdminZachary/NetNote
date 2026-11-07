import { describe, expect, it } from 'vitest';
import { blockPreview, joinBlocks, splitBlocks } from '../../src/core/markdown/blocks';

const NOTE = `---
created: 2026-03-02
---
# Sleep

Sleep clears the day.
It also files it.

- one
- two

\`\`\`js
const a = 1;

const b = 2;
\`\`\`

## Connections
- [[Memory]] — replay
`;

describe('note blocks', () => {
  const n = splitBlocks(NOTE);
  it('keeps front matter aside', () => expect(n.front).toBe('---\ncreated: 2026-03-02\n---\n'));
  it('splits paragraphs, headings, lists and keeps code blocks whole', () => {
    expect(n.blocks).toEqual([
      '# Sleep',
      'Sleep clears the day.\nIt also files it.',
      '- one\n- two',
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
      '## Connections\n- [[Memory]] — replay',
    ]);
  });
  it('joins back to the same note', () => expect(joinBlocks(n)).toBe(NOTE));
  it('editing one block changes only that block', () => {
    const blocks = [...n.blocks];
    blocks[1] = 'Sleep sorts the day.';
    const out = joinBlocks({ front: n.front, blocks });
    expect(out).toContain('# Sleep\n\nSleep sorts the day.\n\n- one');
    expect(out).toContain('const b = 2;');
  });
  it('empty blocks disappear on save', () => expect(joinBlocks({ front: '', blocks: ['a', '', '  ', 'b'] })).toBe('a\n\nb\n'));
  it('a heading right after text starts a new block', () => expect(splitBlocks('text\n# T').blocks).toEqual(['text', '# T']));
  it('previews on one line', () => expect(blockPreview('a\nb', 10)).toBe('a ⏎ b'));
});

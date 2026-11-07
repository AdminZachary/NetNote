/**
 * A note as a list of blocks (paragraphs, headings, lists, code), so it can be edited in the headset
 * one block at a time: pick a paragraph, change it, add one after it, or remove it. Front matter is
 * kept aside untouched. Joining the blocks again gives back the same Markdown for anything not edited.
 */

export interface NoteBlocks {
  /** front matter including its `---` fences and the newline after them, or '' */
  front: string;
  blocks: string[];
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s/;

export function splitBlocks(raw: string): NoteBlocks {
  const text = raw.replace(/\r\n?/g, '\n');
  let front = '';
  let body = text;
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text);
  if (fm) {
    front = fm[0];
    body = text.slice(front.length);
  }
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    if (cur.length) blocks.push(cur.join('\n').replace(/\s+$/, ''));
    cur = [];
  };
  for (const line of body.split('\n')) {
    if (fence) {
      cur.push(line);
      if (line.trim().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      flush();
      fence = f[1]!;
      cur.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // a heading after text without a blank line starts its own block; text right under a heading
    // stays with it (so the note joins back exactly as it was)
    if (HEADING.test(line) && cur.length) flush();
    cur.push(line);
  }
  flush();
  return { front, blocks: blocks.filter((b) => b.trim()) };
}

export function joinBlocks(n: NoteBlocks): string {
  const body = n.blocks.map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim());
  return n.front + (body.length ? body.join('\n\n') + '\n' : '');
}

/** One line to show a block in a list: headings keep their #, lists their first item. */
export function blockPreview(b: string, max = 120): string {
  const one = b.replace(/\s*\n\s*/g, ' ⏎ ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

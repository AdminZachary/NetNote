/**
 * A small, safe Markdown → HTML renderer for the 2D reading view: headings, paragraphs, lists,
 * quotes, code, emphasis, links and [[wiki links]]. Everything is escaped first, so a note can never
 * inject markup. Wiki links become buttons carrying the target, which the page resolves and opens.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string, resolves: (target: string) => boolean): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = s.replace(/!?\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, _h: string | undefined, alias: string | undefined) => {
    const t = target.trim();
    const cls = resolves(t) ? 'nn-wl' : 'nn-wl nn-ghost';
    return `<button type="button" class="${cls}" data-link="${t}">${alias ? alias.trim() : t}</button>`;
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1<span class="nn-tag">#$2</span>');
  return s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codes[Number(i)] ?? '');
}

export function markdownToHtml(raw: string, resolves: (target: string) => boolean = () => true): string {
  const body = raw.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = (): void => {
    if (para.length) out.push(`<p>${inline(para.join(' '), resolves)}</p>`);
    para = [];
  };
  const flushList = (): void => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const n = h[1]!.length;
      out.push(`<h${n}>${inline(h[2]!, resolves)}</h${n}>`);
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (li) {
      flushPara();
      const tag = li[1] ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      const box = li[3] !== undefined ? (li[3] === ' ' ? '☐ ' : '☑ ') : '';
      list.items.push(box + inline(li[4]!, resolves));
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''), resolves)}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/**
 * If the caret is inside an unfinished `[[…` link, the text typed so far after `[[` and where it
 * starts; otherwise null. Used to offer notes to link while typing.
 */
export function linkQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const typed = before.slice(open + 2);
  if (/[\]\n|]/.test(typed) || typed.length > 60) return null;
  return { query: typed, start: open };
}

/** Replace the unfinished link at `start..caret` with a complete `[[name]]`. */
export function completeLink(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^[^\]\n]*\]\]/, '');
  const ins = `[[${name}]]`;
  return { text: text.slice(0, start) + ins + after, caret: start + ins.length };
}

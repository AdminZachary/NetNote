/**
 * Text features for the insight engine: terms (latin words + CJK bigrams), TF-IDF vectors,
 * template-line removal and turning shared terms back into readable phrases.
 */

const STOP = new Set(
  (
    'the a an and or of to in on for with is are was were be been it this that these those as at by from not no but if then so than into about over can will just you your we our they their have has had do does did i me my he she his her them its which who what when where why how all any each more most other some such only own same too very also via use using used get got make made like one two new see note notes md http https www com would could should there here describe today generally kinds kind people think much many way time well really because important thing things ' +
    'let lets may might must shall still even ever every both either neither yet though although while upon onto out off up down again further once ' +
    'after before during without within between among through across against around under above below since until toward towards ' +
    'often always never sometimes usually later early first last next another others less few lot lots little enough quite rather almost ' +
    'seem seems seemed help helps helped work works worked happen happens happened know knows knew known go goes went gone come comes came ' +
    'take takes took give gives gave keep keeps kept put puts say says said tell tells told try tries tried need needs want wants find finds found ' +
    'start starts started feel feels felt look looks looked call called mean means meant show shows showed become becomes became leave leaves left ' +
    'different same linked link links related idea ideas way ways part parts kind something anything nothing everything someone thing ' +
    'what whats whether yes able back away far near hard easy good bad better worse best worst big small large long short high low ' +
    'day days night nights week weeks year years minute minutes hour hours people person'
  ).split(' '),
);
/** A bigram containing one of these is almost never a concept ("的线", "是在"). */
const CJK_FUNC = new Set([...'的了是在和与及或也就都而但把被让给对从向这那个们之其很更最再又还只并于以为着过吗呢吧啊么里']);
const CJK_STOP = new Set(
  '一个 一种 一些 一样 可以 进行 通过 没有 不是 自己 什么 已经 然后 以及 其中 关于 之间 如何 如果 因为 所以 时候 现在 需要 可能 支持 使用 比如 例如 这样 那样 非常 很多 东西 地方 开始 出来 起来 不同 一起 应该 能够 我们 你们 他们 它们 今天 昨天 明天 感觉 觉得 知道 看到 发现 就是 还是 或者 只是 不会 直接 方式 部分 任何 每个 所有 一下 一次 第一 包括 相关 简单 问题 参考 核心 内容 记录 下次 希望 笔记 这里 那里 其实 当然 目前 之后 最后'.split(
    ' ',
  ),
);

export const CJK_RUN = /[㐀-䶿一-鿿]+/g;
const FRONT = /^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function withoutFrontmatter(s: string): string {
  return s.replace(FRONT, '');
}

/** Terms of a text: latin words + CJK character bigrams (good enough for Chinese without a dictionary). */
export function terms(text: string): string[] {
  const clean = withoutFrontmatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, ' $1 $2 ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase();
  const out: string[] = [];
  for (const raw of clean.replace(CJK_RUN, ' ').match(/[a-z][a-z0-9-]{1,30}/g) ?? []) {
    if (STOP.has(raw)) continue;
    const w = stem(raw);
    if (w.length > 2 && !STOP.has(w)) out.push(w);
  }
  for (const run of clean.match(CJK_RUN) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!CJK_FUNC.has(bg[0]!) && !CJK_FUNC.has(bg[1]!) && !CJK_STOP.has(bg)) out.push(bg);
    }
  }
  return out;
}

/** A light English stemmer: plurals and the commonest suffixes, so "memories" meets "memory". */
export function stem(w: string): string {
  if (w.length <= 4 || /[^a-z]/.test(w)) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export interface Doc {
  path: string;
  name: string;
  title: string;
  content: string;
  aliases: string[];
  tags: string[];
}

/**
 * Lines a template stamps into many notes ("Back to [[Home]]", "Exam: [[…]] · [[…]]") say nothing about
 * what a note is about. A line whose shape (links and numbers blanked out) repeats in several notes is
 * dropped from the text we analyse; its links still count in the graph.
 */
export function withoutTemplates<T extends Doc>(docs: T[]): T[] {
  const shape = (line: string): string =>
    line
      .replace(/!?\[\[[^\]]*\]\]/g, '◇')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  const count = new Map<string, number>();
  for (const d of docs)
    for (const sh of new Set(withoutFrontmatter(d.content).split('\n').map(shape))) if (sh.length > 3) count.set(sh, (count.get(sh) ?? 0) + 1);
  const min = Math.max(3, Math.ceil(docs.length * 0.02));
  return docs.map((d) => ({
    ...d,
    content: withoutFrontmatter(d.content)
      .split('\n')
      .filter((l) => (count.get(shape(l)) ?? 0) < min)
      .join('\n'),
  }));
}

export type Vector = Map<string, number>;

/** Unit-length TF-IDF vectors, top 40 terms per document. */
export function tfidf(docs: Doc[]): Map<string, Vector> {
  const df = new Map<string, number>();
  const tfs = new Map<string, Map<string, number>>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of terms(d.title + '\n' + withoutFrontmatter(d.content))) tf.set(t, (tf.get(t) ?? 0) + 1);
    tfs.set(d.path, tf);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const vecs = new Map<string, Vector>();
  for (const [p, tf] of tfs) {
    const weighted: [string, number][] = [];
    let norm = 0;
    for (const [t, c] of tf) {
      const d = df.get(t) ?? 0;
      if (d < 2 || d > N * 0.5) continue; // unique words can't connect notes; ubiquitous words don't discriminate
      const w = (1 + Math.log(c)) * Math.log(N / d);
      weighted.push([t, w]);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    const top = weighted
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([t, w]): [string, number] => [t, w / norm]);
    vecs.set(p, new Map(top));
  }
  return vecs;
}

/**
 * Turn shared terms back into readable phrases: CJK bigrams that follow each other in the text are
 * merged ("记忆"+"忆宫"+"宫殿" → "记忆宫殿"), latin words kept as-is. Ranked by combined weight.
 */
export function sharedPhrases(text: string, common: string[], weight: (t: string) => number): string[] {
  const set = new Set(common);
  const scored = new Map<string, number>();
  const lower = text.toLowerCase();
  for (const run of lower.match(CJK_RUN) ?? []) {
    let i = 0;
    while (i < run.length - 1) {
      if (!set.has(run.slice(i, i + 2))) {
        i++;
        continue;
      }
      let j = i;
      let w = 0;
      while (j < run.length - 1 && set.has(run.slice(j, j + 2))) {
        w += weight(run.slice(j, j + 2));
        j++;
      }
      const phrase = run.slice(i, j + 1);
      if (phrase.length <= 8) scored.set(phrase, Math.max(scored.get(phrase) ?? 0, w));
      i = j + 1;
    }
  }
  for (const t of common) if (/^[a-z]/.test(t)) scored.set(t, weight(t));
  const list = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return list.filter((p, i) => !list.slice(0, i).some((q) => q.includes(p)));
}

/** Words the user wrote down as concepts: note names, aliases, tags, headings, bold text. */
export function vocabulary(docs: Doc[], extraNames: string[] = []): string[] {
  const v = new Set<string>();
  const add = (x: string | undefined): void => {
    const s = String(x ?? '').trim();
    if (s.length >= 2 && s.length <= 14) v.add(s);
  };
  for (const n of extraNames) add(n.replace(/\.[a-z0-9]{2,5}$/i, ''));
  for (const d of docs) {
    add(d.name);
    d.aliases.forEach(add);
    d.tags.forEach((t) => add(t.split('/').pop()));
    for (const m of d.content.matchAll(/^#{1,6}\s+(.+)$/gm)) add(m[1]);
    for (const m of d.content.matchAll(/\*\*([^*\n]{2,14})\*\*/g)) add(m[1]);
  }
  return [...v];
}

const CJK2 = /^[㐀-䶿一-鿿]{2}$/;
const CJK7 = /^[㐀-䶿一-鿿]{7,}$/;

/**
 * Bigram phrases can be cut mid-word ("卡片盒笔" from 卡片盒笔记). Snap each to the shortest concept the
 * user actually wrote that contains it; an unsnapped long CJK fragment falls back to its strongest bigram.
 */
export function snap(phrases: string[], vocab: string[], weight: (t: string) => number): string[] {
  const out: string[] = [];
  for (const p of phrases) {
    const lowerP = p.toLowerCase();
    const hit = vocab.filter((w) => w.toLowerCase().includes(lowerP)).sort((a, b) => a.length - b.length)[0];
    let q = hit ?? p;
    if (!hit && CJK2.test(p) && !vocab.some((w) => w.includes(p))) continue; // "年出" from 年出现 is noise
    if (!hit && CJK7.test(p)) {
      let best = p.slice(0, 2);
      for (let i = 0; i < p.length - 1; i++) if (weight(p.slice(i, i + 2)) > weight(best)) best = p.slice(i, i + 2);
      q = best;
    }
    if (!out.some((o) => o.includes(q) || q.includes(o))) out.push(q);
  }
  return out;
}

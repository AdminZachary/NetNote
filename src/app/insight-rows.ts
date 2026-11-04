/**
 * Turns the insight engine's findings into rows a person can act on, one question per row:
 * "what should I connect / think about next?" Each row lights something up on the graph and offers
 * one action. Pure (no DOM, no 3D) so the 2D and the spatial UI share it and it is unit-tested.
 */
import type { Insights } from '../core/insights/engine';
import { gapQuestion, reasonText, t } from './i18n';

export type InsightTab = 'links' | 'questions' | 'topics' | 'wanted' | 'drifting';
export const INSIGHT_TABS: InsightTab[] = ['links', 'questions', 'topics', 'wanted', 'drifting'];

export type RowAction = 'link' | 'write' | 'dismiss' | 'open';

export interface InsightRow {
  key: string;
  title: string;
  sub: string;
  /** notes to light up when the row is chosen */
  ids: string[];
  /** the note to open when the row itself is pinched */
  open: string | null;
  actions: { id: RowAction; label: string }[];
  /** the pair for "link", the note title + body for "write" */
  pair?: [string, string];
  draft?: { title: string; body: string };
}

export interface RowContext {
  name: (id: string) => string;
  linked: (a: string, b: string) => boolean;
  exists: (id: string) => boolean;
  dismissed: ReadonlySet<string>;
}

export const pairKey = (a: string, b: string): string => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

export function insightRows(ins: Insights, tab: InsightTab, ctx: RowContext): InsightRow[] {
  const tr = t();
  const { name } = ctx;
  switch (tab) {
    case 'links':
      return ins.suggestions
        .filter((s) => !ctx.dismissed.has(pairKey(s.a, s.b)) && !ctx.linked(s.a, s.b) && ctx.exists(s.a) && ctx.exists(s.b))
        .map((s) => ({
          key: 'l:' + pairKey(s.a, s.b),
          title: `${name(s.a)}  ↔  ${name(s.b)}`,
          sub: reasonText(s, name),
          ids: [s.a, s.b, ...s.shared.filter(ctx.exists)],
          open: s.a,
          pair: [s.a, s.b],
          actions: [
            { id: 'link', label: tr.connectIt },
            { id: 'dismiss', label: '✕' },
          ],
        }));
    case 'questions':
      return ins.gaps.map((g) => {
        const members = (hub: string): string[] => ins.topics.find((x) => x.hub === hub)?.members ?? [hub];
        const q = gapQuestion(g);
        return {
          key: 'g:' + pairKey(g.aHub, g.bHub),
          title: tr.between(g.a, g.b),
          sub: q,
          ids: [...members(g.aHub), ...members(g.bHub)],
          open: null,
          draft: { title: tr.between(g.a, g.b), body: `${tr.relatedLine}: [[${name(g.aHub)}]] · [[${name(g.bHub)}]]\n\n> ${q}\n` },
          actions: [{ id: 'write', label: tr.writeIdea }],
        };
      });
    case 'topics': {
      const bridges: InsightRow[] = ins.bridges.slice(0, 6).map((b) => ({
        key: 'b:' + b.id,
        title: '◆ ' + name(b.id),
        sub: `${tr.bridgeOf(b.topics.length)}: ${b.topics.join(' · ')}`,
        ids: [b.id],
        open: b.id,
        actions: [{ id: 'open', label: tr.open }],
      }));
      const topics: InsightRow[] = ins.topics.map((x) => ({
        key: 't:' + x.id,
        title: x.name,
        sub: `${tr.topicSize(x.size)}${x.keywords.length ? ' · ' + x.keywords.slice(0, 4).join(' · ') : ''}`,
        ids: x.members,
        open: x.hub,
        actions: [{ id: 'open', label: tr.open }],
      }));
      return [...topics, ...bridges];
    }
    case 'wanted':
      return ins.wanted.map((w) => ({
        key: 'w:' + w.id,
        title: w.name,
        sub: tr.refs(w.refs) + ': ' + w.from.slice(0, 3).map(name).join(' · '),
        ids: w.from,
        open: null,
        draft: { title: w.name, body: '' },
        actions: [{ id: 'write', label: tr.writeIdea }],
      }));
    case 'drifting':
      return ins.drifting.map((d) => ({
        key: 'd:' + d.ids.join('|'),
        title: d.kind === 'orphan' ? name(d.ids[0]!) : tr.islandOf(d.ids.length) + ': ' + d.ids.slice(0, 3).map(name).join(' · '),
        sub: d.anchor ? tr.closestTo(name(d.anchor)) : '',
        ids: d.anchor ? [...d.ids, d.anchor] : d.ids,
        open: d.ids[0] ?? null,
        pair: d.anchor ? [d.ids[0]!, d.anchor] : undefined,
        actions: d.anchor ? [{ id: 'link' as const, label: tr.connectIt }] : [],
      }));
  }
}

export function tabLabel(tab: InsightTab): string {
  const tr = t();
  return { links: tr.tabLinks, questions: tr.tabQuestions, topics: tr.tabTopics, wanted: tr.tabWanted, drifting: tr.tabDrifting }[tab];
}

export function tabHint(tab: InsightTab): string {
  const tr = t();
  return { links: tr.hintLinks, questions: tr.hintQuestions, topics: tr.hintTopics, wanted: tr.hintWanted, drifting: tr.hintDrifting }[tab];
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { INSIGHT_TABS, insightRows, pairKey, type RowContext } from '../../src/app/insight-rows';
import { computeInsights } from '../../src/core/insights/engine';
import { Vault } from '../../src/core/vault/vault';

const dir = join(__dirname, '../../sample-vault');
const vault = Vault.from(
  'Sample',
  readdirSync(dir).map((f) => ({ path: f, content: readFileSync(join(dir, f), 'utf8'), mtime: 1 })),
);
const ins = computeInsights(vault);
const g = vault.graph();
const nb = new Map<string, Set<string>>();
for (const l of g.links) {
  (nb.get(l.source) ?? nb.set(l.source, new Set()).get(l.source)!).add(l.target);
  (nb.get(l.target) ?? nb.set(l.target, new Set()).get(l.target)!).add(l.source);
}
const ctx = (dismissed = new Set<string>()): RowContext => ({
  name: (id) => vault.notes.get(id)?.name ?? id,
  linked: (a, b) => !!nb.get(a)?.has(b),
  exists: (id) => vault.notes.has(id),
  dismissed,
});

describe('insight rows', () => {
  setLocale('en');

  it('every tab of the sample library has something to act on', () => {
    for (const tab of INSIGHT_TABS) expect(insightRows(ins, tab, ctx()).length, tab).toBeGreaterThan(0);
  });

  it('hidden links offer to connect the pair and can be dismissed', () => {
    const rows = insightRows(ins, 'links', ctx());
    const first = rows[0]!;
    expect(first.pair).toHaveLength(2);
    expect(first.actions.map((a) => a.id)).toEqual(['link', 'dismiss']);
    expect(first.sub.length).toBeGreaterThan(5);
    const after = insightRows(ins, 'links', ctx(new Set([pairKey(first.pair![1], first.pair![0])])));
    expect(after.find((r) => r.key === first.key)).toBeUndefined();
    expect(after).toHaveLength(rows.length - 1);
  });

  it('questions come with a draft that links both topics', () => {
    const q = insightRows(ins, 'questions', ctx())[0]!;
    expect(q.draft?.body).toMatch(/\[\[.+\]\] · \[\[.+\]\]/);
    expect(q.ids.length).toBeGreaterThan(2);
  });

  it('unwritten notes can be written, drifting ones connected to their closest note', () => {
    const w = insightRows(ins, 'wanted', ctx());
    expect(w.map((r) => r.title)).toContain('Linking your thinking');
    const d = insightRows(ins, 'drifting', ctx()).find((r) => r.open === 'Caffeine.md')!;
    expect(d.pair?.[0]).toBe('Caffeine.md');
    expect(d.actions[0]?.id).toBe('link');
  });

  it('speaks Chinese too', () => {
    setLocale('zh');
    const d = insightRows(ins, 'drifting', ctx()).find((r) => r.open === 'Caffeine.md')!;
    expect(d.sub).toMatch(/最接近/);
    setLocale('en');
  });
});

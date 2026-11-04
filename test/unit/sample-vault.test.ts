import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clusterInfo } from '../../src/core/insights/cluster';
import { computeInsights } from '../../src/core/insights/engine';
import { Vault } from '../../src/core/vault/vault';

const dir = join(__dirname, '../../sample-vault');
const vault = Vault.from(
  'Sample',
  readdirSync(dir).map((f) => ({ path: f, content: readFileSync(join(dir, f), 'utf8'), mtime: 1 })),
);
const ins = computeInsights(vault);

describe('bundled sample library', () => {
  it('shows every kind of insight so a first visit has something to discover', () => {
    expect(ins.topics.length).toBeGreaterThanOrEqual(3);
    expect(ins.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(ins.bridges.length).toBeGreaterThanOrEqual(1);
    expect(ins.wanted.map((w) => w.name)).toContain('Linking your thinking');
    expect(ins.drifting.map((d) => d.ids[0])).toEqual(expect.arrayContaining(['Caffeine.md', 'Walking.md']));
  });
  it('the wall question for sleep notes is meaningful', () => {
    const info = clusterInfo(ins, ['Slow-wave sleep.md', 'REM sleep.md', 'Sleep deprivation.md']);
    expect(info.question).not.toBeNull();
  });
  it('prints a summary', () => {
    console.log(
      JSON.stringify(
        {
          topics: ins.topics.map((t) => `${t.name} (${t.size}): ${t.keywords.join(', ')}`),
          suggestions: ins.suggestions.slice(0, 8).map((s) => `${s.a} ~ ${s.b} [${s.terms.join(', ')}] via ${s.shared.join(', ')}`),
          bridges: ins.bridges.map((b) => `${b.id}: ${b.topics.join(' / ')}`),
          gaps: ins.gaps.map((g) => `${g.a} | ${g.b}: ${g.links} [${g.terms.join(', ')}]`),
          drifting: ins.drifting.map((d) => `${d.ids.join(',')} -> ${d.anchor}`),
        },
        null,
        1,
      ),
    );
  });
});

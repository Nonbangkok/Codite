import { describe, expect, test } from 'vitest';
import fixture from './fixtures/graph.json';
import type { GraphData } from '../src/types';
import { computeInsights, findCycles, insightsToMarkdown } from '../src/utils/insights';

const base = fixture as GraphData;
const clean: GraphData = {
  nodes: base.nodes.filter((n) => n.group !== 'imports'),
  links: base.links.filter((l) => !String(l.target).includes('::import::')),
};

describe('findCycles', () => {
  test('finds loops of any length and self-loops, not plain chains', () => {
    const edges = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a', 'd']],
      ['d', []],
      ['e', ['e']],
      ['f', ['g']],
    ]);
    expect(findCycles(['a', 'b', 'c', 'd', 'e', 'f', 'g'], edges)).toEqual([['a', 'b', 'c'], ['e']]);
  });
  test('handles long chains without recursion limits', () => {
    const n = 20000;
    const edges = new Map(Array.from({ length: n }, (_, i) => [`n${i}`, [`n${(i + 1) % n}`]] as [string, string[]]));
    const cycles = findCycles([...edges.keys()], edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(n);
  });
});

describe('computeInsights', () => {
  const insights = computeInsights(clean);
  test('totals and language breakdown', () => {
    expect(insights.totals).toMatchObject({ files: 4, symbols: 5, languages: 2 });
    expect(insights.languages.map((l) => [l.label, l.files])).toEqual([
      ['TypeScript', 3],
      ['Rust', 1],
    ]);
  });
  test('rankings', () => {
    expect(insights.largestFiles[0].label).toBe('util.ts');
    expect(insights.mostImported.map((r) => r.label).sort()).toEqual(['math.ts', 'util.ts']);
    expect(insights.mostDependencies.map((r) => r.value)).toEqual([1, 1]);
  });
  test('no cycles in the fixture; orphans skip entry points', () => {
    const cycles = insights.checks.find((c) => c.id === 'cycles')!;
    expect(cycles.items).toEqual([]);
    const orphans = insights.checks.find((c) => c.id === 'orphans')!;
    // app.ts is an entry point by name; core.rs is imported by nobody.
    expect(orphans.items.map((i) => i.detail)).toEqual(['native/core.rs']);
  });
  test('detects an import cycle between files', () => {
    const cyclic: GraphData = { ...clean, links: [...clean.links, { source: 'demo/lib/math.ts', target: 'demo/src/util.ts', type: 'imports_module' }] };
    const cycles = computeInsights(cyclic).checks.find((c) => c.id === 'cycles')!;
    expect(cycles.severity).toBe('high');
    expect(cycles.items[0].detail).toBe('math.ts → util.ts → math.ts');
  });
  test('flags long, deep and complex functions', () => {
    const body = ['fn big() {', ...Array.from({ length: 90 }, (_, i) => `    if a${i} && b { x(); }`), '}'].join('\n');
    const g: GraphData = {
      nodes: [...clean.nodes, { id: 'demo/src/big.rs::fn::big::0', label: 'big', group: 'functions', language: 'rust', val: 8, code: body }],
      links: clean.links,
    };
    const checks = computeInsights(g).checks;
    expect(checks.find((c) => c.id === 'long')!.items[0].detail).toBe('big: 92 lines, in src/big.rs');
    expect(checks.find((c) => c.id === 'complex')!.items[0].detail).toMatch(/^big: complexity 181/);
  });
});

describe('insightsToMarkdown', () => {
  test('renders a readable report', () => {
    const md = insightsToMarkdown(computeInsights(clean), 'owner/demo', new Date('2026-11-23'));
    expect(md).toContain('# Codite report: owner/demo');
    expect(md).toContain('Generated 2026-11-23.');
    expect(md).toContain('- 4 files, 5 symbols');
    expect(md).toContain('### ✅ Import cycles (0)');
    expect(md).toContain('| 1 | util.ts | src/util.ts | 7 lines |');
  });
});

import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import type { GraphData, NodeData } from '../src/types';
import { structureLayout, structureLinks, structuralParent } from '../src/utils/structureLayout';
import { countCrossings } from '../src/utils/crossings';
import { buildFolderNodes } from '../src/utils/treeUtils';
import fixture from './fixtures/graph.json';

const crossingsOf = (nodes: NodeData[]) => {
  const pos = structureLayout(nodes);
  const links = structureLinks(nodes);
  const ids = nodes.map((n) => n.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  return countCrossings(
    ids.map((id) => ({ x: pos.get(id)![0], y: pos.get(id)![1] })),
    links.map((l) => [idx.get(l.source as string)!, idx.get(l.target as string)!] as [number, number]),
  );
};

const withFolders = (g: GraphData) => {
  const files = g.nodes.filter((n) => !n.id.includes('::'));
  return [...g.nodes, ...buildFolderNodes(files).nodes];
};

describe('structure view', () => {
  test('parents follow folders, files and symbols', () => {
    expect(structuralParent('r/src/a.ts::fn::f::1')).toBe('r/src/a.ts');
    expect(structuralParent('r/src/a.ts')).toBe('r/src');
    expect(structuralParent('r')).toBe('');
  });

  test('links attach to the nearest shown ancestor', () => {
    const nodes = ['r', 'r/src/a.ts', 'r/src/a.ts::fn::f::1'].map((id) => ({ id, label: id, group: '', language: '', val: 1 }));
    expect(structureLinks(nodes)).toEqual([
      { source: 'r', target: 'r/src/a.ts', type: 'contains' },
      { source: 'r/src/a.ts', target: 'r/src/a.ts::fn::f::1', type: 'contains' },
    ]);
  });

  test('the fixture project draws with zero crossings and no overlaps', () => {
    const nodes = withFolders(fixture as GraphData).filter((n) => n.group !== 'imports');
    expect(crossingsOf(nodes)).toBe(0);
    const pts = [...structureLayout(nodes).values()];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(5);
  });

  // Real repositories analysed during development (skipped when the files are not around).
  for (const repo of ['cobra', 'zustand', 'cJSON', 'click', 'ripgrep', 'zod']) {
    const file = `/private/tmp/claude-501/datasets/${repo}.json`;
    test.skipIf(!existsSync(file))(`${repo}: zero crossings in the structure view`, () => {
      const g = JSON.parse(readFileSync(file, 'utf8')) as GraphData;
      g.nodes = g.nodes.filter((n) => n.group !== 'imports');
      expect(crossingsOf(withFolders(g))).toBe(0);
    });
  }
});

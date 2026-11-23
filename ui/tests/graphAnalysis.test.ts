import { describe, expect, test } from 'vitest';
import fixture from './fixtures/graph.json';
import type { GraphData } from '../src/types';
import { buildGraphIndex } from '../src/utils/graphIndex';
import {
  applyLayout,
  collapseFolders,
  computeMetrics,
  folderAtDepth,
  folderGroups,
  groupDepth,
  impactOf,
  rankScale,
} from '../src/utils/graphAnalysis';

const graph: GraphData = { nodes: (fixture as GraphData).nodes.filter((n) => n.group !== 'imports'), links: (fixture as GraphData).links.filter((l) => !String(l.target).includes('::import::')) };
const ADD = 'demo/lib/math.ts::fn::add::0';

describe('metrics', () => {
  test('lines, connections and complexity per node', () => {
    const m = computeMetrics(graph.nodes, buildGraphIndex(graph));
    expect(m.get('demo/src/util.ts')).toMatchObject({ lines: 7, connections: 4 });
    expect(m.get(ADD)!.lines).toBe(3);
  });
  test('rank scale spreads values evenly and shares ties', () => {
    const s = rankScale(new Map([['a', 1], ['b', 1000], ['c', 5], ['d', 5]]));
    expect([s.get('a'), s.get('c'), s.get('d'), s.get('b')]).toEqual([0, 0.5, 0.5, 1]);
    expect(rankScale(new Map([['x', 3]])).get('x')).toBe(0);
  });
});

describe('folder groups', () => {
  test('folder at depth and adaptive group depth', () => {
    expect(folderAtDepth('demo/src/util.ts::fn::helper::36', 2)).toBe('demo/src');
    expect(folderAtDepth('demo/a.ts', 3)).toBe('demo');
    expect(groupDepth(graph.nodes)).toBe(2);
    expect(groupDepth([{ id: 'r/src/a/x.ts', label: '', group: '', language: '', val: 1 }, { id: 'r/src/b/y.ts', label: '', group: '', language: '', val: 1 }])).toBe(3);
  });
  test('groups count nodes, largest first', () => {
    expect(folderGroups(graph.nodes, 2).map((g) => [g.label, g.count])).toEqual([
      ['src', 5],
      ['lib', 2],
      ['native', 2],
    ]);
  });
  test('collapsing a folder replaces its nodes and redirects links', () => {
    const out = collapseFolders(graph, new Set(['demo/src']));
    const folder = out.nodes.find((n) => n.id === 'demo/src')!;
    expect(folder.collapsedCount).toBe(5);
    expect(out.nodes.some((n) => n.id.startsWith('demo/src/'))).toBe(false);
    expect(out.links).toContainEqual({ source: 'demo/src', target: 'demo/lib/math.ts', type: 'imports_module' });
    // Links inside the folder vanish; nothing is duplicated.
    expect(out.links.filter((l) => l.source === 'demo/src')).toHaveLength(1);
    expect(collapseFolders(graph, new Set())).toBe(graph);
    // The same collapsed node object is reused so it keeps its position.
    expect(collapseFolders(graph, new Set(['demo/src'])).nodes.find((n) => n.id === 'demo/src')).toBe(folder);
  });
});

describe('impact', () => {
  test('follows dependency links backwards and includes the symbol’s file', () => {
    const impact = impactOf(graph, ADD);
    expect(Object.fromEntries(impact.depth)).toEqual({
      [ADD]: 0,
      'demo/lib/math.ts': 0,
      'demo/src/util.ts': 1,
      'demo/src/app.ts': 2,
    });
    expect(impact.maxDepth).toBe(2);
    expect(impactOf(graph, ADD, 1).depth.has('demo/src/app.ts')).toBe(false);
  });
  test('nothing depends on an unused node', () => {
    expect(impactOf(graph, 'demo/native/core.rs').depth.size).toBe(1);
  });
});

describe('layout', () => {
  test('applies pinned and saved positions', () => {
    const nodes = [{ id: 'a', label: '', group: '', language: '', val: 1 }, { id: 'b', label: '', group: '', language: '', val: 1 }];
    applyLayout(nodes, { pinned: { a: [1, 2] }, positions: { b: [5, 6] } });
    expect(nodes[0]).toMatchObject({ x: 1, y: 2, fx: 1, fy: 2 });
    expect(nodes[1]).toMatchObject({ x: 5, y: 6 });
    expect(nodes[1].fx).toBeUndefined();
  });
});

describe('root folder', () => {
  test('the project root is not offered as a collapsible group', () => {
    const flat = [
      { id: 'proj/a.js', label: 'a', group: 'proj', language: 'javascript', val: 1 },
      { id: 'proj/b.js', label: 'b', group: 'proj', language: 'javascript', val: 1 },
    ];
    expect(folderGroups(flat, 2)).toEqual([]);
  });
});

describe('new nodes start in place', () => {
  test('a collapsed folder starts at the centre of what it replaces', () => {
    const placed: GraphData = {
      nodes: [
        { id: 'r/f/a.ts', label: 'a', group: 'f', language: 'ts', val: 1, x: 100, y: 0 },
        { id: 'r/f/b.ts', label: 'b', group: 'f', language: 'ts', val: 1, x: 300, y: 40 },
        { id: 'r/g/c.ts', label: 'c', group: 'g', language: 'ts', val: 1, x: -50, y: -50 },
      ],
      links: [],
    };
    const folder = collapseFolders(placed, new Set(['r/f'])).nodes.find((n) => n.id === 'r/f')!;
    expect([folder.x, folder.y]).toEqual([200, 20]);
  });
  test('folder nodes start at the centre of their files', async () => {
    const { buildFolderNodes } = await import('../src/utils/treeUtils');
    const { nodes } = buildFolderNodes([
      { id: 'r/src/a.ts', label: 'a', group: 'src', language: 'ts', val: 1, x: 0, y: 0 },
      { id: 'r/src/b.ts', label: 'b', group: 'src', language: 'ts', val: 1, x: 10, y: 20 },
    ]);
    expect(nodes.find((n) => n.id === 'r/src')).toMatchObject({ x: 5, y: 10 });
  });
});

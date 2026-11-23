import { describe, expect, test } from 'vitest';
import fixture from './fixtures/graph.json';
import type { GraphData } from '../src/types';
import { buildGraphIndex, isInFolder, linkKey, neighborhood, shortestPath, subgraph } from '../src/utils/graphIndex';

const graph = fixture as GraphData;
const MAIN = 'demo/src/app.ts::fn::main::34';
const ADD = 'demo/lib/math.ts::fn::add::0';
const ENGINE = 'demo/native/core.rs::struct::Engine';

describe('buildGraphIndex', () => {
  test('indexes outgoing and incoming edges', () => {
    const index = buildGraphIndex(graph);
    expect(index.out.get('demo/src/app.ts')!.map((e) => e.id)).toContain('demo/src/util.ts');
    expect(index.in.get('demo/src/util.ts')!.map((e) => e.id)).toEqual(['demo/src/app.ts']);
  });

  test('ignores links whose ends are missing', () => {
    const index = buildGraphIndex({ nodes: graph.nodes.slice(0, 1), links: graph.links });
    expect(index.out.get('demo/src/app.ts')).toEqual([]);
  });

  test('handles links already resolved to node objects by the simulation', () => {
    const [a, b] = graph.nodes;
    const index = buildGraphIndex({ nodes: [a, b], links: [{ source: a, target: b, type: 'contains' }] });
    expect(index.out.get(a.id)![0].id).toBe(b.id);
    expect(linkKey({ source: a, target: b, type: 'contains' })).toBe(`${a.id}->${b.id}:contains`);
  });
});

describe('neighborhood', () => {
  const index = buildGraphIndex(graph);
  test('depth 1 includes direct neighbors in both directions', () => {
    expect([...neighborhood(index, 'demo/src/util.ts', 1)].sort()).toEqual(
      ['demo/lib/math.ts', 'demo/src/app.ts', 'demo/src/util.ts', 'demo/src/util.ts::class::Store', 'demo/src/util.ts::fn::helper::36'].sort(),
    );
  });
  test('depth grows the set and unknown ids give an empty set', () => {
    expect(neighborhood(index, MAIN, 3).has('demo/lib/math.ts')).toBe(true);
    expect(neighborhood(index, 'nope', 2).size).toBe(0);
  });
});

describe('shortestPath', () => {
  const index = buildGraphIndex(graph);
  test('finds the shortest undirected route with its links', () => {
    const path = shortestPath(index, MAIN, ADD)!;
    expect(path.nodeIds).toEqual([MAIN, 'demo/src/app.ts', 'demo/src/util.ts', 'demo/lib/math.ts', ADD]);
    expect(path.linkKeys.size).toBe(4);
    expect(path.linkKeys.has('demo/src/app.ts->demo/src/util.ts:imports_module')).toBe(true);
  });
  test('returns null for disconnected nodes and a single step for the same node', () => {
    expect(shortestPath(index, MAIN, ENGINE)).toBeNull();
    expect(shortestPath(index, MAIN, MAIN)!.nodeIds).toEqual([MAIN]);
  });
});

describe('subgraph and isInFolder', () => {
  test('keeps nodes and only links between kept nodes', () => {
    const sub = subgraph(graph, (id) => isInFolder(id, 'demo/src'));
    expect(sub.nodes.every((n) => n.id.startsWith('demo/src/'))).toBe(true);
    expect(sub.links.some((l) => l.target === 'demo/lib/math.ts')).toBe(false);
  });
  test('does not treat a sibling folder with the same prefix as inside', () => {
    expect(isInFolder('demo/src2/a.ts', 'demo/src')).toBe(false);
    expect(isInFolder('demo/src/a.ts', 'demo/src')).toBe(true);
    expect(isInFolder('demo/src', 'demo/src')).toBe(true);
  });
});

describe('parallelLinkCurvature', () => {
  test('bends links that share endpoints apart and leaves single links straight', async () => {
    const { parallelLinkCurvature } = await import('../src/utils/graphIndex');
    const contains = { source: 'f', target: 'g', type: 'contains' };
    const calls = { source: 'f', target: 'g', type: 'calls' };
    const back = { source: 'g', target: 'f', type: 'calls' };
    const single = { source: 'a', target: 'b', type: 'imports' };
    const c = parallelLinkCurvature([contains, calls, back, single]);
    expect(c.has(single)).toBe(false);
    const values = [c.get(contains)!, c.get(calls)!, -c.get(back)!]; // back is reversed
    expect(new Set(values.map((v) => v.toFixed(3))).size).toBe(3); // three distinct paths
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(0); // spread around the straight line
  });
  test('two links in opposite directions get opposite curvature in the shared frame', async () => {
    const { parallelLinkCurvature } = await import('../src/utils/graphIndex');
    const ab = { source: 'a', target: 'b', type: 'calls' };
    const ba = { source: 'b', target: 'a', type: 'calls' };
    const c = parallelLinkCurvature([ab, ba]);
    expect(c.get(ab)).toBeCloseTo(-0.15);
    expect(c.get(ba)).toBeCloseTo(-0.15); // same value, but relative to its own (reversed) direction
  });
});

describe('rebindLinks', () => {
  test('rebinds links whose endpoint object was replaced by a new node with the same id', async () => {
    const { rebindLinks } = await import('../src/utils/graphIndex');
    const parent = { id: 'r', label: 'r', group: 'folders', language: '', val: 4 };
    const oldFolder = { id: 'r/src', label: 'src', group: 'folders', language: '', val: 4 };
    const collapsed = { id: 'r/src', label: 'src (5)', group: 'folders', language: '', val: 12, collapsedCount: 5 };
    const kept = { source: parent, target: collapsed, type: 'contains' };
    const stale = { source: parent, target: oldFolder, type: 'contains' };
    const g = rebindLinks({ nodes: [parent, collapsed], links: [kept, stale] });
    expect(g.links[0]).toBe(kept);
    expect(g.links[1]).toEqual({ source: 'r', target: 'r/src', type: 'contains' });
    const clean = { nodes: [parent, collapsed], links: [kept] };
    expect(rebindLinks(clean)).toBe(clean);
  });
});

import { describe, expect, test } from 'vitest';
import fixture from './fixtures/graph.json';
import type { GraphData, NodeData } from '../src/types';
import { countBy, fileIdOf, isSymbolId, languageLabel, nodeKind } from '../src/utils/nodeKinds';
import { githubUrl, repoRelativePath, symbolStartLine } from '../src/utils/sourceLocation';
import { loadRecentScans, readRepoParam, rememberScan, withRepoParam } from '../src/utils/share';
import { graphToJson, graphToSvg, safeFilename } from '../src/utils/exportGraph';

const graph = fixture as GraphData;
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const node = (id: string) => byId.get(id)!;

describe('nodeKind', () => {
  test('files carry their folder in group, so they map to "files"', () => {
    expect(nodeKind(node('demo/src/app.ts'))).toBe('files');
    expect(nodeKind(node('demo/src/util.ts::class::Store'))).toBe('classes');
    expect(nodeKind({ group: 'folders' })).toBe('folders');
  });
  test('countBy orders kinds canonically and languages by frequency', () => {
    expect(countBy(graph.nodes, 'kind').map((c) => c.key)).toEqual(['files', 'functions', 'classes', 'structs', 'imports']);
    expect(countBy(graph.nodes, 'language')[0]).toEqual({ key: 'typescript', count: 8 });
  });
  test('id helpers and labels', () => {
    expect(isSymbolId('a/b.ts::fn::x::1')).toBe(true);
    expect(fileIdOf('a/b.ts::fn::x::1')).toBe('a/b.ts');
    expect(languageLabel('cpp')).toBe('C++');
    expect(languageLabel('zig')).toBe('Zig');
  });
});

describe('source locations', () => {
  test('finds the line of a symbol inside its file', () => {
    const main = node('demo/src/app.ts::fn::main::34');
    expect(symbolStartLine(main, node('demo/src/app.ts').code)).toBe(3);
    const store = node('demo/src/util.ts::class::Store');
    expect(symbolStartLine(store, node('demo/src/util.ts').code)).toBe(7);
  });
  test('falls back to the byte offset when the snippet is missing', () => {
    const bare: NodeData = { ...node('demo/src/util.ts::fn::helper::36'), code: undefined };
    expect(symbolStartLine(bare, node('demo/src/util.ts').code)).toBe(3);
  });
  test('returns null for files and unknown sources', () => {
    expect(symbolStartLine(node('demo/src/app.ts'), node('demo/src/app.ts').code)).toBeNull();
    expect(symbolStartLine(node('demo/src/app.ts::fn::main::34'), undefined)).toBeNull();
  });
  test('builds repo-relative paths and GitHub links', () => {
    expect(repoRelativePath('demo/src/app.ts::fn::main::34')).toBe('src/app.ts');
    expect(githubUrl('o/r', node('demo/src/app.ts::fn::main::34'), 3)).toBe('https://github.com/o/r/blob/HEAD/src/app.ts#L3');
    expect(githubUrl('o/r', { id: 'demo/src', label: 'src', group: 'folders', language: '', val: 1 }, null)).toBe(
      'https://github.com/o/r/tree/HEAD/src',
    );
  });
});

describe('share helpers', () => {
  test('reads and writes ?repo=', () => {
    expect(readRepoParam('?repo=owner/name')).toBe('owner/name');
    expect(readRepoParam('?repo=../../etc')).toBeNull();
    expect(readRepoParam('')).toBeNull();
    expect(withRepoParam('https://x.dev/?a=1', 'o/r')).toBe('https://x.dev/?a=1&repo=o%2Fr');
    expect(withRepoParam('https://x.dev/?repo=o%2Fr', null)).toBe('https://x.dev/');
  });
  test('remembers recent scans, newest first, without duplicates', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    rememberScan('a/one', storage);
    rememberScan('b/two', storage);
    expect(rememberScan('a/one', storage)).toEqual(['a/one', 'b/two']);
    expect(loadRecentScans(storage)).toEqual(['a/one', 'b/two']);
    store.set('codite.recentScans', '{not json');
    expect(loadRecentScans(storage)).toEqual([]);
    expect(loadRecentScans(null)).toEqual([]);
  });
});

describe('export', () => {
  const placed: GraphData = {
    nodes: [
      { id: 'a', label: 'A <b>', group: 'src', language: 'go', val: 4, x: 0, y: 0, code: 'secret' },
      { id: 'b', label: 'B', group: 'src', language: 'go', val: 4, x: 30, y: 10 },
    ],
    links: [{ source: 'a', target: 'b', type: 'imports' }],
  };
  test('SVG contains every node, link and escaped labels', () => {
    const svg = graphToSvg(placed, { background: '#000', link: '#888', label: '#fff', colorOf: () => '#f00', showLabels: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg.match(/<line/g)).toHaveLength(1);
    expect(svg).toContain('A &lt;b&gt;');
  });
  test('JSON strips simulation state and source code', () => {
    const json = JSON.parse(graphToJson(placed));
    expect(json.nodes[0]).toEqual({ id: 'a', label: 'A <b>', group: 'src', language: 'go', val: 4 });
    expect(json.links[0]).toEqual({ source: 'a', target: 'b', type: 'imports' });
  });
  test('safeFilename', () => {
    expect(safeFilename('owner/repo name')).toBe('owner-repo-name');
    expect(safeFilename('///')).toBe('graph');
  });
});

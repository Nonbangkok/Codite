import { expect, test } from 'vitest';
import { prepareGraph } from '../src/utils/prepareGraph';

test('keeps one node per id (the fullest), drops imports, dangling and duplicate links', () => {
  const g = prepareGraph({
    nodes: [
      { id: 'p/a.c', label: 'a.c', group: 'p', language: 'c', val: 20, code: 'x' },
      { id: 'p/a.c::struct::node', label: 'node', group: 'structs', language: 'c', val: 12, code: 'struct node;' },
      { id: 'p/a.c::struct::node', label: 'node', group: 'structs', language: 'c', val: 12, code: 'struct node { int v; };' },
      { id: 'p/a.c::import::0', label: 'stdio', group: 'imports', language: 'c', val: 5 },
    ],
    links: [
      { source: 'p/a.c', target: 'p/a.c::struct::node', type: 'contains' },
      { source: 'p/a.c', target: 'p/a.c::struct::node', type: 'contains' },
      { source: 'p/a.c', target: 'p/a.c::import::0', type: 'imports' },
      { source: 'p/a.c', target: 'p/missing.c', type: 'imports_module' },
    ],
  });
  expect(g.nodes.map((n) => n.id)).toEqual(['p/a.c', 'p/a.c::struct::node']);
  expect(g.nodes[1].code).toBe('struct node { int v; };');
  expect(g.links).toHaveLength(1);
});

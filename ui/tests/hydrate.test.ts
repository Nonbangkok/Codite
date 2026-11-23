import { expect, test } from 'vitest';
import type { NodeData } from '../src/types';
import { hydrateCode, needsCode } from '../src/utils/hydrate';
import { symbolStartLine } from '../src/utils/sourceLocation';

const node = (id: string, extra: Partial<NodeData> = {}): NodeData => ({ id, label: id, group: 'x', language: 'ts', val: 1, ...extra });

test('fills file code and cuts symbol code by line range', () => {
  const nodes = [
    node('r/a.ts'),
    node('r/a.ts::fn::f::0', { start_line: 2, end_line: 3 }),
    node('r/b.ts', { code: 'kept' }),
    node('r/c.ts::fn::g::0', { start_line: 1, end_line: 1 }),
  ];
  expect(needsCode(nodes)).toBe(true);
  const filled = hydrateCode(nodes, { 'r/a.ts': 'line1\nfunction f() {\n}\nline4', 'r/b.ts': 'replaced?' });
  expect(filled).toBe(2);
  expect(nodes[0].code).toBe('line1\nfunction f() {\n}\nline4');
  expect(nodes[1].code).toBe('function f() {\n}');
  expect(nodes[2].code).toBe('kept'); // inline code wins
  expect(nodes[3].code).toBeUndefined(); // no file code available
  expect(needsCode(nodes.slice(0, 3))).toBe(false);
});

test('start_line from the analyzer is used directly', () => {
  expect(symbolStartLine(node('r/a.ts::fn::f::0', { start_line: 42 }), undefined)).toBe(42);
});

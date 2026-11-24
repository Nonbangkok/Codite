import { describe, expect, test } from 'vitest';
import type { LinkData, NodeData } from '../src/types';
import { treeLayout } from '../src/utils/treeLayout';
import { countCrossings } from '../src/utils/crossings';

const n = (id: string, start_line?: number): NodeData => ({ id, label: id, group: 'x', language: '', val: 8, start_line });
const l = (source: string, target: string, type = 'imports_module'): LinkData => ({ source, target, type });

const minDistance = (pos: Map<string, [number, number]>) => {
  const pts = [...pos.values()];
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  return min;
};
const crossings = (pos: Map<string, [number, number]>, links: LinkData[]) => {
  const ids = [...pos.keys()];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const points = ids.map((id) => ({ x: pos.get(id)![0], y: pos.get(id)![1] }));
  return countCrossings(points, links.map((x) => [idx.get(x.source as string)!, idx.get(x.target as string)!] as [number, number]));
};

describe('treeLayout (layered)', () => {
  test('importers sit above what they import; every node is placed', () => {
    const nodes = ['r/app.ts', 'r/a.ts', 'r/b.ts', 'r/a1.ts', 'r/a2.ts', 'r/b1.ts'].map((x) => n(x));
    const links = [l('r/app.ts', 'r/a.ts'), l('r/app.ts', 'r/b.ts'), l('r/a.ts', 'r/a1.ts'), l('r/a.ts', 'r/a2.ts'), l('r/b.ts', 'r/b1.ts')];
    const pos = treeLayout(nodes, links);
    expect(pos.size).toBe(6);
    expect(pos.get('r/app.ts')![1]).toBeLessThan(pos.get('r/a.ts')![1]);
    expect(pos.get('r/a.ts')![1]).toBeLessThan(pos.get('r/a1.ts')![1]);
    expect(crossings(pos, links)).toBe(0);
  });

  test('reordering removes crossings a naive order would have', () => {
    // Top row A B C imports bottom row in reverse: the layered sweeps must untwist it.
    const nodes = ['r/A.ts', 'r/B.ts', 'r/C.ts', 'r/x.ts', 'r/y.ts', 'r/z.ts'].map((x) => n(x));
    const links = [l('r/A.ts', 'r/z.ts'), l('r/B.ts', 'r/y.ts'), l('r/C.ts', 'r/x.ts'), l('r/A.ts', 'r/y.ts')];
    expect(crossings(treeLayout(nodes, links), links)).toBe(0);
  });

  test('cycles are broken and isolated nodes are placed', () => {
    const nodes = ['r/x.ts', 'r/y.ts', 'r/z.ts', 'r/lonely.ts'].map((x) => n(x));
    const pos = treeLayout(nodes, [l('r/x.ts', 'r/y.ts'), l('r/y.ts', 'r/z.ts'), l('r/z.ts', 'r/x.ts')]);
    expect(pos.size).toBe(4);
    for (const [x, y] of pos.values()) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  test("a file's symbols form a compact block under it, in source order, with no crossings", () => {
    const nodes = [n('r/hub.ts'), ...Array.from({ length: 400 }, (_, i) => n(`r/hub.ts::fn::c${i}::${i}`, 400 - i))];
    const links = Array.from({ length: 400 }, (_, i) => l('r/hub.ts', `r/hub.ts::fn::c${i}::${i}`, 'contains'));
    const pos = treeLayout(nodes, links);
    expect(pos.size).toBe(401);
    expect(minDistance(pos)).toBeGreaterThanOrEqual(25);
    const xs = [...pos.values()].map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1000); // a block, not a 13,000px row
    expect(crossings(pos, links)).toBe(0);
    // c399 has the smallest line number, so it comes first (top-left of the block).
    const first = pos.get('r/hub.ts::fn::c399::399')!;
    const last = pos.get('r/hub.ts::fn::c0::0')!;
    expect(first[1]).toBeLessThan(last[1]);
  });

  test('is deterministic', () => {
    const nodes = ['r/b.ts', 'r/a.ts', 'r/c.ts', 'r/d.ts'].map((x) => n(x));
    const links = [l('r/a.ts', 'r/b.ts'), l('r/a.ts', 'r/c.ts'), l('r/c.ts', 'r/d.ts')];
    expect([...treeLayout(nodes, links)].sort()).toEqual([...treeLayout([...nodes].reverse(), [...links].reverse())].sort());
  });
});

test('upward sweeps run safely on graphs that keep crossings (K3,3-like)', () => {
  // Every top file imports every bottom file: crossings cannot all be removed, so the
  // ordering does both downward and upward passes.
  const top = ['r/a.ts', 'r/b.ts', 'r/c.ts'];
  const bottom = ['r/x.ts', 'r/y.ts', 'r/z.ts'];
  const nodes = [...top, ...bottom].map((x) => n(x));
  const links = top.flatMap((t) => bottom.map((b) => l(t, b)));
  const pos = treeLayout(nodes, links);
  expect(pos.size).toBe(6);
  // In two rows every ordering of K3,3 has C(3,2)·C(3,2) = 9 crossings; the point is no crash.
  expect(crossings(pos, links)).toBe(9);
});

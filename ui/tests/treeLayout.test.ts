import { describe, expect, test } from 'vitest';
import type { LinkData, NodeData } from '../src/types';
import { treeLayout } from '../src/utils/treeLayout';

const n = (id: string): NodeData => ({ id, label: id, group: 'x', language: '', val: 8 });
const l = (source: string, target: string, type = 'calls'): LinkData => ({ source, target, type });

const minDistance = (pos: Map<string, [number, number]>) => {
  const pts = [...pos.values()];
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  return min;
};

describe('treeLayout', () => {
  test('parents sit above children and every node has a position', () => {
    const nodes = ['root', 'a', 'b', 'a1', 'a2', 'b1'].map(n);
    const links = [l('root', 'a'), l('root', 'b'), l('a', 'a1'), l('a', 'a2'), l('b', 'b1')];
    const pos = treeLayout(nodes, links);
    expect(pos.size).toBe(6);
    expect(pos.get('root')![1]).toBeLessThan(pos.get('a')![1]);
    expect(pos.get('a')![1]).toBeLessThan(pos.get('a1')![1]);
    expect(pos.get('a')![1]).toBe(pos.get('b')![1]);
    // Children are grouped under their parent's side.
    expect(pos.get('a1')![0]).toBeLessThan(pos.get('b1')![0]);
  });

  test('cycles and isolated nodes are handled', () => {
    const nodes = ['x', 'y', 'z', 'lonely'].map(n);
    const pos = treeLayout(nodes, [l('x', 'y'), l('y', 'z'), l('z', 'x')]);
    expect(pos.size).toBe(4);
    for (const [x, y] of pos.values()) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  test('a crowded level never overlaps: it wraps into bands with one slot per node', () => {
    // One parent with 2,000 children: the case that stacked nodes on top of each other.
    const nodes = [n('hub'), ...Array.from({ length: 2000 }, (_, i) => n(`c${i}`))];
    const links = Array.from({ length: 2000 }, (_, i) => l('hub', `c${i}`, 'contains'));
    const pos = treeLayout(nodes, links, { spacing: 30 });
    expect(pos.size).toBe(2001);
    expect(minDistance(pos)).toBeGreaterThanOrEqual(15); // half a slot at worst between bands
    const xs = [...pos.values()].map((p) => p[0]);
    const ys = [...pos.values()].map((p) => p[1]);
    // Wrapped into a roughly balanced block rather than a 60,000px-wide line.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(5000);
    expect(new Set(ys).size).toBeGreaterThan(10);
  });

  test('is deterministic', () => {
    const nodes = ['b', 'a', 'c', 'd'].map(n);
    const links = [l('a', 'b'), l('a', 'c'), l('c', 'd')];
    expect([...treeLayout(nodes, links)]).toEqual([...treeLayout([...nodes].reverse(), [...links].reverse())]);
  });
});

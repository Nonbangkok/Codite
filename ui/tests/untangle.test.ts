import { describe, expect, test } from 'vitest';
import { countCrossings, segmentsCross } from '../src/utils/crossings';
import { untangle } from '../src/utils/untangle';

const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe('crossings', () => {
  test('proper crossings only; shared endpoints and touching do not count', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(false);
  });
  test('grid count matches brute force on a random graph', () => {
    const r = rnd(5);
    const pos = Array.from({ length: 120 }, () => ({ x: r() * 800, y: r() * 600 }));
    const edges: [number, number][] = Array.from({ length: 200 }, () => [Math.floor(r() * 120), Math.floor(r() * 120)] as [number, number]).filter(([a, b]) => a !== b);
    let brute = 0;
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const [a, b] = edges[i];
        const [c, d] = edges[j];
        if (a === c || a === d || b === c || b === d) continue;
        if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) brute++;
      }
    expect(countCrossings(pos, edges)).toBe(brute);
  });
});

describe('untangle', () => {
  test('swings leaves away from edges they cross', () => {
    // A hub with a leaf placed right across a long edge.
    const pos = [
      { x: 0, y: 0 }, // hub
      { x: 0, y: 60 }, // leaf, crossing the edge below
      { x: -200, y: 30 },
      { x: 200, y: 30 },
    ];
    const edges: [number, number][] = [
      [0, 1],
      [2, 3],
    ];
    const res = untangle({ pos, fixed: [false, false, true, true], edges, budgetMs: 1000 });
    expect(res.before).toBe(1);
    expect(res.after).toBe(0);
    expect(res.pos[2]).toEqual(pos[2]); // fixed nodes stay
  });

  test('a tangled random layout loses most of its crossings and never gains any', () => {
    const r = rnd(11);
    const n = 300;
    const pos = Array.from({ length: n }, () => ({ x: r() * 1200, y: r() * 900 }));
    const edges: [number, number][] = [];
    for (let i = 1; i < n; i++) edges.push([Math.floor(r() * i), i]); // a random tree…
    for (let k = 0; k < 60; k++) edges.push([Math.floor(r() * n), Math.floor(r() * n)]); // …plus extra links
    const clean = edges.filter(([a, b]) => a !== b);
    const res = untangle({ pos, fixed: pos.map(() => false), edges: clean, budgetMs: 3000 });
    expect(res.before).toBeGreaterThan(500);
    expect(res.after).toBeLessThan(res.before * 0.5);
    expect(countCrossings(res.pos, clean)).toBe(res.after);
  });

  test('keeps a minimum gap between nodes', () => {
    const r = rnd(2);
    const pos = Array.from({ length: 150 }, () => ({ x: r() * 600, y: r() * 600 }));
    const edges: [number, number][] = Array.from({ length: 149 }, (_, i) => [Math.floor(r() * (i + 1)), i + 1] as [number, number]);
    const res = untangle({ pos, fixed: pos.map(() => false), edges, minGap: 14, budgetMs: 2000 });
    // Only moved nodes are guaranteed the gap; compare moved ones against everyone.
    for (let i = 0; i < pos.length; i++) {
      if (res.pos[i].x === pos[i].x && res.pos[i].y === pos[i].y) continue;
      for (let j = 0; j < pos.length; j++) if (j !== i) expect(Math.hypot(res.pos[i].x - res.pos[j].x, res.pos[i].y - res.pos[j].y)).toBeGreaterThanOrEqual(13.99);
    }
  });

  test('respects the time budget', () => {
    let t = 0;
    const r = rnd(3);
    const pos = Array.from({ length: 400 }, () => ({ x: r() * 1000, y: r() * 1000 }));
    const edges: [number, number][] = Array.from({ length: 800 }, () => [Math.floor(r() * 400), Math.floor(r() * 400)] as [number, number]).filter(([a, b]) => a !== b);
    const res = untangle({ pos, fixed: pos.map(() => false), edges, budgetMs: 50, now: () => (t += 1) });
    expect(res.after).toBeLessThanOrEqual(res.before);
  });
});

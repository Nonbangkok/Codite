import { EdgeGrid, type Point } from './crossings';

export interface UntangleInput {
  /** Positions after the force layout settled. */
  pos: Point[];
  /** Nodes that must not move (pinned by the user). */
  fixed: boolean[];
  edges: [number, number][];
  /** Minimum distance kept between any two nodes. */
  minGap?: number;
  /**
   * Per-node collision radius. When given, two nodes are kept at least the sum of their radii
   * apart (and never closer than `minGap`), matching the force layout's collide force.
   */
  radius?: number[];
  /** Stop after this many milliseconds. */
  budgetMs?: number;
  now?: () => number;
}

export interface UntangleResult {
  pos: Point[];
  before: number;
  after: number;
}

/** Grid of node positions to keep moved nodes from landing on top of others. */
class NodeGrid {
  private cells = new Map<string, Set<number>>();
  private pos: Point[];
  private size: number;
  private gap: (i: number, j: number) => number;
  constructor(pos: Point[], size: number, gap: (i: number, j: number) => number) {
    this.pos = pos;
    this.size = size;
    this.gap = gap;
    pos.forEach((_, i) => this.add(i));
  }
  private key(p: Point) {
    return `${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)}`;
  }
  add(i: number) {
    const k = this.key(this.pos[i]);
    (this.cells.get(k) ?? this.cells.set(k, new Set()).get(k)!).add(i);
  }
  remove(i: number) {
    this.cells.get(this.key(this.pos[i]))?.delete(i);
  }
  /** True if any node other than `self` is closer to `p` than the gap between the two. */
  crowded(p: Point, self: number) {
    const cx = Math.floor(p.x / this.size);
    const cy = Math.floor(p.y / this.size);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of this.cells.get(`${cx + dx},${cy + dy}`) ?? [])
          if (j !== self && Math.hypot(this.pos[j].x - p.x, this.pos[j].y - p.y) < this.gap(self, j)) return true;
    return false;
  }
}

/**
 * Reduces edge crossings of a settled force layout with local moves:
 *  1. nodes with several links try their neighbours' centre and nearby offsets;
 *  2. leaves (one link) are swung around their parent to the angle that crosses least.
 * A move is kept only if it strictly lowers the crossings of the moved node's edges and keeps
 * `minGap` to every other node, so the result never has more crossings than the input.
 */
export const untangle = ({ pos: input, fixed, edges, minGap = 14, radius, budgetMs = 400, now = () => performance.now() }: UntangleInput): UntangleResult => {
  const start = now();
  const pos = input.map((p) => ({ x: p.x, y: p.y }));
  const n = pos.length;
  const incident: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], e) => {
    incident[a].push(e);
    incident[b].push(e);
  });
  const grid = new EdgeGrid(pos, edges);
  const gap = radius ? (i: number, j: number) => Math.max(minGap, radius[i] + radius[j]) : () => minGap;
  const widest = radius ? Math.max(minGap, 2 * radius.reduce((m, r) => Math.max(m, r), 0)) : minGap;
  const nodes = new NodeGrid(pos, Math.max(widest, 10), gap);
  const other = (e: number, v: number) => (edges[e][0] === v ? edges[e][1] : edges[e][0]);

  const crossingsAt = (v: number, p: Point) => {
    let c = 0;
    for (const e of incident[v]) c += grid.crossingsOf(e, p, pos[other(e, v)]);
    return c;
  };
  let before = 0;
  edges.forEach(([a, b], e) => (before += grid.crossingsOf(e, pos[a], pos[b])));
  before /= 2;

  const moveTo = (v: number, p: Point) => {
    for (const e of incident[v]) grid.remove(e);
    nodes.remove(v);
    pos[v] = p;
    nodes.add(v);
    for (const e of incident[v]) grid.add(e);
  };
  const outOfTime = () => now() - start > budgetMs;

  const lengths = edges.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)).sort((x, y) => x - y);
  const step = Math.max(10, (lengths[lengths.length >> 1] || 40) / 2);

  // 1. Hubs and middle nodes.
  for (let pass = 0; pass < 4 && !outOfTime(); pass++) {
    let improved = false;
    const order = [...Array(n).keys()].filter((v) => !fixed[v] && incident[v].length >= 2);
    const current = new Map(order.map((v) => [v, crossingsAt(v, pos[v])]));
    order.sort((a, b) => current.get(b)! - current.get(a)!);
    for (const v of order) {
      if (outOfTime()) break;
      const now0 = current.get(v)!;
      if (now0 === 0) continue;
      const nb = incident[v].map((e) => pos[other(e, v)]);
      const centre = { x: nb.reduce((s, p) => s + p.x, 0) / nb.length, y: nb.reduce((s, p) => s + p.y, 0) / nb.length };
      const candidates: Point[] = [centre];
      for (const scale of [0.5, 1, 2, 3]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          candidates.push({ x: pos[v].x + Math.cos(a) * step * scale, y: pos[v].y + Math.sin(a) * step * scale });
        }
      }
      let best = now0;
      let bestP: Point | null = null;
      for (const p of candidates) {
        if (nodes.crowded(p, v)) continue;
        const c = crossingsAt(v, p);
        if (c < best) {
          best = c;
          bestP = p;
        }
      }
      if (bestP) {
        moveTo(v, bestP);
        improved = true;
      }
    }
    if (!improved) break;
  }

  // 2. Leaves: swing each one around its parent to the least-crossing angle.
  const leaves = [...Array(n).keys()].filter((v) => !fixed[v] && incident[v].length === 1);
  leaves.sort((a, b) => crossingsAt(b, pos[b]) - crossingsAt(a, pos[a]));
  for (const v of leaves) {
    if (outOfTime()) break;
    const parent = other(incident[v][0], v);
    const now0 = crossingsAt(v, pos[v]);
    if (now0 === 0) continue;
    const r0 = Math.max(gap(v, parent), Math.hypot(pos[v].x - pos[parent].x, pos[v].y - pos[parent].y));
    let best = now0;
    let bestP: Point | null = null;
    for (const r of [r0, r0 * 0.7, r0 * 1.4, r0 * 2]) {
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        const p = { x: pos[parent].x + Math.cos(a) * r, y: pos[parent].y + Math.sin(a) * r };
        if (nodes.crowded(p, v)) continue;
        const c = crossingsAt(v, p);
        if (c < best) {
          best = c;
          bestP = p;
          if (c === 0) break;
        }
      }
      if (best === 0) break;
    }
    if (bestP) moveTo(v, bestP);
  }

  let after = 0;
  edges.forEach(([a, b], e) => (after += grid.crossingsOf(e, pos[a], pos[b])));
  return { pos, before, after: after / 2 };
};

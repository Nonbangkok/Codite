/** Edge-crossing geometry shared by the layouts and the tests. */

export type Point = { x: number; y: number };

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** True when segments AB and CD properly cross (touching at a shared endpoint does not count). */
export const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/**
 * Counts crossings between straight edges `[i, j]` over node positions. Edges sharing a node never
 * count. Uses a uniform grid so large graphs stay fast.
 */
export const countCrossings = (pos: ReadonlyArray<Point>, edges: ReadonlyArray<readonly [number, number]>): number => {
  const index = new EdgeGrid(pos, edges);
  let total = 0;
  for (let e = 0; e < edges.length; e++) total += index.crossingsOf(e, pos[edges[e][0]], pos[edges[e][1]], e);
  return total / 2;
};

/** Grid of edge bounding boxes for fast "which edges might cross this segment" queries. */
export class EdgeGrid {
  private cell: number;
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private tick = 0;
  private edgeCells: number[][];
  private pos: ReadonlyArray<Point>;
  private edges: ReadonlyArray<readonly [number, number]>;

  constructor(pos: ReadonlyArray<Point>, edges: ReadonlyArray<readonly [number, number]>, cellSize?: number) {
    this.pos = pos;
    this.edges = edges;
    const lengths = edges.map(([a, b]) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)).sort((x, y) => x - y);
    this.cell = cellSize ?? Math.max(20, lengths[lengths.length >> 1] || 50);
    this.stamp = new Int32Array(edges.length);
    this.edgeCells = edges.map(() => []);
    for (let e = 0; e < edges.length; e++) this.add(e);
  }

  private key(cx: number, cy: number) {
    return cx * 73856093 ^ cy * 19349663;
  }

  private cellsFor(a: Point, b: Point): number[] {
    const out: number[] = [];
    const x0 = Math.floor(Math.min(a.x, b.x) / this.cell);
    const x1 = Math.floor(Math.max(a.x, b.x) / this.cell);
    const y0 = Math.floor(Math.min(a.y, b.y) / this.cell);
    const y1 = Math.floor(Math.max(a.y, b.y) / this.cell);
    // Very long edges cover many cells; cap the box so one edge can't make queries quadratic.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
      for (let x = x0; x <= x1; x += Math.ceil((x1 - x0 + 1) / 64)) for (let y = y0; y <= y1; y += Math.ceil((y1 - y0 + 1) / 64)) out.push(this.key(x, y));
      return out;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(this.key(x, y));
    return out;
  }

  add(e: number) {
    const [a, b] = this.edges[e];
    const keys = this.cellsFor(this.pos[a], this.pos[b]);
    this.edgeCells[e] = keys;
    for (const k of keys) {
      const list = this.cells.get(k);
      if (list) list.push(e);
      else this.cells.set(k, [e]);
    }
  }

  remove(e: number) {
    for (const k of this.edgeCells[e]) {
      const list = this.cells.get(k);
      if (!list) continue;
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }
    this.edgeCells[e] = [];
  }

  /**
   * Crossings of segment PQ (standing in for edge `self`, whose endpoints are excluded) with the
   * indexed edges. `skip` is ignored (pass -1 to count against every edge).
   */
  crossingsOf(self: number, p: Point, q: Point, skip = -1): number {
    const [sa, sb] = this.edges[self];
    this.tick++;
    let n = 0;
    for (const k of this.cellsFor(p, q)) {
      const list = this.cells.get(k);
      if (!list) continue;
      for (const e of list) {
        if (e === skip || e === self || this.stamp[e] === this.tick) continue;
        this.stamp[e] = this.tick;
        const [a, b] = this.edges[e];
        if (a === sa || a === sb || b === sa || b === sb) continue;
        if (segmentsCross(p, q, this.pos[a], this.pos[b])) n++;
      }
    }
    return n;
  }
}

import type { LinkData, NodeData } from '../types';
import { linkEndId } from './graphIndex';

export interface TreeLayoutOptions {
  /** Gap between neighbouring units in a row. */
  spacing?: number;
  /** Gap between rows, added to the tallest symbol block in the row above. */
  levelGap?: number;
  /** Size of one symbol cell in a file's block. */
  cell?: number;
  /** Ordering sweeps; more sweeps cost time and usually save a few crossings. */
  sweeps?: number;
  /** Stop improving the order after this many milliseconds. */
  budgetMs?: number;
}

const isSymbol = (id: string) => id.includes('::');

/** Number of inversions = crossings between two adjacent layers (merge-sort count). */
const inversions = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mid = values.length >> 1;
  const left = values.slice(0, mid);
  const right = values.slice(mid);
  let count = inversions(left) + inversions(right);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) values[k++] = left[i++];
    else {
      values[k++] = right[j++];
      count += left.length - i;
    }
  }
  while (i < left.length) values[k++] = left[i++];
  while (j < right.length) values[k++] = right[j++];
  return count;
};

/**
 * Layered ("Sugiyama") layout built for code graphs, aiming for as few crossings as possible:
 *  - files, folders and other non-symbol nodes form the rows; each file's symbols sit in a compact
 *    block right under it, so file → symbol links stay short and never cross other blocks;
 *  - links between symbols count as links between their files for ordering;
 *  - cycles are broken, rows come from longest paths, long links get placeholder nodes;
 *  - rows are reordered with alternating barycenter sweeps plus adjacent swaps, keeping the order
 *    with the fewest crossings;
 *  - x positions pull every unit toward its neighbours while keeping spacing (isotonic regression).
 * Returns fixed positions centred on the origin.
 */
export const treeLayout = (nodes: readonly NodeData[], links: readonly LinkData[], options: TreeLayoutOptions = {}): Map<string, [number, number]> => {
  const spacing = options.spacing ?? 36;
  const levelGap = options.levelGap ?? 70;
  const cell = options.cell ?? 26;
  const sweeps = options.sweeps ?? 12;
  const budgetMs = options.budgetMs ?? 400;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const started = clock();
  const lineOf = new Map(nodes.map((n) => [n.id, n.start_line ?? 0]));

  const ids = nodes.map((n) => n.id).sort();
  const present = new Set(ids);
  // Each symbol belongs to its file's unit when that file is shown.
  const unitOf = new Map<string, string>();
  for (const id of ids) {
    const file = id.split('::')[0];
    unitOf.set(id, isSymbol(id) && present.has(file) ? file : id);
  }
  const units = [...new Set(unitOf.values())].sort();
  const uIndex = new Map(units.map((u, i) => [u, i]));
  const members = new Map<string, string[]>(units.map((u) => [u, []]));
  for (const id of ids) if (unitOf.get(id) !== id) members.get(unitOf.get(id)!)!.push(id);

  // Unit graph, de-duplicated.
  const adj: Set<number>[] = units.map(() => new Set());
  for (const l of links) {
    const s = linkEndId(l.source);
    const t = linkEndId(l.target);
    if (!present.has(s) || !present.has(t)) continue;
    const a = uIndex.get(unitOf.get(s)!)!;
    const b = uIndex.get(unitOf.get(t)!)!;
    if (a !== b) adj[a].add(b);
  }

  // Break cycles: drop back edges found by an iterative DFS (in sorted order, so deterministic).
  const state = new Uint8Array(units.length); // 0 new, 1 on stack, 2 done
  const dag: number[][] = units.map(() => []);
  for (let root = 0; root < units.length; root++) {
    if (state[root]) continue;
    const stack: [number, number[]][] = [[root, [...adj[root]].sort((x, y) => x - y)]];
    state[root] = 1;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = frame[1].shift();
      if (next === undefined) {
        state[frame[0]] = 2;
        stack.pop();
        continue;
      }
      if (state[next] === 1) continue; // back edge: skip
      dag[frame[0]].push(next);
      if (state[next] === 0) {
        state[next] = 1;
        stack.push([next, [...adj[next]].sort((x, y) => x - y)]);
      }
    }
  }

  // Longest-path layering.
  const indeg = new Int32Array(units.length);
  for (const outs of dag) for (const t of outs) indeg[t]++;
  const layer = new Int32Array(units.length);
  const queue = [...units.keys()].filter((i) => indeg[i] === 0);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const t of dag[u]) {
      layer[t] = Math.max(layer[t], layer[u] + 1);
      if (--indeg[t] === 0) queue.push(t);
    }
  }

  // Layers with placeholder (dummy) nodes on long edges. Node ids < units.length are real.
  const layers: number[][] = [];
  const up: number[][] = [];
  const down: number[][] = [];
  const addNode = (l: number) => {
    const id = up.length;
    up.push([]);
    down.push([]);
    (layers[l] ??= []).push(id);
    return id;
  };
  for (let i = 0; i < units.length; i++) {
    up.push([]);
    down.push([]);
  }
  // Initial order: depth-first from the roots, so subtrees start out together.
  const seen = new Uint8Array(units.length);
  const visitOrder: number[] = [];
  const dfs = (start: number) => {
    const stack = [start];
    while (stack.length) {
      const u = stack.pop()!;
      if (seen[u]) continue;
      seen[u] = 1;
      visitOrder.push(u);
      for (const t of [...dag[u]].reverse()) if (!seen[t]) stack.push(t);
    }
  };
  for (let i = 0; i < units.length; i++) if (layer[i] === 0) dfs(i);
  for (let i = 0; i < units.length; i++) dfs(i);
  for (const u of visitOrder) (layers[layer[u]] ??= []).push(u);
  for (let u = 0; u < units.length; u++) {
    for (const t of dag[u]) {
      let prev = u;
      for (let l = layer[u] + 1; l < layer[t]; l++) {
        const d = addNode(l);
        down[prev].push(d);
        up[d].push(prev);
        prev = d;
      }
      down[prev].push(t);
      up[t].push(prev);
    }
  }
  for (let l = 0; l < layers.length; l++) layers[l] ??= [];

  const position = new Float64Array(up.length);
  const setPositions = () => layers.forEach((row) => row.forEach((v, i) => (position[v] = i)));
  const crossingsBetween = (l: number) => {
    if (l < 0 || l + 1 >= layers.length) return 0;
    const pairs: [number, number][] = [];
    for (const v of layers[l]) for (const t of down[v]) pairs.push([position[v], position[t]]);
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return inversions(pairs.map((p) => p[1]));
  };
  const totalCrossings = () => {
    let c = 0;
    for (let l = 0; l + 1 < layers.length; l++) c += crossingsBetween(l);
    return c;
  };

  setPositions();
  let best = layers.map((r) => [...r]);
  let bestCrossings = totalCrossings();
  for (let s = 0; s < sweeps && bestCrossings > 0 && clock() - started < budgetMs; s++) {
    const downward = s % 2 === 0;
    const order = downward ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
    for (const l of order) {
      const neighbours = downward ? up : down;
      const row = layers[l];
      const bary = new Map<number, number>();
      for (const v of row) {
        const ns = neighbours[v];
        bary.set(v, ns.length ? ns.reduce((sum, x) => sum + position[x], 0) / ns.length : position[v]);
      }
      row.sort((a, b) => bary.get(a)! - bary.get(b)! || position[a] - position[b]);
      row.forEach((v, i) => (position[v] = i));
      // Transpose: swap neighbours while that lowers crossings with the adjacent rows
      // (skipped on very wide rows, where it costs too much for what it saves).
      for (let i = 0; i + 1 < row.length && row.length <= 400 && clock() - started < budgetMs; i++) {
        const before = crossingsBetween(l - 1) + crossingsBetween(l);
        [row[i], row[i + 1]] = [row[i + 1], row[i]];
        position[row[i]] = i;
        position[row[i + 1]] = i + 1;
        if (crossingsBetween(l - 1) + crossingsBetween(l) >= before) {
          [row[i], row[i + 1]] = [row[i + 1], row[i]];
          position[row[i]] = i;
          position[row[i + 1]] = i + 1;
        }
      }
    }
    const c = totalCrossings();
    if (c < bestCrossings) {
      bestCrossings = c;
      best = layers.map((r) => [...r]);
    }
  }
  best.forEach((row, l) => (layers[l] = row));

  // Widths: a unit is as wide as its symbol block.
  const block = (u: number) => {
    const k = u < units.length ? members.get(units[u])!.length : 0;
    const cols = k ? Math.max(1, Math.ceil(Math.sqrt(k * 1.6))) : 0;
    return { cols, rows: cols ? Math.ceil(k / cols) : 0 };
  };
  const width = (u: number) => (u < units.length ? Math.max(spacing, block(u).cols * cell) : spacing * 0.5);

  // x: start packed, then pull toward neighbours with an isotonic fit that keeps order and gaps.
  const x = new Float64Array(up.length);
  for (const row of layers) {
    let cursor = 0;
    for (let i = 0; i < row.length; i++) {
      if (i > 0) cursor += (width(row[i - 1]) + width(row[i])) / 2 + spacing * 0.3;
      x[row[i]] = cursor;
    }
    const mid = cursor / 2;
    for (const v of row) x[v] -= mid;
  }
  for (let iter = 0; iter < 8; iter++) {
    const rowsInOrder = iter % 2 === 0 ? layers : [...layers].reverse();
    for (const row of rowsInOrder) {
      if (!row.length) continue;
      const desired = row.map((v) => {
        const ns = [...up[v], ...down[v]];
        return ns.length ? ns.reduce((s, t) => s + x[t], 0) / ns.length : x[v];
      });
      // Offsets so that consecutive units keep their minimum gap.
      const offset: number[] = [0];
      for (let i = 1; i < row.length; i++) offset[i] = offset[i - 1] + (width(row[i - 1]) + width(row[i])) / 2 + spacing * 0.3;
      // Pool-adjacent-violators on desired - offset (must be non-decreasing).
      const blocks: { sum: number; n: number }[] = [];
      for (let i = 0; i < row.length; i++) {
        blocks.push({ sum: desired[i] - offset[i], n: 1 });
        while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
          const b = blocks.pop()!;
          blocks[blocks.length - 1].sum += b.sum;
          blocks[blocks.length - 1].n += b.n;
        }
      }
      let i = 0;
      for (const b of blocks) for (let k = 0; k < b.n; k++, i++) x[row[i]] = b.sum / b.n + offset[i];
    }
  }

  // y: each row sits below the tallest symbol block of the row above.
  const out = new Map<string, [number, number]>();
  let y = 0;
  for (const row of layers) {
    let tallest = 0;
    for (const v of row) {
      if (v >= units.length) continue;
      const unit = units[v];
      out.set(unit, [x[v], y]);
      const syms = members.get(unit)!;
      const { cols } = block(v);
      // Symbols in source order when line numbers are known.
      const byLine = [...syms].sort((a, b) => lineOf.get(a)! - lineOf.get(b)! || a.localeCompare(b));
      byLine.forEach((id, i) => {
        const cx = (i % cols) - (cols - 1) / 2;
        const cy = Math.floor(i / cols);
        out.set(id, [x[v] + cx * cell, y + 34 + cy * cell]);
      });
      tallest = Math.max(tallest, syms.length ? 34 + block(v).rows * cell : 0);
    }
    y += tallest + levelGap;
  }
  const half = (y - levelGap) / 2;
  for (const p of out.values()) p[1] -= half;
  return out;
};

/** Fixes nodes at the given positions, or releases them when `positions` is null. */
export const fixPositions = (nodes: NodeData[], positions: Map<string, [number, number]> | null) => {
  for (const n of nodes) {
    const p = positions?.get(n.id);
    if (p) {
      n.x = n.fx = p[0];
      n.y = n.fy = p[1];
      n.vx = n.vy = 0;
    } else if (positions === null) {
      n.fx = undefined;
      n.fy = undefined;
    }
  }
};

/** Moves nodes part of the way from `from` to `to` (t in 0..1); the simulation owns these objects. */
export const moveNodes = (nodes: NodeData[], from: { x: number; y: number }[], to: { x: number; y: number }[], t: number) => {
  nodes.forEach((n, i) => {
    if (n.fx != null || n.fy != null || !to[i]) return;
    n.x = from[i].x + (to[i].x - from[i].x) * t;
    n.y = from[i].y + (to[i].y - from[i].y) * t;
    n.vx = 0;
    n.vy = 0;
  });
};

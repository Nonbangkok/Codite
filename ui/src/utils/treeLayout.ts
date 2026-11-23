import type { LinkData, NodeData } from '../types';
import { linkEndId } from './graphIndex';

export interface TreeLayoutOptions {
  /** Horizontal distance between neighbors in a row. */
  spacing?: number;
  /** Vertical distance between levels. */
  levelGap?: number;
  /** Vertical distance between wrapped bands of one level. */
  bandGap?: number;
  /** Most nodes per band before a level wraps; defaults to about 2.5 × √n. */
  maxPerBand?: number;
}

/**
 * Deterministic layered ("tree") layout that cannot overlap nodes:
 *  - levels are breadth-first distances from the roots (nodes nothing points to), following
 *    links from source to target; cycles are fine because each node is placed once;
 *  - each level is ordered by the average position of its parents to reduce crossings;
 *  - long levels wrap into several bands so the layout keeps a readable shape;
 *  - every node gets its own slot, `spacing` apart.
 * Returns fixed positions centred on the origin.
 */
export const treeLayout = (nodes: readonly NodeData[], links: readonly LinkData[], options: TreeLayoutOptions = {}): Map<string, [number, number]> => {
  const spacing = options.spacing ?? 32;
  const levelGap = options.levelGap ?? 80;
  const bandGap = options.bandGap ?? 30;
  const maxPerBand = options.maxPerBand ?? Math.max(12, Math.ceil(Math.sqrt(nodes.length) * 2.5));

  const ids = nodes.map((n) => n.id).sort();
  const known = new Set(ids);
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of links) {
    const s = linkEndId(l.source);
    const t = linkEndId(l.target);
    if (s === t || !known.has(s) || !known.has(t)) continue;
    children.get(s)!.push(t);
    parents.get(t)!.push(s);
  }

  // Breadth-first levels from the roots; nodes only reachable through cycles start new roots.
  const level = new Map<string, number>();
  const visit = (roots: string[]) => {
    let frontier = roots.filter((r) => !level.has(r));
    for (const r of frontier) level.set(r, 0);
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const c of children.get(id)!) {
          if (level.has(c)) continue;
          level.set(c, level.get(id)! + 1);
          next.push(c);
        }
      }
      frontier = next;
    }
  };
  visit(ids.filter((id) => parents.get(id)!.length === 0));
  for (const id of ids) {
    // A node inside a cycle with no outside parent: start from it, keeping its level near its
    // already-placed parents (if any).
    if (!level.has(id)) {
      const placed = parents.get(id)!.filter((p) => level.has(p)).map((p) => level.get(p)!);
      level.set(id, placed.length ? Math.max(...placed) + 1 : 0);
      visit([id]);
      // visit() skips already-set roots, so expand this node's subtree explicitly.
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of children.get(cur)!) {
          if (level.has(c)) continue;
          level.set(c, level.get(cur)! + 1);
          stack.push(c);
        }
      }
    }
  }

  const byLevel = new Map<number, string[]>();
  for (const id of ids) {
    const l = level.get(id)!;
    const row = byLevel.get(l);
    if (row) row.push(id);
    else byLevel.set(l, [id]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  // Order each level by the mean slot of its parents (barycenter heuristic).
  const slot = new Map<string, number>();
  for (const l of levels) {
    const row = byLevel.get(l)!;
    const key = (id: string) => {
      const ps = parents.get(id)!.filter((p) => slot.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + slot.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
    };
    const keyed = row.map((id, i) => ({ id, k: key(id), i }));
    keyed.sort((a, b) => a.k - b.k || a.i - b.i);
    keyed.forEach(({ id }, i) => slot.set(id, i / Math.max(1, keyed.length - 1)));
    byLevel.set(l, keyed.map((x) => x.id));
  }

  // Place rows, wrapping long levels into bands.
  const out = new Map<string, [number, number]>();
  let y = 0;
  for (const l of levels) {
    const row = byLevel.get(l)!;
    const bands = Math.ceil(row.length / maxPerBand);
    const perBand = Math.ceil(row.length / bands);
    for (let b = 0; b < bands; b++) {
      const band = row.slice(b * perBand, (b + 1) * perBand);
      const width = (band.length - 1) * spacing;
      band.forEach((id, i) => out.set(id, [i * spacing - width / 2 + (b % 2 ? spacing / 2 : 0), y + b * bandGap]));
    }
    y += (bands - 1) * bandGap + levelGap;
  }
  // Centre vertically.
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

import { hierarchy, tree } from 'd3';
import type { LinkData, NodeData } from '../types';
import { countCrossings } from './crossings';

/** Parent in the folder → file → symbol hierarchy ('' for a top-level path). */
export const structuralParent = (id: string): string => {
  if (id.includes('::')) return id.split('::')[0];
  const slash = id.lastIndexOf('/');
  return slash >= 0 ? id.slice(0, slash) : '';
};

/** Nearest ancestor of `id` that is in `present` ('' when none is). */
const nearestPresent = (id: string, present: ReadonlySet<string>): string => {
  for (let p = structuralParent(id); p; p = structuralParent(p)) if (present.has(p)) return p;
  return '';
};

/**
 * Hierarchy links between the shown nodes: each node to its nearest shown ancestor. This is a
 * forest, so it can always be drawn without crossings.
 */
export const structureLinks = (nodes: readonly NodeData[]): LinkData[] => {
  const present = new Set(nodes.map((n) => n.id));
  const out: LinkData[] = [];
  for (const n of nodes) {
    const parent = nearestPresent(n.id, present);
    if (parent) out.push({ source: parent, target: n.id, type: 'contains' });
  }
  return out;
};

/**
 * Lays out the folder → file → symbol hierarchy so its links never cross.
 *
 * Prefers a radial tidy tree (round, compact). In very lopsided trees a radial link can cut
 * inward across another one, so the result is checked; if any crossing remains it falls back to a
 * top-down tidy tree, which is planar by construction (every subtree owns its own x-range and
 * children sit one level below their parent). Positions are centred on the origin.
 */
export const structureLayout = (nodes: readonly NodeData[], spacing = 14): Map<string, [number, number]> => {
  const present = new Set(nodes.map((n) => n.id));
  type Item = { id: string; children: Item[] };
  const items = new Map<string, Item>();
  const root: Item = { id: '', children: [] };
  for (const id of [...present].sort()) items.set(id, { id, children: [] });
  for (const item of items.values()) {
    const parent = nearestPresent(item.id, present);
    (parent ? items.get(parent)! : root).children.push(item);
  }
  // A single top-level node becomes the centre instead of a lone spoke.
  const top = root.children.length === 1 ? root.children[0] : root;
  const h = hierarchy(top, (d) => (d.children.length ? d.children : null));

  const radial = (): Map<string, [number, number]> => {
    const leaves = h.leaves().length;
    const depth = Math.max(1, h.height);
    // Room for every leaf on the outer ring, and rings no closer than ~70px apart.
    const radius = Math.max(depth * 70, (leaves * spacing) / (2 * Math.PI));
    const laid = tree<Item>()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(h.copy());
    const out = new Map<string, [number, number]>();
    laid.each((d) => {
      if (!d.data.id) return;
      const angle = d.x - Math.PI / 2;
      out.set(d.data.id, [Math.cos(angle) * d.y, Math.sin(angle) * d.y]);
    });
    return out;
  };

  const topDown = (): Map<string, [number, number]> => {
    const laid = tree<Item>()
      .nodeSize([spacing * 1.5, 90])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.6))(h.copy());
    const out = new Map<string, [number, number]>();
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    laid.each((d) => {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      maxY = Math.max(maxY, d.y);
    });
    laid.each((d) => {
      if (d.data.id) out.set(d.data.id, [d.x - (minX + maxX) / 2, d.y - maxY / 2]);
    });
    return out;
  };

  const links = structureLinks(nodes);
  const crossingsIn = (pos: Map<string, [number, number]>) => {
    const ids = [...pos.keys()];
    const idx = new Map(ids.map((id, i) => [id, i]));
    return countCrossings(
      ids.map((id) => ({ x: pos.get(id)![0], y: pos.get(id)![1] })),
      links.map((l) => [idx.get(l.source as string)!, idx.get(l.target as string)!] as [number, number]),
    );
  };

  const round = radial();
  return crossingsIn(round) === 0 ? round : topDown();
};

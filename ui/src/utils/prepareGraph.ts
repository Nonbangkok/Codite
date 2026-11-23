import type { GraphData, LinkData, NodeData } from '../types';
import { linkEndId } from './graphIndex';

/**
 * Cleans analyzer output for display:
 *  - drops import placeholder nodes (they clutter the graph),
 *  - keeps one node per id (older analyzer versions could emit duplicates, and duplicate ids
 *    make links attach to one copy while the other drifts loose),
 *  - drops links to missing nodes and exact duplicate links.
 */
export const prepareGraph = (data: GraphData): GraphData => {
  const byId = new Map<string, NodeData>();
  for (const n of data.nodes) {
    if (n.group === 'imports') continue;
    const existing = byId.get(n.id);
    // Prefer the declaration with more code (e.g. a definition over a forward declaration).
    if (!existing || (n.code?.length ?? 0) > (existing.code?.length ?? 0)) byId.set(n.id, n);
  }
  const seen = new Set<string>();
  const links: LinkData[] = [];
  for (const l of data.links) {
    const s = linkEndId(l.source);
    const t = linkEndId(l.target);
    if (!byId.has(s) || !byId.has(t)) continue;
    const key = `${s}->${t}:${l.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(l);
  }
  return { nodes: [...byId.values()], links };
};

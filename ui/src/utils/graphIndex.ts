import type { GraphData, LinkData } from '../types';

export const linkEndId = (end: LinkData['source']): string => (typeof end === 'string' ? end : end.id);

const keyCache = new WeakMap<LinkData, string>();

/**
 * Stable identity for a link that survives react-force-graph replacing ids with node objects.
 * Cached per link object because the renderer asks for it for every link on every frame.
 */
export const linkKey = (link: LinkData): string => {
  let key = keyCache.get(link);
  if (key === undefined) {
    key = `${linkEndId(link.source)}->${linkEndId(link.target)}:${link.type}`;
    keyCache.set(link, key);
  }
  return key;
};

export interface Edge {
  id: string;
  type: string;
  link: LinkData;
}

export interface GraphIndex {
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
}

export const buildGraphIndex = (graph: GraphData): GraphIndex => {
  const out = new Map<string, Edge[]>();
  const inc = new Map<string, Edge[]>();
  for (const node of graph.nodes) {
    out.set(node.id, []);
    inc.set(node.id, []);
  }
  for (const link of graph.links) {
    const source = linkEndId(link.source);
    const target = linkEndId(link.target);
    if (!out.has(source) || !inc.has(target)) continue;
    out.get(source)!.push({ id: target, type: link.type, link });
    inc.get(target)!.push({ id: source, type: link.type, link });
  }
  return { out, in: inc };
};

const neighborsOf = (index: GraphIndex, id: string): Edge[] => [
  ...(index.out.get(id) ?? []),
  ...(index.in.get(id) ?? []),
];

/** Node ids within `depth` hops of `start`, ignoring direction. Includes `start`. */
export const neighborhood = (index: GraphIndex, start: string, depth: number): Set<string> => {
  const seen = new Set<string>();
  if (!index.out.has(start)) return seen;
  seen.add(start);
  let frontier = [start];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of neighborsOf(index, id)) {
        if (!seen.has(edge.id)) {
          seen.add(edge.id);
          next.push(edge.id);
        }
      }
    }
    frontier = next;
  }
  return seen;
};

export interface PathResult {
  nodeIds: string[];
  linkKeys: Set<string>;
}

/** Shortest undirected path between two nodes (BFS), or null if they are not connected. */
export const shortestPath = (index: GraphIndex, from: string, to: string): PathResult | null => {
  if (!index.out.has(from) || !index.out.has(to)) return null;
  if (from === to) return { nodeIds: [from], linkKeys: new Set() };

  const previous = new Map<string, { id: string; link: LinkData }>();
  const seen = new Set([from]);
  let frontier = [from];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of neighborsOf(index, id)) {
        if (seen.has(edge.id)) continue;
        seen.add(edge.id);
        previous.set(edge.id, { id, link: edge.link });
        if (edge.id === to) {
          const nodeIds = [to];
          const linkKeys = new Set<string>();
          let cursor = to;
          while (cursor !== from) {
            const step = previous.get(cursor)!;
            linkKeys.add(linkKey(step.link));
            cursor = step.id;
            nodeIds.push(cursor);
          }
          return { nodeIds: nodeIds.reverse(), linkKeys };
        }
        next.push(edge.id);
      }
    }
    frontier = next;
  }
  return null;
};

/** Keeps only the given nodes and the links between them. Node objects are reused, not copied. */
export const subgraph = (graph: GraphData, keep: (id: string) => boolean): GraphData => {
  const nodes = graph.nodes.filter((n) => keep(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((l) => ids.has(linkEndId(l.source)) && ids.has(linkEndId(l.target)));
  return { nodes, links };
};

/** True when `id` is the folder itself or lives inside it (avoids `src` matching `src2/...`). */
export const isInFolder = (id: string, folder: string): boolean =>
  id === folder || id.startsWith(`${folder}/`) || id.startsWith(`${folder}::`);

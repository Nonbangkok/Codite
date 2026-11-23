import type { GraphData, LinkData, NodeData } from '../types';
import { buildGraphIndex, linkEndId, type GraphIndex } from './graphIndex';
import { codeMetrics } from './codeAnalysis';
import { isSymbolId } from './nodeKinds';

// ── Metrics ────────────────────────────────────────────────────────────────

export type SizeMetric = 'lines' | 'connections' | 'complexity';

export interface NodeMetrics {
  lines: number;
  connections: number;
  complexity: number;
}

export const computeMetrics = (nodes: readonly NodeData[], index: GraphIndex): Map<string, NodeMetrics> => {
  const out = new Map<string, NodeMetrics>();
  for (const node of nodes) {
    const m = node.code ? codeMetrics(node.code) : null;
    out.set(node.id, {
      lines: m?.codeLines ?? 0,
      connections: (index.out.get(node.id)?.length ?? 0) + (index.in.get(node.id)?.length ?? 0),
      complexity: m?.complexity ?? 0,
    });
  }
  return out;
};

/**
 * Maps each node to 0..1 by rank (ties share a rank), so a few huge outliers don't flatten
 * everyone else into the same color or size.
 */
export const rankScale = (values: ReadonlyMap<string, number>): Map<string, number> => {
  const sorted = [...new Set(values.values())].sort((a, b) => a - b);
  const pos = new Map(sorted.map((v, i) => [v, sorted.length > 1 ? i / (sorted.length - 1) : 0]));
  return new Map([...values].map(([id, v]) => [id, pos.get(v)!]));
};

// ── Folder groups and collapsing ───────────────────────────────────────────

const folderOf = (id: string) => {
  const file = id.split('::')[0];
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(0, slash) : '';
};

/** Folder `depth` segments deep that contains the node (or its file), e.g. depth 2 → `repo/src`. */
export const folderAtDepth = (id: string, depth: number): string => {
  const parts = folderOf(id).split('/').filter(Boolean);
  return parts.slice(0, Math.min(depth, parts.length)).join('/');
};

/**
 * Chooses the shallowest folder depth that splits the nodes into at least two groups
 * (a repo whose code all lives in `src/` groups by `src/*`).
 */
export const groupDepth = (nodes: readonly NodeData[], maxDepth = 5): number => {
  for (let depth = 2; depth <= maxDepth; depth++) {
    const groups = new Set(nodes.map((n) => folderAtDepth(n.id, depth)));
    if (groups.size >= 2) return depth;
  }
  return 2;
};

export interface FolderGroup {
  key: string;
  label: string;
  count: number;
}

export const folderGroups = (nodes: readonly NodeData[], depth: number): FolderGroup[] => {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.group === 'folders') continue;
    const key = folderAtDepth(n.id, depth);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // The project root itself is not a folder group: collapsing it would hide everything.
  return [...counts]
    .filter(([key]) => key.includes('/'))
    .map(([key, count]) => ({ key, label: key.split('/').slice(1).join('/') || key || '(root)', count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

const collapsedCache = new Map<string, NodeData>();

/**
 * Replaces everything inside each collapsed folder with one folder node. Links are redirected
 * to that node and de-duplicated; links that end up inside one folder are dropped.
 */
export const collapseFolders = (graph: GraphData, collapsed: ReadonlySet<string>): GraphData => {
  if (collapsed.size === 0) return graph;
  const owner = (id: string): string | null => {
    for (const folder of collapsed) if (id === folder || id.startsWith(`${folder}/`)) return folder;
    return null;
  };
  const counts = new Map<string, number>();
  const centroid = new Map<string, { x: number; y: number; n: number }>();
  const nodes: NodeData[] = [];
  for (const n of graph.nodes) {
    const f = owner(n.id);
    if (f === null) nodes.push(n);
    else if (n.id !== f) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
        const c = centroid.get(f) ?? { x: 0, y: 0, n: 0 };
        c.x += n.x!;
        c.y += n.y!;
        c.n++;
        centroid.set(f, c);
      }
    }
  }
  for (const [folder, count] of counts) {
    // Reuse the same object across renders so the simulation keeps its position.
    const key = `${folder}#${count}`;
    let node = collapsedCache.get(key);
    if (!node) {
      const prev = [...collapsedCache.values()].find((c) => c.id === folder);
      // Start where the folder's contents were, so the node appears in place instead of
      // flying in from the middle of the graph.
      const c = centroid.get(folder);
      const start = prev?.x !== undefined ? { x: prev.x, y: prev.y } : c?.n ? { x: c.x / c.n, y: c.y / c.n } : { x: undefined, y: undefined };
      node = {
        id: folder,
        label: `${folder.split('/').pop()} (${count})`,
        group: 'folders',
        language: '',
        val: Math.min(60, 10 + Math.sqrt(count) * 5),
        collapsedCount: count,
        x: start.x,
        y: start.y,
      };
      collapsedCache.set(key, node);
    }
    nodes.push(node);
  }
  const seen = new Set<string>();
  const links: LinkData[] = [];
  for (const l of graph.links) {
    const s = owner(linkEndId(l.source)) ?? linkEndId(l.source);
    const t = owner(linkEndId(l.target)) ?? linkEndId(l.target);
    if (s === t) continue;
    const key = `${s}->${t}:${l.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const unchanged = s === linkEndId(l.source) && t === linkEndId(l.target);
    links.push(unchanged ? l : { source: s, target: t, type: l.type });
  }
  return { nodes, links };
};

// ── Impact analysis ────────────────────────────────────────────────────────

/** Link types meaning "the source depends on the target". */
export const DEPENDENCY_TYPES = new Set(['imports', 'imports_module', 'implements', 'calls', 'declares_module']);

export interface Impact {
  root: string;
  /** Node id → distance from the root (0 = the root and its containing file). */
  depth: Map<string, number>;
  maxDepth: number;
}

/**
 * Everything that (transitively) depends on `root`: follows dependency links backwards.
 * A symbol's file counts as affected too, so importers of that file are included.
 */
export const impactOf = (graph: GraphData, root: string, maxDepth = Infinity, index = buildGraphIndex(graph)): Impact => {
  const depth = new Map<string, number>([[root, 0]]);
  if (isSymbolId(root)) {
    for (const e of index.in.get(root) ?? []) if (e.type === 'contains') depth.set(e.id, 0);
  }
  let frontier = [...depth.keys()];
  let d = 0;
  while (frontier.length && d < maxDepth) {
    d++;
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.in.get(id) ?? []) {
        if (!DEPENDENCY_TYPES.has(e.type) || depth.has(e.id)) continue;
        depth.set(e.id, d);
        next.push(e.id);
      }
    }
    frontier = next;
  }
  return { root, depth, maxDepth: Math.max(...depth.values()) };
};

// ── Layout persistence ─────────────────────────────────────────────────────

export interface SavedLayout {
  /** Nodes pinned in place. */
  pinned: Record<string, [number, number]>;
  /** Starting positions from "Save layout". */
  positions: Record<string, [number, number]>;
}

const layoutKey = (scope: string) => `codite.layout.${scope}`;

export const loadLayout = (scope: string): SavedLayout => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(layoutKey(scope)) ?? 'null');
    if (raw && typeof raw === 'object') return { pinned: raw.pinned ?? {}, positions: raw.positions ?? {} };
  } catch {
    // ignore
  }
  return { pinned: {}, positions: {} };
};

export const saveLayout = (scope: string, layout: SavedLayout) => {
  try {
    window.localStorage.setItem(layoutKey(scope), JSON.stringify(layout));
  } catch {
    // storage full or blocked
  }
};

/** Applies saved positions to fresh node objects; pinned nodes get fixed coordinates. */
export const applyLayout = (nodes: NodeData[], layout: SavedLayout) => {
  for (const n of nodes) {
    const pin = layout.pinned[n.id];
    const pos = pin ?? layout.positions[n.id];
    if (pos) {
      n.x = pos[0];
      n.y = pos[1];
    }
    if (pin) {
      n.fx = pin[0];
      n.fy = pin[1];
    }
  }
};


/** Releases fixed positions (the simulation owns these objects and mutates them anyway). */
export const unpinNodes = (nodes: NodeData[]) => {
  for (const n of nodes) {
    n.fx = undefined;
    n.fy = undefined;
  }
};

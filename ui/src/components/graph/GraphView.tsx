import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, LinkData, NodeData } from '../../types';
import {
  createCrossingReductionForce,
  createDegreeMap,
  createSpeedLimitForce,
  getCollisionRadius,
  getGraphChargeStrength,
  getGraphLinkDistance,
  getGraphLinkStrength,
  type SimLink,
  type SimNode,
} from '../../utils/graphLayout';
import { linkKey, neighborhood, parallelLinkCurvature, type GraphIndex, type PathResult } from '../../utils/graphIndex';
import { KIND_LABEL, languageLabel, nodeKind } from '../../utils/nodeKinds';
import { canvasToPng } from '../../utils/exportGraph';
import { fixPositions, moveNodes, treeLayout } from '../../utils/treeLayout';
import { structureLayout } from '../../utils/structureLayout';
import { untangle } from '../../utils/untangle';
import { emphasize, PALETTES, rgba, type RGB, type ThemeName } from '../../theme';
import { useGraphCamera, type CameraTarget } from '../../hooks/useGraphCamera';
import { useElementSize } from '../../hooks/useElementSize';
import { Minimap, type MinimapHandle } from './Minimap';

export type ColorMode = 'kind' | 'language' | 'heat';
export type LayoutMode = 'force' | 'tree' | 'radial' | 'structure';

/** Above this many nodes the layout trades polish for frame rate. */
const LARGE_GRAPH = 1500;

export interface FitRequest {
  /** Changing the key triggers a fit once the layout settles. */
  key: string;
  /** Fit only these nodes (e.g. a path); defaults to all. */
  ids?: ReadonlySet<string>;
}

export interface GraphHandle {
  fitView(): void;
  zoomBy(factor: number): void;
  exportPng(): Promise<Blob | null>;
  /** Current position of every node, for "Save layout". */
  positions(): Record<string, [number, number]>;
}

export interface Emphasis {
  /** Nodes to stand out; everything else is dimmed. Optional 0..1 intensity per node. */
  ids: ReadonlySet<string>;
  intensity?: ReadonlyMap<string, number>;
}

export interface GroupHulls {
  keyOf: (id: string) => string;
  labelOf: (key: string) => string;
}

interface GraphViewProps {
  data: GraphData;
  index: GraphIndex;
  selectedId: string | null;
  path: PathResult | null;
  colorOf: (node: NodeData) => RGB;
  sizeOf: (node: NodeData) => number;
  showNames: boolean;
  theme: ThemeName;
  fitRequest: FitRequest;
  showMinimap: boolean;
  layout: LayoutMode;
  groups: GroupHulls | null;
  emphasis: Emphasis | null;
  multiSelected: ReadonlySet<string>;
  lassoMode: boolean;
  onLasso: (ids: string[], additive: boolean) => void;
  onNodeClick: (node: NodeData, event: MouseEvent) => void;
  onBackgroundClick: () => void;
  onNodePinned: (node: NodeData) => void;
  /** After the force layout settles, move nodes to remove edge crossings. */
  untangle: boolean;
}

type ForceGraphRef = ForceGraphMethods<NodeObject<NodeData>, LinkObject<NodeData, LinkData>>;
type LinkForceHandle = {
  distance: (fn: (link: SimLink) => number) => LinkForceHandle;
  strength: (fn: (link: SimLink) => number) => LinkForceHandle;
  iterations: (n: number) => LinkForceHandle;
  links: () => SimLink[];
};
type ChargeForceHandle = { strength: (fn: (node: SimNode) => number) => ChargeForceHandle };

const radiusFor = (val: number) => Math.sqrt(val || 1) * 1.3;

/** Folder depth used for the radial layout when nothing is selected. */
const pathDepth = (id: string) => id.split('::')[0].split('/').length - 1 + (id.includes('::') ? 1 : 0);

const hullColor = (key: string, theme: ThemeName): RGB => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = d3.hsl(h % 360, theme === 'dark' ? 0.45 : 0.55, theme === 'dark' ? 0.6 : 0.42).rgb();
  return [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
};

export const GraphView = forwardRef<GraphHandle, GraphViewProps>((props, ref) => {
  const { data, index, selectedId, path, colorOf, sizeOf, showNames, theme, fitRequest, showMinimap, layout, groups, emphasis, multiSelected } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphRef | undefined>(undefined);
  const minimapRef = useRef<MinimapHandle>(null);
  const { width, height } = useElementSize(containerRef);
  const { handleZoom, handleZoomEnd, beginProgrammaticMove, isProgrammaticRef } = useGraphCamera(
    containerRef,
    fgRef as unknown as React.RefObject<CameraTarget | undefined>,
  );

  const palette = PALETTES[theme];
  const isLarge = data.nodes.length > LARGE_GRAPH;

  const [hoverNode, setHoverNode] = useState<NodeData | null>(null);
  const [hoverIds, setHoverIds] = useState<ReadonlySet<string>>(new Set());
  const [hoverLinks, setHoverLinks] = useState<ReadonlySet<string>>(new Set());
  const fadeRef = useRef(1);
  const fadeAnim = useRef<number | null>(null);

  const pathIds = useMemo(() => new Set(path?.nodeIds ?? []), [path]);
  const cssColorOf = useCallback((node: NodeData) => rgba(colorOf(node), 1), [colorOf]);

  // Radial rings: distance from the selected node, or folder depth when nothing is selected.
  const ringOf = useMemo(() => {
    if (layout !== 'radial') return null;
    if (selectedId && index.out.has(selectedId)) {
      const depth = new Map<string, number>();
      let frontier = [selectedId];
      depth.set(selectedId, 0);
      for (let d = 1; frontier.length; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const e of [...(index.out.get(id) ?? []), ...(index.in.get(id) ?? [])]) {
            if (!depth.has(e.id)) {
              depth.set(e.id, d);
              next.push(e.id);
            }
          }
        }
        frontier = next;
      }
      const far = Math.max(...depth.values()) + 1;
      return (id: string) => depth.get(id) ?? far;
    }
    const min = Math.min(...data.nodes.map((n) => pathDepth(n.id)));
    return (id: string) => pathDepth(id) - min;
  }, [layout, selectedId, index, data.nodes]);

  // Physics tuned for code graphs; heavier extras are skipped for large graphs.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const nodes = data.nodes as SimNode[];
    const links = data.links as SimLink[];
    const sqrtCount = Math.sqrt(Math.max(1, nodes.length));
    const degree = createDegreeMap(nodes, links);
    const charge = fg.d3Force('charge') as unknown as ChargeForceHandle;
    const link = fg.d3Force('link') as unknown as LinkForceHandle;
    charge.strength((node) => getGraphChargeStrength(node, degree) * (layout === 'tree' ? 0.6 : 1));
    link
      .distance((l) => getGraphLinkDistance(l, sqrtCount))
      .strength((l) => (layout === 'radial' ? 0.15 : getGraphLinkStrength(l)))
      .iterations(isLarge ? 1 : 2);
    fg.d3Force('collide', d3.forceCollide<SimNode>().radius((n) => getCollisionRadius({ ...n, val: sizeOf(n) })).iterations(1));
    const centering = layout === 'force' ? 0.012 : 0;
    // With folder groups on, pull each folder toward its own center (spread on a circle) so the
    // outlines separate instead of overlapping.
    const keys = groups && layout === 'force' ? [...new Set(nodes.map((n) => groups.keyOf(n.id)))].sort() : [];
    if (keys.length > 1) {
      const ring = 22 * Math.sqrt(nodes.length) + 40 * keys.length;
      const center = new Map(keys.map((k, i) => [k, [Math.cos((2 * Math.PI * i) / keys.length) * ring, Math.sin((2 * Math.PI * i) / keys.length) * ring]]));
      // The library re-initializes forces with new nodes before this effect rebuilds `center`
      // (e.g. a folder just collapsed into one node), so unknown groups fall back to the middle
      // instead of crashing the simulation.
      const at = (n: SimNode) => center.get(groups!.keyOf(n.id)) ?? [0, 0];
      fg.d3Force('x', d3.forceX<SimNode>((n) => at(n)[0]).strength(0.09));
      fg.d3Force('y', d3.forceY<SimNode>((n) => at(n)[1]).strength(0.09));
    } else {
      fg.d3Force('x', d3.forceX(0).strength(layout === 'tree' ? 0.004 : centering));
      fg.d3Force('y', d3.forceY(0).strength(centering));
    }
    fg.d3Force('crossReduce', isLarge || layout !== 'force' ? null : createCrossingReductionForce(link.links(), 3000));
    fg.d3Force(
      'radial',
      ringOf ? d3.forceRadial<SimNode>((n) => ringOf(n.id) * Math.max(70, 40 + sqrtCount * 4), 0, 0).strength(0.9) : null,
    );
    untangleToken.current++;
    // Re-add last so it runs after every other force in the tick.
    fg.d3Force('speedLimit', null);
    fg.d3Force('speedLimit', createSpeedLimitForce() as unknown as Parameters<typeof fg.d3Force>[1]);
    fg.d3ReheatSimulation?.();
  }, [data, isLarge, layout, ringOf, sizeOf, groups]);

  // Tree and Structure layouts: fixed positions computed for the visible graph. Leaving them
  // releases those positions (the app then restores the user's own pins).
  const wasTree = useRef(false);
  useEffect(() => {
    untangleToken.current++;
    if (layout === 'tree' || layout === 'structure') {
      fixPositions(data.nodes, layout === 'tree' ? treeLayout(data.nodes, data.links) : structureLayout(data.nodes));
      wasTree.current = true;
      fgRef.current?.d3ReheatSimulation?.();
    } else if (wasTree.current) {
      fixPositions(data.nodes, null);
      wasTree.current = false;
      fgRef.current?.d3ReheatSimulation?.();
    }
  }, [layout, data]);

  const fitTo = useCallback(
    (ids?: ReadonlySet<string>, duration = 600) => {
      const fg = fgRef.current;
      if (!fg || data.nodes.length === 0) return;
      beginProgrammaticMove(duration);
      fg.zoomToFit(duration, 70, ids && ids.size > 0 ? (n: NodeObject<NodeData>) => ids.has(n.id) : undefined);
    },
    [beginProgrammaticMove, data.nodes.length],
  );

  // Fit when asked. The final fit happens when the simulation settles (onEngineStop); an
  // interim fit keeps the graph in view while it is still spreading out.
  const pendingFit = useRef<FitRequest | null>(null);
  useEffect(() => {
    pendingFit.current = fitRequest;
    const timer = setTimeout(() => {
      if (pendingFit.current === fitRequest) fitTo(fitRequest.ids);
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the key should retrigger
  }, [fitRequest.key]);

  // Once the user zooms or pans, a fit that was waiting for the layout to settle would yank
  // the view away from where they put it.
  const cancelPendingFit = useCallback(() => {
    pendingFit.current = null;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', cancelPendingFit, { passive: true, capture: true });
    return () => el.removeEventListener('wheel', cancelPendingFit, { capture: true });
  }, [cancelPendingFit]);

  // ── Untangle: once the physics settles, a worker searches for node moves that remove edge
  // crossings; the result glides in. Any new layout, data change or drag cancels it.
  const untangleToken = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const [animating, setAnimating] = useState(false);
  const lastUntangle = useRef<{ before: number; after: number } | null>(null);
  /** Token of the untangle being computed or glided to (-1 when none), for the debug hook. */
  const busyToken = useRef(-1);
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try {
      workerRef.current = new Worker(new URL('../../workers/untangle.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      workerRef.current = null;
    }
    return () => workerRef.current?.terminate();
  }, []);

  const glideTo = useCallback((nodes: NodeData[], targets: { x: number; y: number }[], token: number) => {
    const from = nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }));
    const started = performance.now();
    const duration = 450;
    setAnimating(true);
    const step = () => {
      if (token !== untangleToken.current) return setAnimating(false);
      const t = Math.min(1, (performance.now() - started) / duration);
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      moveNodes(nodes, from, targets, ease);
      if (t < 1) requestAnimationFrame(step);
      else {
        setAnimating(false);
        busyToken.current = -1;
      }
    };
    requestAnimationFrame(step);
  }, []);

  const runUntangle = useCallback(() => {
    if (!props.untangle || (layout !== 'force' && layout !== 'radial')) return;
    const nodes = data.nodes;
    if (nodes.length < 4 || nodes.length > 6000) return;
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const edges: [number, number][] = [];
    for (const l of data.links) {
      const a = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
      const b = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
      if (a !== undefined && b !== undefined && a !== b) edges.push([a, b]);
    }
    const input = {
      pos: nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })),
      fixed: nodes.map((n) => n.fx != null || n.fy != null),
      edges,
      // Same spacing as the collide force, so untangled nodes don't overlap or steal each other's clicks.
      radius: nodes.map((n) => getCollisionRadius({ ...n, val: sizeOf(n) })),
      budgetMs: nodes.length > 1500 ? 900 : 500,
    };
    const token = ++untangleToken.current;
    busyToken.current = token;
    const done = (result: { pos: { x: number; y: number }[]; before: number; after: number }) => {
      if (token !== untangleToken.current) return;
      lastUntangle.current = { before: result.before, after: result.after };
      if (result.after < result.before) glideTo(nodes, result.pos, token);
      else busyToken.current = -1;
    };
    const worker = workerRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<{ token: number; pos: { x: number; y: number }[]; before: number; after: number }>) => {
        if (e.data.token === token) done(e.data);
      };
      worker.postMessage({ ...input, token });
    } else {
      done(untangle({ ...input, budgetMs: 150 }));
    }
  }, [props.untangle, layout, data, sizeOf, glideTo]);

  const handleEngineStop = useCallback(() => {
    // The engine stops at a small but non-zero alpha; drop the leftover velocities so the next
    // reheat starts from rest.
    for (const n of data.nodes) n.vx = n.vy = 0;
    if (pendingFit.current) {
      fitTo(pendingFit.current.ids, 400);
      pendingFit.current = null;
    }
    runUntangle();
  }, [data, fitTo, runUntangle]);

  // Bring a newly selected node into view.
  useEffect(() => {
    if (!selectedId) return;
    const node = data.nodes.find((n) => n.id === selectedId);
    const fg = fgRef.current;
    if (!fg || !node || node.x === undefined || node.y === undefined) return;
    beginProgrammaticMove(1000);
    const k = fg.zoom();
    fg.zoom(Math.max(typeof k === 'number' ? k : 1, 2.2), 1000);
    fg.centerAt(node.x, node.y, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- move only when the selection changes
  }, [selectedId]);

  // Fade everything that isn't the hovered neighborhood. Writes a ref, not state, per frame.
  useEffect(() => {
    const target = hoverNode ? 0.15 : 1;
    if (fadeAnim.current) cancelAnimationFrame(fadeAnim.current);
    const step = () => {
      const diff = target - fadeRef.current;
      if (Math.abs(diff) < 0.05) {
        fadeRef.current = target;
        fadeAnim.current = null;
        return;
      }
      fadeRef.current += diff > 0 ? 0.05 : -0.05;
      fadeAnim.current = requestAnimationFrame(step);
    };
    fadeAnim.current = requestAnimationFrame(step);
    return () => {
      if (fadeAnim.current) cancelAnimationFrame(fadeAnim.current);
    };
  }, [hoverNode]);

  const handleNodeHover = useCallback(
    (node: NodeData | null) => {
      const ids = new Set<string>();
      const links = new Set<string>();
      if (node) {
        ids.add(node.id);
        for (const edge of [...(index.out.get(node.id) ?? []), ...(index.in.get(node.id) ?? [])]) {
          ids.add(edge.id);
          links.add(linkKey(edge.link));
        }
      }
      setHoverNode(node);
      setHoverIds(ids);
      setHoverLinks(links);
      if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : '';
    },
    [index],
  );

  const labelMinScale = isLarge ? 1.8 : 0.7;
  const dimOthers = !!path || !!emphasis;

  const paintNode = useCallback(
    (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = radiusFor(sizeOf(node));
      const isSelected = node.id === selectedId;
      const isHovered = node.id === hoverNode?.id;
      const inHover = hoverIds.has(node.id);
      const onPath = pathIds.has(node.id);
      const emphasized = emphasis?.ids.has(node.id) ?? false;
      const inSelection = multiSelected.has(node.id);

      let rgb = colorOf(node);
      let alpha = fadeRef.current;
      if (isSelected || isHovered || onPath) {
        rgb = palette.accent;
        alpha = 1;
      } else if (inHover) {
        rgb = emphasize(rgb, theme);
        alpha = 1;
      } else if (emphasized) {
        const intensity = emphasis?.intensity?.get(node.id);
        if (intensity !== undefined) rgb = palette.accent;
        alpha = intensity !== undefined ? 0.45 + 0.55 * intensity : 1;
      } else if (dimOthers && !hoverNode) {
        alpha = 0.16;
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = rgba(rgb, alpha);
      ctx.fill();

      if (node.collapsedCount) {
        ctx.beginPath();
        ctx.arc(x, y, r + 1.6, 0, 2 * Math.PI);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = rgba(rgb, Math.min(1, alpha + 0.3));
        ctx.lineWidth = 1 / Math.max(globalScale, 0.6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isSelected || inSelection) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.4, 0, 2 * Math.PI);
        ctx.strokeStyle = rgba(palette.accent, 0.95);
        ctx.lineWidth = (inSelection ? 1.6 : 1) / Math.max(globalScale, 0.6);
        ctx.stroke();
      }
      if (node.fx != null && node.fy != null) {
        const s = 2.2 / Math.max(globalScale * 0.5, 1);
        ctx.fillStyle = rgba(palette.label, 0.85);
        ctx.fillRect(x + r * 0.55, y - r - s * 0.6, s, s);
      }

      const strong = isSelected || isHovered || inHover || onPath || (emphasized && emphasis!.ids.size <= 60) || inSelection;
      if (strong || (showNames && globalScale >= labelMinScale)) {
        const label = strong || node.label.length <= 20 ? node.label : `${node.label.slice(0, 18)}…`;
        const fontSize = Math.max(3, Math.min(11, 11 - label.length * 0.25) / Math.max(globalScale * 0.6, 1));
        ctx.font = `${strong ? 500 : 400} ${fontSize}px 'IBM Plex Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = strong ? rgba(palette.label, 1) : rgba(rgb, alpha);
        ctx.fillText(label, x, y + r + 1.5);
      }
    },
    [selectedId, hoverNode, hoverIds, pathIds, emphasis, multiSelected, colorOf, sizeOf, palette, theme, showNames, labelMinScale, dimOthers],
  );

  // Folder hulls behind the nodes.
  const paintGroups = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!groups) return;
      const byKey = new Map<string, [number, number][]>();
      for (const n of data.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const key = groups.keyOf(n.id);
        const list = byKey.get(key) ?? [];
        list.push([n.x, n.y]);
        byKey.set(key, list);
      }
      const pad = 14;
      for (const [key, points] of byKey) {
        const color = hullColor(key, theme);
        ctx.save();
        ctx.fillStyle = rgba(color, theme === 'dark' ? 0.07 : 0.09);
        ctx.strokeStyle = rgba(color, theme === 'dark' ? 0.07 : 0.09);
        ctx.lineJoin = 'round';
        ctx.lineWidth = pad * 2;
        ctx.beginPath();
        const hull = points.length >= 3 ? d3.polygonHull(points) : null;
        if (hull) {
          ctx.moveTo(hull[0][0], hull[0][1]);
          for (const p of hull.slice(1)) ctx.lineTo(p[0], p[1]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          for (const p of points) {
            ctx.moveTo(p[0] + pad, p[1]);
            ctx.arc(p[0], p[1], pad, 0, 2 * Math.PI);
          }
          ctx.fill();
        }
        // Label above the group.
        const top = points.reduce((a, b) => (b[1] < a[1] ? b : a));
        const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
        ctx.font = `600 ${Math.max(5, 12 / Math.max(globalScale, 0.5))}px 'IBM Plex Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = rgba(color, 0.9);
        ctx.fillText(groups.labelOf(key), cx, top[1] - pad - 4);
        ctx.restore();
      }
    },
    [groups, data.nodes, theme],
  );

  const curvature = useMemo(() => parallelLinkCurvature(data.links), [data.links]);
  // In the tree layout, a link between two nodes on the same row would run straight through
  // every node in between; arc it instead.
  const sameRow = useCallback((link: LinkData) => {
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    return !!s && !!t && s.fy !== undefined && s.fy === t.fy;
  }, []);
  const linkCurvature = useCallback(
    (link: LinkData) => curvature.get(link) ?? (layout === 'tree' && sameRow(link) ? 0.35 : 0),
    [curvature, layout, sameRow],
  );

  // Per-link accessors only matter while something is highlighted; otherwise pass constants.
  const hasLinkHighlight = hoverLinks.size > 0 || (path?.linkKeys.size ?? 0) > 0;

  const linkColor = useCallback(
    (link: LinkData) => {
      if (hoverLinks.size === 0 && !path && !emphasis) return rgba(palette.link, fadeRef.current * 0.25);
      const key = linkKey(link);
      if (hoverLinks.has(key)) return rgba(palette.link, 0.9);
      if (path?.linkKeys.has(key)) return rgba(palette.accent, 0.95);
      if (emphasis) {
        const s = typeof link.source === 'object' ? link.source.id : link.source;
        const t = typeof link.target === 'object' ? link.target.id : link.target;
        if (emphasis.ids.has(s) && emphasis.ids.has(t)) return rgba(palette.link, 0.6);
      }
      const base = dimOthers && !hoverNode ? 0.06 : 0.25;
      return rgba(palette.link, fadeRef.current * base);
    },
    [hoverLinks, path, hoverNode, palette, emphasis, dimOthers],
  );

  const linkWidth = useCallback(
    (link: LinkData) => {
      const key = linkKey(link);
      if (path?.linkKeys.has(key)) return 2.4;
      if (hoverLinks.has(key)) return 1.8;
      return isLarge ? 0.5 : 0.8;
    },
    [hoverLinks, path, isLarge],
  );

  const arrowLength = useCallback(
    (link: LinkData) => {
      const key = linkKey(link);
      return hoverLinks.has(key) || path?.linkKeys.has(key) ? 3.5 : 0;
    },
    [hoverLinks, path],
  );

  const getViewport = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || !width || !height) return null;
    const a = fg.screen2GraphCoords(0, 0);
    const b = fg.screen2GraphCoords(width, height);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }, [width, height]);

  const navigateTo = useCallback(
    (x: number, y: number) => {
      beginProgrammaticMove(400);
      fgRef.current?.centerAt(x, y, 400);
    },
    [beginProgrammaticMove],
  );

  // Lasso: drag a rectangle to select the nodes inside it.
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(null);
  const onLassoDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setLasso({ x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey });
  };
  const onLassoMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lasso) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setLasso({ ...lasso, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
  };
  const onLassoUp = () => {
    const fg = fgRef.current;
    if (!lasso || !fg) return setLasso(null);
    const a = fg.screen2GraphCoords(Math.min(lasso.x0, lasso.x1), Math.min(lasso.y0, lasso.y1));
    const b = fg.screen2GraphCoords(Math.max(lasso.x0, lasso.x1), Math.max(lasso.y0, lasso.y1));
    const ids = data.nodes
      .filter((n) => n.x !== undefined && n.y !== undefined && n.x >= a.x && n.x <= b.x && n.y >= a.y && n.y <= b.y)
      .map((n) => n.id);
    setLasso(null);
    props.onLasso(ids, lasso.additive);
  };

  useImperativeHandle(
    ref,
    () => ({
      fitView: () => fitTo(undefined, 500),
      zoomBy(factor) {
        const fg = fgRef.current;
        if (!fg) return;
        cancelPendingFit();
        const k = fg.zoom();
        beginProgrammaticMove(300);
        fg.zoom(Math.max(0.05, Math.min(10, (typeof k === 'number' ? k : 1) * factor)), 300);
      },
      async exportPng() {
        const canvas = containerRef.current?.querySelector('canvas');
        return canvas ? canvasToPng(canvas, palette.background) : null;
      },
      positions() {
        const out: Record<string, [number, number]> = {};
        for (const n of data.nodes) if (n.x !== undefined && n.y !== undefined) out[n.id] = [Math.round(n.x), Math.round(n.y)];
        return out;
      },
    }),
    [fitTo, beginProgrammaticMove, palette.background, data.nodes, cancelPendingFit],
  );

  // Development-only handle for automated graph checks (positions, link endpoints, camera).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __coditeGraph?: unknown }).__coditeGraph = {
      data,
      layout,
      screenOf: (id: string) => {
        const n = data.nodes.find((x) => x.id === id);
        const fg = fgRef.current;
        if (!n || !fg || n.x === undefined || n.y === undefined) return null;
        return fg.graph2ScreenCoords(n.x, n.y);
      },
      zoom: () => fgRef.current?.zoom(),
      fg: fgRef.current,
      get untangle() {
        return lastUntangle.current;
      },
      get untangling() {
        return busyToken.current !== -1 && busyToken.current === untangleToken.current;
      },
    };
  });

  const hoverKind = hoverNode ? nodeKind(hoverNode) : null;
  const hoverNeighbors = useMemo(() => (hoverNode ? neighborhood(index, hoverNode.id, 1).size - 1 : 0), [hoverNode, index]);

  return (
    <div
      ref={containerRef}
      className="graph"
      role="region"
      aria-label={`Dependency graph, ${data.nodes.length} nodes and ${data.links.length} connections`}
      aria-describedby="graph-help"
    >
      <p id="graph-help" className="visually-hidden">
        The graph is drawn on a canvas. Use search (press slash), the file tree, or the connections list in the details
        panel to move between nodes with the keyboard.
      </p>
      {width > 0 && height > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={width}
          height={height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx, globalScale) => {
            // At least 6 screen pixels to grab, so small nodes stay clickable and draggable when
            // zoomed out (they were ~1px wide and drags turned into pans).
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, Math.max(radiusFor(sizeOf(node)) + 2, 6 / globalScale), 0, 2 * Math.PI);
            ctx.fill();
          }}
          nodeLabel={() => ''}
          onNodeHover={(node) => handleNodeHover((node as NodeData) ?? null)}
          onNodeClick={(node, event) => props.onNodeClick(node as NodeData, event)}
          autoPauseRedraw={!animating}
          onNodeDrag={() => {
            untangleToken.current++;
          }}
          onNodeDragEnd={(node) => {
            node.fx = node.x;
            node.fy = node.y;
            props.onNodePinned(node as NodeData);
          }}
          onBackgroundClick={props.onBackgroundClick}
          onZoom={(t) => {
            if (!isProgrammaticRef()) cancelPendingFit();
            handleZoom(t);
          }}
          onZoomEnd={handleZoomEnd}
          onEngineStop={handleEngineStop}
          onRenderFramePre={groups ? paintGroups : undefined}
          onRenderFramePost={() => minimapRef.current?.redraw()}
          minZoom={0.05}
          maxZoom={10}
          linkColor={linkColor}
          linkWidth={hasLinkHighlight ? linkWidth : isLarge ? 0.5 : 0.8}
          linkDirectionalArrowLength={hasLinkHighlight ? arrowLength : 0}
          linkDirectionalArrowRelPos={0.92}
          linkCurvature={curvature.size || layout === 'tree' ? linkCurvature : 0}
          d3AlphaDecay={isLarge ? 0.045 : 0.028}
          // Without a minimum alpha the engine only stops when cooldownTime runs out (15 s), which
          // delayed the final fit and the untangle step long after the layout had settled.
          d3AlphaMin={0.005}
          cooldownTime={isLarge ? 8000 : 15000}
        />
      )}

      {props.lassoMode && (
        <div
          className="lasso"
          aria-hidden="true"
          onPointerDown={onLassoDown}
          onPointerMove={onLassoMove}
          onPointerUp={onLassoUp}
          onPointerCancel={() => setLasso(null)}
        >
          {lasso && (
            <div
              className="lasso__rect"
              style={{
                left: Math.min(lasso.x0, lasso.x1),
                top: Math.min(lasso.y0, lasso.y1),
                width: Math.abs(lasso.x1 - lasso.x0),
                height: Math.abs(lasso.y1 - lasso.y0),
              }}
            />
          )}
        </div>
      )}

      {hoverNode && hoverKind && (
        <div className="floating hovercard" aria-hidden="true">
          <div className="hovercard__kind">
            <span className="dot" style={{ background: cssColorOf(hoverNode) }} />
            {hoverNode.collapsedCount ? `Collapsed folder, ${hoverNode.collapsedCount} nodes` : KIND_LABEL[hoverKind].one}
            {hoverNode.language && ` in ${languageLabel(hoverNode.language)}`}
          </div>
          <div className="hovercard__name">{hoverNode.label}</div>
          <div className="hovercard__meta">
            {hoverNeighbors} {hoverNeighbors === 1 ? 'connection' : 'connections'}
            {hoverNode.collapsedCount ? ', click to expand' : ''}
            {hoverNode.fx != null ? ', pinned' : ''}
          </div>
        </div>
      )}

      {showMinimap && data.nodes.length > 0 && (
        <Minimap
          ref={minimapRef}
          nodes={data.nodes}
          colorOf={cssColorOf}
          viewportColor={palette.minimapViewport}
          getViewport={getViewport}
          onNavigate={navigateTo}
        />
      )}
    </div>
  );
});
GraphView.displayName = 'GraphView';

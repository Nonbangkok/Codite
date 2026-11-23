import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, LinkData, NodeData } from '../../types';
import {
  createCrossingReductionForce,
  createDegreeMap,
  getCollisionRadius,
  getGraphChargeStrength,
  getGraphLinkDistance,
  getGraphLinkStrength,
  type SimLink,
  type SimNode,
} from '../../utils/graphLayout';
import { linkKey, type GraphIndex, type PathResult } from '../../utils/graphIndex';
import { KIND_LABEL, languageLabel, nodeKind } from '../../utils/nodeKinds';
import { canvasToPng, nodeRadius } from '../../utils/exportGraph';
import { emphasize, PALETTES, rgba, type RGB, type ThemeName } from '../../theme';
import { useGraphCamera, type CameraTarget } from '../../hooks/useGraphCamera';
import { useElementSize } from '../../hooks/useElementSize';
import { Minimap, type MinimapHandle } from './Minimap';

export type ColorMode = 'kind' | 'language';

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
}

interface GraphViewProps {
  data: GraphData;
  index: GraphIndex;
  selectedId: string | null;
  path: PathResult | null;
  colorMode: ColorMode;
  showNames: boolean;
  theme: ThemeName;
  fitRequest: FitRequest;
  showMinimap: boolean;
  onNodeClick: (node: NodeData) => void;
  onBackgroundClick: () => void;
}

type ForceGraphRef = ForceGraphMethods<NodeObject<NodeData>, LinkObject<NodeData, LinkData>>;
type LinkForceHandle = {
  distance: (fn: (link: SimLink) => number) => LinkForceHandle;
  strength: (fn: (link: SimLink) => number) => LinkForceHandle;
  iterations: (n: number) => LinkForceHandle;
  links: () => SimLink[];
};
type ChargeForceHandle = { strength: (fn: (node: SimNode) => number) => ChargeForceHandle };

export const GraphView = forwardRef<GraphHandle, GraphViewProps>(
  (
    { data, index, selectedId, path, colorMode, showNames, theme, fitRequest, showMinimap, onNodeClick, onBackgroundClick },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const fgRef = useRef<ForceGraphRef | undefined>(undefined);
    const minimapRef = useRef<MinimapHandle>(null);
    const { width, height } = useElementSize(containerRef);
    const { handleZoom, handleZoomEnd, beginProgrammaticMove } = useGraphCamera(
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

    const baseColor = useCallback(
      (node: NodeData): RGB =>
        colorMode === 'language'
          ? (palette.language[node.language] ?? palette.language.default)
          : (palette.kind[nodeKind(node)] ?? palette.kind.default),
      [colorMode, palette],
    );
    const cssColorOf = useCallback((node: NodeData) => rgba(baseColor(node), 1), [baseColor]);

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
      charge.strength((node) => getGraphChargeStrength(node, degree));
      link
        .distance((l) => getGraphLinkDistance(l, sqrtCount))
        .strength((l) => getGraphLinkStrength(l))
        .iterations(isLarge ? 1 : 2);
      fg.d3Force('collide', d3.forceCollide<SimNode>().radius(getCollisionRadius).iterations(1));
      fg.d3Force('x', d3.forceX(0).strength(0.012));
      fg.d3Force('y', d3.forceY(0).strength(0.012));
      fg.d3Force('crossReduce', isLarge ? null : createCrossingReductionForce(link.links(), 3000));
      fg.d3ReheatSimulation?.();
    }, [data, isLarge]);

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

    const handleEngineStop = useCallback(() => {
      if (pendingFit.current) {
        fitTo(pendingFit.current.ids, 400);
        pendingFit.current = null;
      }
    }, [fitTo]);

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

    const paintNode = useCallback(
      (node: SimNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const r = nodeRadius(node);
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoverNode?.id;
        const inHover = hoverIds.has(node.id);
        const onPath = pathIds.has(node.id);

        let rgb = baseColor(node);
        let alpha = fadeRef.current;
        if (isSelected || isHovered || onPath) {
          rgb = palette.accent;
          alpha = 1;
        } else if (inHover) {
          rgb = emphasize(rgb, theme);
          alpha = 1;
        } else if (path && !hoverNode) {
          alpha = 0.22;
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = rgba(rgb, alpha);
        ctx.fill();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(x, y, r + 2.2, 0, 2 * Math.PI);
          ctx.strokeStyle = rgba(palette.accent, 0.9);
          ctx.lineWidth = 1 / Math.max(globalScale, 0.6);
          ctx.stroke();
        }

        const emphasized = isSelected || isHovered || inHover || onPath;
        if (emphasized || (showNames && globalScale >= labelMinScale)) {
          const label = emphasized || node.label.length <= 20 ? node.label : `${node.label.slice(0, 18)}…`;
          const fontSize = Math.max(3, Math.min(11, 11 - label.length * 0.25) / Math.max(globalScale * 0.6, 1));
          ctx.font = `${emphasized ? 500 : 400} ${fontSize}px 'IBM Plex Sans', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = emphasized ? rgba(palette.label, 1) : rgba(rgb, alpha);
          ctx.fillText(label, x, y + r + 1.5);
        }
      },
      [selectedId, hoverNode, hoverIds, pathIds, path, baseColor, palette, theme, showNames, labelMinScale],
    );

    // Per-link accessors only matter while something is highlighted; otherwise pass constants.
    const hasLinkHighlight = hoverLinks.size > 0 || (path?.linkKeys.size ?? 0) > 0;

    const linkColor = useCallback(
      (link: LinkData) => {
        if (hoverLinks.size === 0 && !path) return rgba(palette.link, fadeRef.current * 0.25);
        const key = linkKey(link);
        if (hoverLinks.has(key)) return rgba(palette.link, 0.9);
        if (path?.linkKeys.has(key)) return rgba(palette.accent, 0.95);
        const base = path && !hoverNode ? 0.08 : 0.25;
        return rgba(palette.link, fadeRef.current * base);
      },
      [hoverLinks, path, hoverNode, palette],
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

    useImperativeHandle(
      ref,
      () => ({
        fitView: () => fitTo(undefined, 500),
        zoomBy(factor) {
          const fg = fgRef.current;
          if (!fg) return;
          const k = fg.zoom();
          beginProgrammaticMove(300);
          fg.zoom(Math.max(0.05, Math.min(10, (typeof k === 'number' ? k : 1) * factor)), 300);
        },
        async exportPng() {
          const canvas = containerRef.current?.querySelector('canvas');
          return canvas ? canvasToPng(canvas, palette.background) : null;
        },
      }),
      [fitTo, beginProgrammaticMove, palette.background],
    );

    const hoverKind = hoverNode ? nodeKind(hoverNode) : null;

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
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 2, 0, 2 * Math.PI);
              ctx.fill();
            }}
            nodeLabel={() => ''}
            onNodeHover={(node) => handleNodeHover((node as NodeData) ?? null)}
            onNodeClick={(node) => onNodeClick(node as NodeData)}
            onBackgroundClick={onBackgroundClick}
            onZoom={handleZoom}
            onZoomEnd={handleZoomEnd}
            onEngineStop={handleEngineStop}
            onRenderFramePost={() => minimapRef.current?.redraw()}
            minZoom={0.05}
            maxZoom={10}
            linkColor={linkColor}
            linkWidth={hasLinkHighlight ? linkWidth : isLarge ? 0.5 : 0.8}
            linkDirectionalArrowLength={hasLinkHighlight ? arrowLength : 0}
            linkDirectionalArrowRelPos={0.92}
            d3AlphaDecay={isLarge ? 0.045 : 0.028}
            cooldownTime={isLarge ? 8000 : 15000}
          />
        )}

        {hoverNode && hoverKind && (
          <div className="floating hovercard" aria-hidden="true">
            <div className="hovercard__kind">
              <span className="dot" style={{ background: cssColorOf(hoverNode) }} />
              {KIND_LABEL[hoverKind].one}
              {hoverNode.language && ` in ${languageLabel(hoverNode.language)}`}
            </div>
            <div className="hovercard__name">{hoverNode.label}</div>
            <div className="hovercard__meta">
              {(index.out.get(hoverNode.id)?.length ?? 0) + (index.in.get(hoverNode.id)?.length ?? 0)} connections
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
  },
);
GraphView.displayName = 'GraphView';

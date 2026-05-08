import React, { useCallback, useState, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, NodeData, LinkData } from '../types';
import {
  createCrossingReductionForce,
  createDegreeMap,
  getCollisionRadius,
  getGraphChargeStrength,
  getGraphLinkDistance,
  getGraphLinkStrength,
  type SimLink,
  type SimNode,
} from '../utils/graphLayout';

interface GraphViewProps {
  graphData: GraphData;
  selectedNode: NodeData | null;
  onNodeSelect: (node: NodeData | null) => void;
  customWidthOffset?: number;
  colorMode: 'group' | 'language';
  onColorModeToggle: () => void;
}

type ZoomTransform = { x: number; y: number; k: number };
type LinkForceHandle = {
  distance: (distance: (link: SimLink) => number) => LinkForceHandle;
  strength: (strength: (link: SimLink) => number) => LinkForceHandle;
  iterations: (iterations: number) => LinkForceHandle;
  links: () => SimLink[];
};
type ChargeForceHandle = {
  strength: (strength: (node: SimNode) => number) => ChargeForceHandle;
};
type ForceGraphRef = ForceGraphMethods<NodeObject<NodeData>, LinkObject<NodeData, LinkData>>;

// Pre-parsed RGB tuples — avoids d3.color() object creation on every canvas frame
const TYPE_RGB: Record<string, readonly [number, number, number]> = {
  functions: [209, 154, 102],
  structs: [97, 175, 239],
  enums: [198, 120, 221],
  traits: [152, 195, 121],
  classes: [86, 182, 194],
  interfaces: [152, 195, 121],
  types: [224, 108, 117],
  default: [162, 167, 182],
};
const TYPE_RGB_BRIGHT: Record<string, readonly [number, number, number]> = {
  functions: [249, 183, 121],
  structs: [115, 209, 255],
  enums: [236, 143, 255],
  traits: [181, 233, 144],
  classes: [102, 217, 232],
  interfaces: [181, 233, 144],
  types: [255, 129, 140],
  default: [193, 199, 217],
};
const LANGUAGE_RGB: Record<string, readonly [number, number, number]> = {
  rust: [222, 165, 132],
  typescript: [0, 122, 204],
  javascript: [247, 223, 30],
  python: [114, 159, 207],
  default: [162, 167, 182],
};
const LANGUAGE_RGB_BRIGHT: Record<string, readonly [number, number, number]> = {
  rust: [255, 197, 158],
  typescript: [80, 180, 255],
  javascript: [255, 248, 100],
  python: [160, 200, 240],
  default: [193, 199, 217],
};
const HOVER_RGB: readonly [number, number, number] = [244, 214, 118];
const rgbaStr = (rgb: readonly [number, number, number], a: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

// Configuration
const CONFIG = {
  // Pan momentum
  panMinVelocity: 0.08,    // ความเร็วขั้นต่ำที่จะเริ่ม pan glide (px/ms)
  panFriction: 0.85,       // ค่าแรงเสียดทาน pan (0-1, ยิ่งใกล้ 1 ยิ่งไถลนาน)
  panMaxVelocity: 1.0,     // ความเร็วสูงสุด pan (px/ms)
  panSmoothing: 0.1,       // ค่า smoothing สำหรับ velocity (0-1)
  panStopThreshold: 0.05,  // ความเร็วที่จะหยุด glide
  // Smooth scroll zoom
  scrollZoomSpeed: 0.003, // ค่าความไวของ scroll zoom
  scrollZoomLerp: 0.12,    // ค่า lerp สำหรับ smooth zoom (0-1, ยิ่งต่ำยิ่ง smooth)
  // Shared
  frameInterval: 16,       // ~60fps
};

export const GraphView: React.FC<GraphViewProps> = ({ graphData, selectedNode, onNodeSelect, customWidthOffset = 0, colorMode, onColorModeToggle }) => {
  const [hoverNode, setHoverNode] = useState<NodeData | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<LinkData>>(new Set());
  const [showNodeNames, setShowNodeNames] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const fgRef = useRef<ForceGraphRef | undefined>(undefined);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ปรับแต่งแรงผลักและระยะห่างของ d3-force
  useEffect(() => {
    if (fgRef.current) {
      const nodes = graphData.nodes as SimNode[];
      const links = graphData.links as SimLink[];
      const sqrtNodeCount = Math.sqrt(Math.max(1, nodes.length));
      const degree = createDegreeMap(nodes, links);
      const chargeForce = fgRef.current.d3Force('charge') as unknown as ChargeForceHandle;
      const linkForce = fgRef.current.d3Force('link') as unknown as LinkForceHandle;

      chargeForce.strength((node: SimNode) => (
        getGraphChargeStrength(node, degree)
      ));
      linkForce
        .distance((link: SimLink) => getGraphLinkDistance(link, sqrtNodeCount))
        .strength((link: SimLink) => getGraphLinkStrength(link))
        .iterations(2);
      fgRef.current.d3Force('collide', d3.forceCollide<SimNode>()
        .radius((node) => getCollisionRadius(node))
        .iterations(1));
      fgRef.current.d3Force('x', d3.forceX(0).strength(0.012));
      fgRef.current.d3Force('y', d3.forceY(0).strength(0.012));
      fgRef.current.d3Force('crossReduce', createCrossingReductionForce(linkForce.links(), 3000));
      fgRef.current.d3ReheatSimulation?.();
    }
  }, [graphData.nodes, graphData.links]);

  const fadeOpacityRef = useRef(1.0);
  const fadeRequestId = useRef<number | null>(null);

  // Pan momentum refs
  const lastTransform = useRef<{ x: number; y: number; k: number; t: number } | null>(null);
  const velocity = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const isProgrammatic = useRef<boolean>(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentumAnimId = useRef<number | null>(null);
  const isUserInteracting = useRef<boolean>(false);

  // Smooth scroll zoom refs
  const containerRef = useRef<HTMLDivElement>(null);
  const targetZoom = useRef<number | null>(null);
  const smoothZoomAnimId = useRef<number | null>(null);
  // Cursor position for anchor-point zoom (screen coords relative to canvas)
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);

  const cancelMomentum = useCallback(() => {
    if (momentumAnimId.current !== null) {
      cancelAnimationFrame(momentumAnimId.current);
      momentumAnimId.current = null;
    }
  }, []);

  const cancelSmoothZoom = useCallback(() => {
    if (smoothZoomAnimId.current !== null) {
      cancelAnimationFrame(smoothZoomAnimId.current);
      smoothZoomAnimId.current = null;
    }
    targetZoom.current = null;
  }, []);

  const setProgrammatic = useCallback((duration: number) => {
    isProgrammatic.current = true;
    if (programmaticTimer.current) {
      clearTimeout(programmaticTimer.current);
    }
    programmaticTimer.current = setTimeout(() => {
      isProgrammatic.current = false;
      programmaticTimer.current = null;
    }, duration);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelMomentum();
      cancelSmoothZoom();
      if (programmaticTimer.current) {
        clearTimeout(programmaticTimer.current);
      }
    };
  }, [cancelMomentum, cancelSmoothZoom]);

  // Smooth scroll zoom: intercept wheel events on the CANVAS element (capture phase)
  // This runs before d3-zoom's handler, preventing the default discrete zoom behavior
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // We need to find the actual canvas element inside react-force-graph
    // and attach in the capture phase to intercept before d3-zoom
    let canvasEl: HTMLCanvasElement | null = null;

    const findCanvas = () => {
      canvasEl = container.querySelector('canvas');
      if (canvasEl) {
        canvasEl.addEventListener('wheel', handleWheel, { capture: true, passive: false });
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!fgRef.current || !canvasEl) return;

      // Stop d3-zoom from handling this wheel event
      e.preventDefault();
      e.stopImmediatePropagation();

      // Capture cursor position relative to the canvas for anchor-point zoom
      const rect = canvasEl.getBoundingClientRect();
      zoomAnchor.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      // Get current zoom level
      const currentZoom = fgRef.current.zoom();
      const k = typeof currentZoom === 'number' ? currentZoom : 1;

      // Initialize target from current if not set
      if (targetZoom.current === null) {
        targetZoom.current = k;
      }

      // Accumulate zoom delta in log-space for perceptually linear zoom
      const delta = -e.deltaY * CONFIG.scrollZoomSpeed;
      targetZoom.current = targetZoom.current * Math.exp(delta);
      targetZoom.current = Math.max(0.05, Math.min(10, targetZoom.current));

      // Start smooth animation if not already running
      if (smoothZoomAnimId.current === null) {
        const animateZoom = () => {
          if (!fgRef.current || targetZoom.current === null) {
            smoothZoomAnimId.current = null;
            return;
          }

          const cur = fgRef.current.zoom();
          const currentK = typeof cur === 'number' ? cur : 1;
          const target = targetZoom.current;

          // Lerp in log-space for perceptually smooth zoom
          const logCurrent = Math.log(currentK);
          const logTarget = Math.log(target);
          const logDiff = logTarget - logCurrent;

          // Close enough — snap and stop
          if (Math.abs(logDiff) < 0.001) {
            // Final snap with anchor adjustment
            if (zoomAnchor.current && typeof fgRef.current.screen2GraphCoords === 'function') {
              const graphBefore = fgRef.current.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
              isProgrammatic.current = true;
              fgRef.current.zoom(target, 0);
              const graphAfter = fgRef.current.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
              const center = fgRef.current.centerAt();
              if (center && graphBefore && graphAfter) {
                fgRef.current.centerAt(
                  center.x + (graphBefore.x - graphAfter.x),
                  center.y + (graphBefore.y - graphAfter.y),
                  0
                );
              }
              isProgrammatic.current = false;
            } else {
              isProgrammatic.current = true;
              fgRef.current.zoom(target, 0);
              isProgrammatic.current = false;
            }
            targetZoom.current = null;
            smoothZoomAnimId.current = null;
            zoomAnchor.current = null;
            return;
          }

          // Lerp in log-space then convert back
          const newLogK = logCurrent + logDiff * CONFIG.scrollZoomLerp;
          const newK = Math.exp(newLogK);

          // Anchor-point zoom: keep the graph point under cursor fixed
          if (zoomAnchor.current && typeof fgRef.current.screen2GraphCoords === 'function') {
            const graphBefore = fgRef.current.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
            isProgrammatic.current = true;
            fgRef.current.zoom(newK, 0);
            const graphAfter = fgRef.current.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
            const center = fgRef.current.centerAt();
            if (center && graphBefore && graphAfter) {
              fgRef.current.centerAt(
                center.x + (graphBefore.x - graphAfter.x),
                center.y + (graphBefore.y - graphAfter.y),
                0
              );
            }
            isProgrammatic.current = false;
          } else {
            isProgrammatic.current = true;
            fgRef.current.zoom(newK, 0);
            isProgrammatic.current = false;
          }

          smoothZoomAnimId.current = requestAnimationFrame(animateZoom);
        };

        smoothZoomAnimId.current = requestAnimationFrame(animateZoom);
      }
    };

    // Canvas may not exist yet on first render, use MutationObserver to find it
    const observer = new MutationObserver(() => {
      if (!canvasEl && container.querySelector('canvas')) {
        findCanvas();
        observer.disconnect();
      }
    });

    // Try immediately first
    if (container.querySelector('canvas')) {
      findCanvas();
    } else {
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
      if (canvasEl) {
        canvasEl.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
      }
      cancelSmoothZoom();
    };
  }, [cancelSmoothZoom]);

  // เอฟเฟกต์การซูมเมื่อเลือกโหนด (Zoom to Node)
  useEffect(() => {
    if (selectedNode && fgRef.current && selectedNode.x !== undefined && selectedNode.y !== undefined) {
      if (typeof fgRef.current.zoom === 'function' && typeof fgRef.current.centerAt === 'function') {
        cancelMomentum();
        cancelSmoothZoom();
        setProgrammatic(1100);
        fgRef.current.zoom(2.5, 1000);
        fgRef.current.centerAt(selectedNode.x, selectedNode.y, 1000);
      }
    }
  }, [selectedNode, cancelMomentum, cancelSmoothZoom, setProgrammatic]);

  // ฟังก์ชันคำนวณ Pan Velocity ระหว่างการลาก
  const handleZoom = useCallback((transform: ZoomTransform | null) => {
    if (isProgrammatic.current || !transform || typeof transform.x !== 'number') return;

    isUserInteracting.current = true;
    cancelMomentum();

    const now = performance.now();
    if (lastTransform.current) {
      const dt = now - lastTransform.current.t;
      if (dt > 0 && dt < 200) {
        const s = CONFIG.panSmoothing;
        const rawVx = (transform.x - lastTransform.current.x) / dt;
        const rawVy = (transform.y - lastTransform.current.y) / dt;
        velocity.current.vx = velocity.current.vx * (1 - s) + rawVx * s;
        velocity.current.vy = velocity.current.vy * (1 - s) + rawVy * s;

        // Clamp pan velocity
        const speed = Math.sqrt(velocity.current.vx ** 2 + velocity.current.vy ** 2);
        if (speed > CONFIG.panMaxVelocity) {
          const clamp = CONFIG.panMaxVelocity / speed;
          velocity.current.vx *= clamp;
          velocity.current.vy *= clamp;
        }
      } else if (dt >= 200) {
        velocity.current = { vx: 0, vy: 0 };
      }
    }
    lastTransform.current = { x: transform.x, y: transform.y, k: transform.k, t: now };
  }, [cancelMomentum]);

  // ฟังก์ชันคำนวณ Pan Momentum เมื่อหยุดลาก (Glide)
  const handleZoomEnd = useCallback((transform: ZoomTransform | null) => {
    isUserInteracting.current = false;

    if (isProgrammatic.current || !transform || !fgRef.current) {
      velocity.current = { vx: 0, vy: 0 };
      lastTransform.current = null;
      return;
    }

    // Check if user paused before releasing
    const now = performance.now();
    if (lastTransform.current && (now - lastTransform.current.t) > 80) {
      velocity.current = { vx: 0, vy: 0 };
      lastTransform.current = null;
      return;
    }

    const panSpeed = Math.sqrt(velocity.current.vx ** 2 + velocity.current.vy ** 2);

    if (panSpeed > CONFIG.panMinVelocity && isFinite(panSpeed)) {
      let vx = velocity.current.vx;
      let vy = velocity.current.vy;
      let lastFrameTime = performance.now();
      const graphEl = fgRef.current;

      const glideStep = () => {
        if (isUserInteracting.current) {
          momentumAnimId.current = null;
          return;
        }

        const currentTime = performance.now();
        const frameDt = currentTime - lastFrameTime;
        lastFrameTime = currentTime;

        // Frame-rate independent friction
        const friction = Math.pow(CONFIG.panFriction, frameDt / CONFIG.frameInterval);
        vx *= friction;
        vy *= friction;

        if (Math.sqrt(vx ** 2 + vy ** 2) < CONFIG.panStopThreshold) {
          momentumAnimId.current = null;
          return;
        }

        try {
          const currentZoom = graphEl.zoom();
          const k = typeof currentZoom === 'number' ? currentZoom : (transform.k || 1);
          const deltaX = (vx * frameDt) / k;
          const deltaY = (vy * frameDt) / k;

          const center = graphEl.centerAt();
          if (center && typeof center.x === 'number' && typeof center.y === 'number') {
            isProgrammatic.current = true;
            graphEl.centerAt(center.x + deltaX, center.y + deltaY, 0);
            isProgrammatic.current = false;
          } else {
            momentumAnimId.current = null;
            return;
          }
        } catch {
          momentumAnimId.current = null;
          return;
        }

        momentumAnimId.current = requestAnimationFrame(glideStep);
      };

      momentumAnimId.current = requestAnimationFrame(glideStep);
    }

    velocity.current = { vx: 0, vy: 0 };
    lastTransform.current = null;
  }, []);

  // Fade animation — writes to ref only, no setState, no React re-renders per frame
  useEffect(() => {
    const target = hoverNode ? 0.15 : 1.0;
    const step = 0.05;
    if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current);
    const animate = () => {
      const prev = fadeOpacityRef.current;
      const diff = target - prev;
      if (Math.abs(diff) < step) { fadeOpacityRef.current = target; fadeRequestId.current = null; return; }
      fadeOpacityRef.current = prev + (diff > 0 ? step : -step);
      fadeRequestId.current = requestAnimationFrame(animate);
    };
    fadeRequestId.current = requestAnimationFrame(animate);
    return () => { if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current); };
  }, [hoverNode]);

  const handleNodeHover = useCallback((node: NodeData | null) => {
    const newHighlightNodes = new Set<string>();
    const newHighlightLinks = new Set<LinkData>();

    if (node) {
      newHighlightNodes.add(node.id);
      graphData.links.forEach((link) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (sourceId === node.id || targetId === node.id) {
          newHighlightLinks.add(link);
          newHighlightNodes.add(sourceId);
          newHighlightNodes.add(targetId);
        }
      });
    }

    setHoverNode(node || null);
    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
  }, [graphData.links]);

  const paintNode = useCallback((node: SimNode, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = Math.sqrt(node.val || 1) * 1.3;
    const isHighlighted = highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoverNode?.id === node.id;
    const isNeighbor = hoverNode && isHighlighted && !isHovered;

    const palette = colorMode === 'language' ? LANGUAGE_RGB : TYPE_RGB;
    const paletteBright = colorMode === 'language' ? LANGUAGE_RGB_BRIGHT : TYPE_RGB_BRIGHT;
    const key = colorMode === 'language' ? node.language : node.group;

    const rgb = (isSelected || isHovered)
      ? HOVER_RGB
      : isNeighbor
        ? (paletteBright[key] ?? paletteBright.default)
        : (palette[key] ?? palette.default);

    const fill = rgbaStr(rgb, isHighlighted ? 1 : fadeOpacityRef.current);

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = fill;
    ctx.fill();

    if (showNodeNames || isHighlighted || isSelected) {
      const label = (isHighlighted || isSelected) ? node.label : (node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label);
      const fontSize = Math.max(5, 11 - (label.length * 0.25));
      ctx.font = `normal ${fontSize}px Inter, sans-serif`;

      // const textWidth = ctx.measureText(label).width;
      // const boxWidth = textWidth + 10;
      // const boxHeight = fontSize + 7;
      // const boxX = x - boxWidth / 2;
      // const boxY = y + radius + 4;

      // ctx.beginPath();
      // ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
      // ctx.fillStyle = rgbaStr([13, 17, 23], isHighlighted || isSelected ? 0.9 : 0.72);
      // ctx.fill();
      // ctx.strokeStyle = rgbaStr(rgb, isHighlighted || isSelected ? 0.65 : 0.28);
      // ctx.lineWidth = 0.8 / Math.max(globalScale, 0.8);
      // ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // ctx.textBaseline = 'middle';
      ctx.fillStyle = fill;
      ctx.fillText(label, x, y + radius + 1.5);
      // ctx.fillText(label, x, boxY + boxHeight / 2 + 0.5);
    }
  }, [hoverNode, highlightNodes, selectedNode, showNodeNames, colorMode]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        zIndex: 12,
        display: 'flex',
        gap: '10px'
      }}>
        <button
          type="button"
          onClick={onColorModeToggle}
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '999px',
            background: 'rgba(22, 22, 24, 0.82)',
            color: '#a2a7b6',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '7px 12px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}
        >
          Color: {colorMode === 'group' ? 'Type' : 'Language'}
        </button>

        <button
          type="button"
          aria-pressed={showNodeNames}
          onClick={() => setShowNodeNames(prev => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '999px',
            background: 'rgba(22, 22, 24, 0.82)',
            color: '#a2a7b6',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '7px 8px 7px 11px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}
        >
          <span>Names</span>
          <span
            style={{
              width: '34px',
              height: '18px',
              borderRadius: '999px',
              background: showNodeNames ? 'rgba(244, 214, 118, 0.9)' : 'rgba(100, 116, 139, 0.45)',
              position: 'relative',
              transition: 'background 0.18s ease'
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '3px',
                left: showNodeNames ? '19px' : '3px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: showNodeNames ? '#161618' : '#cbd5e1',
                transition: 'left 0.18s ease, background 0.18s ease'
              }}
            />
          </span>
        </button>
      </div>
      {hoverNode && (
        <div
          style={{
            position: 'absolute',
            right: 20,
            bottom: 20,
            zIndex: 12,
            maxWidth: '280px',
            background: 'rgba(13, 17, 23, 0.94)',
            padding: '9px 12px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
            fontFamily: 'Inter, sans-serif'
          }}
        >
          <div style={{ color: '#8b949e', fontSize: '0.68rem', marginBottom: '3px', textTransform: 'uppercase' }}>
            {hoverNode.group}
          </div>
          <div style={{ color: '#e6edf3', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
            {hoverNode.label}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.68rem', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Language: <span style={{ color: '#cbd5e1' }}>{hoverNode.language}</span>
          </div>
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        width={windowWidth - customWidthOffset - 260}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodeLabel={() => ""}
        onNodeHover={handleNodeHover}
        onNodeClick={(node) => onNodeSelect(node as NodeData)}
        onBackgroundClick={() => onNodeSelect(null)}
        onZoom={handleZoom}
        onZoomEnd={handleZoomEnd}
        minZoom={0.05}
        maxZoom={10}
        linkColor={(link) => {
          const isHighlighted = highlightLinks.has(link as LinkData);
          return `rgba(162,167,182,${isHighlighted ? 0.8 : fadeOpacityRef.current * 0.25})`;
        }}
        linkWidth={(link) => highlightLinks.has(link as LinkData) ? 2.0 : 0.8}
        d3AlphaDecay={0.02}
      />
    </div>
  );
};

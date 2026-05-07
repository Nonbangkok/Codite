import React, { useCallback, useState, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3';
import type { GraphData, NodeData, LinkData } from '../types';

interface GraphViewProps {
  graphData: GraphData;
  selectedNode: NodeData | null;
  onNodeSelect: (node: NodeData | null) => void;
  customWidthOffset?: number;
}

const TYPE_COLORS: Record<string, string> = {
  functions: '#d19a66', // Peach/Orange
  structs: '#61afef',   // Blue
  enums: '#c678dd',     // Purple
  traits: '#98c379',    // Green
  default: '#a2a7b6'    // Grey-blue for files/others
};

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

export const GraphView: React.FC<GraphViewProps> = ({ graphData, selectedNode, onNodeSelect, customWidthOffset = 0 }) => {
  const [hoverNode, setHoverNode] = useState<NodeData | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<LinkData>>(new Set());
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const fgRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ปรับแต่งแรงผลักและระยะห่างของ d3-force
  useEffect(() => {
    if (fgRef.current) {
      const n = graphData.nodes.length;
      const sqrtN = Math.sqrt(Math.max(1, n));
      // Stronger repulsion with more nodes; distanceMax scales so distant clusters still spread
      const chargeStrength = -Math.max(400, 75 * sqrtN);
      const distanceMax = Math.max(500, 55 * sqrtN);
      // Leaf nodes cluster tightly; file-to-file edges get more room in larger graphs
      const leafDist = Math.max(30, 80 - sqrtN * 1.5);
      const fileDist = Math.max(100, 60 + sqrtN * 4);

      fgRef.current.d3Force('charge').strength(chargeStrength).distanceMax(distanceMax);
      fgRef.current.d3Force('link').distance((link: any) => {
        const src = link.source;
        const tgt = link.target;
        const srcGroup = typeof src === 'object' ? src.group : null;
        const tgtGroup = typeof tgt === 'object' ? tgt.group : null;
        const isLeafLink = srcGroup === 'functions' || tgtGroup === 'functions'
          || srcGroup === 'structs' || tgtGroup === 'structs'
          || srcGroup === 'enums' || tgtGroup === 'enums'
          || srcGroup === 'traits' || tgtGroup === 'traits';
        return isLeafLink ? leafDist : fileDist;
      });
      fgRef.current.d3Force('collide', d3.forceCollide().radius((node: any) => {
        const radius = Math.sqrt(node.val || 1) * 2;
        return radius + 25;
      }));
    }
  }, [graphData.nodes.length]);

  const [fadeOpacity, setFadeOpacity] = useState(1.0);
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
  const handleZoom = useCallback((transform: any) => {
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
  const handleZoomEnd = useCallback((transform: any) => {
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

  // Fade animation for hover effect
  useEffect(() => {
    const target = hoverNode ? 0.15 : 1.0;
    const step = 0.05;

    const animate = () => {
      setFadeOpacity(prev => {
        if (Math.abs(prev - target) < step) return target;
        return prev + (target > prev ? step : -step);
      });
      fadeRequestId.current = requestAnimationFrame(animate);
    };

    if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current);
    fadeRequestId.current = requestAnimationFrame(animate);

    return () => {
      if (fadeRequestId.current) cancelAnimationFrame(fadeRequestId.current);
    };
  }, [hoverNode]);

  const handleNodeHover = useCallback((node: NodeData | null) => {
    const newHighlightNodes = new Set<string>();
    const newHighlightLinks = new Set<LinkData>();

    if (node) {
      newHighlightNodes.add(node.id);
      graphData.links.forEach((link: any) => {
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

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label;
    const fontSize = 10;
    const radius = Math.sqrt(node.val || 1) * 2;

    const isHighlighted = highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoverNode?.id === node.id;
    const isNeighbor = hoverNode && highlightNodes.has(node.id) && !isHovered;

    // กำหนดสีตามประเภทของโหนด
    const baseColor = TYPE_COLORS[node.group] || TYPE_COLORS.default;

    let color = baseColor;
    if (isSelected || isHovered) {
      color = '#f4d676';
    } else if (isNeighbor) {
      color = d3.color(baseColor)?.brighter(0.5).toString() || baseColor;
    }

    const opacity = isHighlighted ? 1 : fadeOpacity;

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = d3.color(color)?.copy({ opacity }).toString() || color;
    ctx.fill();

    if (globalScale > 0.6 || isHighlighted || isSelected) {
      ctx.font = `normal ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = d3.color(color)?.copy({ opacity }).toString() || color;
      ctx.fillText(label, node.x, node.y + radius + 1.5);
    }
  }, [hoverNode, highlightNodes, selectedNode, fadeOpacity]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
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
          const opacity = isHighlighted ? 0.8 : (fadeOpacity * 0.25);
          return `rgba(162, 167, 182, ${opacity})`;
        }}
        linkWidth={(link) => highlightLinks.has(link as LinkData) ? 2.0 : 0.8}
        d3AlphaDecay={0.02}
        cooldownTicks={100}
      />
    </div>
  );
};

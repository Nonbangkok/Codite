import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import type { NodeData } from '../../types';

const WIDTH = 176;
const HEIGHT = 120;
const PAD = 8;
const THROTTLE_MS = 120;

export interface MinimapHandle {
  redraw(): void;
}

interface MinimapProps {
  nodes: readonly NodeData[];
  colorOf: (node: NodeData) => string;
  viewportColor: string;
  /** Graph-space rectangle currently on screen, or null when unknown. */
  getViewport: () => { x0: number; y0: number; x1: number; y1: number } | null;
  onNavigate: (x: number, y: number) => void;
}

type Bounds = { minX: number; minY: number; scale: number; offX: number; offY: number };

/** Overview of the whole layout with the visible area outlined. Click to jump there. */
export const Minimap = forwardRef<MinimapHandle, MinimapProps>(
  ({ nodes, colorOf, viewportColor, getViewport, onNavigate }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastDraw = useRef(0);
    const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bounds = useRef<Bounds | null>(null);

    const draw = useCallback(() => {
      lastDraw.current = performance.now();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== WIDTH * dpr) {
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        minX = Math.min(minX, n.x!);
        maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!);
        maxY = Math.max(maxY, n.y!);
      }
      if (!Number.isFinite(minX)) {
        bounds.current = null;
        return;
      }
      // Include the visible area so its outline stays on the map when zoomed out.
      const vp = getViewport();
      if (vp) {
        minX = Math.min(minX, vp.x0);
        minY = Math.min(minY, vp.y0);
        maxX = Math.max(maxX, vp.x1);
        maxY = Math.max(maxY, vp.y1);
      }
      const w = Math.max(maxX - minX, 1);
      const h = Math.max(maxY - minY, 1);
      const scale = Math.min((WIDTH - PAD * 2) / w, (HEIGHT - PAD * 2) / h);
      const offX = (WIDTH - w * scale) / 2;
      const offY = (HEIGHT - h * scale) / 2;
      bounds.current = { minX, minY, scale, offX, offY };

      for (const n of nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        ctx.fillStyle = colorOf(n);
        ctx.fillRect(offX + (n.x! - minX) * scale - 1, offY + (n.y! - minY) * scale - 1, 2, 2);
      }

      if (vp) {
        ctx.strokeStyle = viewportColor;
        ctx.lineWidth = 1.25;
        const x = offX + (vp.x0 - minX) * scale;
        const y = offY + (vp.y0 - minY) * scale;
        ctx.strokeRect(x, y, (vp.x1 - vp.x0) * scale, (vp.y1 - vp.y0) * scale);
      }
    }, [nodes, colorOf, viewportColor, getViewport]);

    useImperativeHandle(
      ref,
      () => ({
        redraw() {
          if (performance.now() - lastDraw.current >= THROTTLE_MS) {
            draw();
          } else if (!trailing.current) {
            trailing.current = setTimeout(() => {
              trailing.current = null;
              draw();
            }, THROTTLE_MS);
          }
        },
      }),
      [draw],
    );

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const b = bounds.current;
      if (!b) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - b.offX) / b.scale + b.minX;
      const y = (e.clientY - rect.top - b.offY) / b.scale + b.minY;
      onNavigate(x, y);
    };

    return (
      <div className="floating minimap" aria-hidden="true" title="Overview — click to move there">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ width: WIDTH, height: HEIGHT }} onClick={handleClick} />
      </div>
    );
  },
);
Minimap.displayName = 'Minimap';

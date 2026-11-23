import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** The subset of react-force-graph's imperative API the camera needs. */
export interface CameraTarget {
  zoom(): number;
  zoom(k: number, ms?: number): unknown;
  centerAt(): { x: number; y: number };
  centerAt(x?: number, y?: number, ms?: number): unknown;
  screen2GraphCoords(x: number, y: number): { x: number; y: number };
}

type ZoomTransform = { x: number; y: number; k: number };

const CONFIG = {
  panMinVelocity: 0.08, // px/ms needed to start a glide
  panFriction: 0.85, // 0-1, closer to 1 glides longer
  panMaxVelocity: 1.0, // px/ms
  panSmoothing: 0.1, // velocity smoothing factor
  panStopThreshold: 0.05,
  scrollZoomSpeed: 0.003,
  scrollZoomLerp: 0.12, // lower = smoother
  frameInterval: 16,
  minZoom: 0.05,
  maxZoom: 10,
};

/**
 * Smooth anchor-point wheel zoom plus inertial panning for a react-force-graph canvas.
 * Returns handlers for ForceGraph's onZoom/onZoomEnd and helpers for programmatic moves.
 */
export const useGraphCamera = (
  containerRef: RefObject<HTMLDivElement | null>,
  graphRef: RefObject<CameraTarget | undefined>,
) => {
  const lastTransform = useRef<(ZoomTransform & { t: number }) | null>(null);
  const velocity = useRef({ vx: 0, vy: 0 });
  const isProgrammatic = useRef(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentumAnimId = useRef<number | null>(null);
  const isUserInteracting = useRef(false);
  const targetZoom = useRef<number | null>(null);
  const smoothZoomAnimId = useRef<number | null>(null);
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

  /** Marks camera changes in the next `duration` ms as ours so they don't feed pan momentum. */
  const setProgrammatic = useCallback((duration: number) => {
    isProgrammatic.current = true;
    if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
    programmaticTimer.current = setTimeout(() => {
      isProgrammatic.current = false;
      programmaticTimer.current = null;
    }, duration);
  }, []);

  /** Stops any glide/zoom animation before a programmatic camera move of `duration` ms. */
  const beginProgrammaticMove = useCallback(
    (duration: number) => {
      cancelMomentum();
      cancelSmoothZoom();
      setProgrammatic(duration + 100);
    },
    [cancelMomentum, cancelSmoothZoom, setProgrammatic],
  );

  useEffect(
    () => () => {
      cancelMomentum();
      cancelSmoothZoom();
      if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
    },
    [cancelMomentum, cancelSmoothZoom],
  );

  // Zoom keeping the graph point under the cursor fixed.
  const zoomAround = useCallback(
    (k: number) => {
      const fg = graphRef.current;
      if (!fg) return;
      isProgrammatic.current = true;
      if (zoomAnchor.current) {
        const before = fg.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
        fg.zoom(k, 0);
        const after = fg.screen2GraphCoords(zoomAnchor.current.x, zoomAnchor.current.y);
        const center = fg.centerAt();
        if (center && before && after) {
          fg.centerAt(center.x + (before.x - after.x), center.y + (before.y - after.y), 0);
        }
      } else {
        fg.zoom(k, 0);
      }
      isProgrammatic.current = false;
    },
    [graphRef],
  );

  // Intercept wheel events on the canvas (capture phase) before d3-zoom's discrete zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let canvasEl: HTMLCanvasElement | null = null;

    const animateZoom = () => {
      const fg = graphRef.current;
      if (!fg || targetZoom.current === null) {
        smoothZoomAnimId.current = null;
        return;
      }
      const current = fg.zoom();
      const currentK = typeof current === 'number' ? current : 1;
      const target = targetZoom.current;
      const logDiff = Math.log(target) - Math.log(currentK);

      if (Math.abs(logDiff) < 0.001) {
        zoomAround(target);
        targetZoom.current = null;
        smoothZoomAnimId.current = null;
        zoomAnchor.current = null;
        return;
      }
      zoomAround(Math.exp(Math.log(currentK) + logDiff * CONFIG.scrollZoomLerp));
      smoothZoomAnimId.current = requestAnimationFrame(animateZoom);
    };

    const handleWheel = (e: WheelEvent) => {
      const fg = graphRef.current;
      if (!fg || !canvasEl) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const rect = canvasEl.getBoundingClientRect();
      zoomAnchor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const current = fg.zoom();
      if (targetZoom.current === null) targetZoom.current = typeof current === 'number' ? current : 1;
      targetZoom.current *= Math.exp(-e.deltaY * CONFIG.scrollZoomSpeed);
      targetZoom.current = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, targetZoom.current));

      if (smoothZoomAnimId.current === null) smoothZoomAnimId.current = requestAnimationFrame(animateZoom);
    };

    const attach = () => {
      canvasEl = container.querySelector('canvas');
      canvasEl?.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    };

    // The canvas may not exist on first render.
    const observer = new MutationObserver(() => {
      if (!canvasEl && container.querySelector('canvas')) {
        attach();
        observer.disconnect();
      }
    });
    if (container.querySelector('canvas')) attach();
    else observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      canvasEl?.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
      cancelSmoothZoom();
    };
  }, [containerRef, graphRef, zoomAround, cancelSmoothZoom]);

  // Track pan velocity while dragging.
  const handleZoom = useCallback(
    (transform: ZoomTransform | null) => {
      if (isProgrammatic.current || !transform || typeof transform.x !== 'number') return;
      isUserInteracting.current = true;
      cancelMomentum();

      const now = performance.now();
      const last = lastTransform.current;
      if (last) {
        const dt = now - last.t;
        if (dt > 0 && dt < 200) {
          const s = CONFIG.panSmoothing;
          velocity.current.vx = velocity.current.vx * (1 - s) + ((transform.x - last.x) / dt) * s;
          velocity.current.vy = velocity.current.vy * (1 - s) + ((transform.y - last.y) / dt) * s;
          const speed = Math.hypot(velocity.current.vx, velocity.current.vy);
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
    },
    [cancelMomentum],
  );

  // Glide after the user releases a fast drag.
  const handleZoomEnd = useCallback(
    (transform: ZoomTransform | null) => {
      isUserInteracting.current = false;
      const fg = graphRef.current;
      const reset = () => {
        velocity.current = { vx: 0, vy: 0 };
        lastTransform.current = null;
      };
      if (isProgrammatic.current || !transform || !fg) return reset();
      if (lastTransform.current && performance.now() - lastTransform.current.t > 80) return reset();

      const speed = Math.hypot(velocity.current.vx, velocity.current.vy);
      if (speed > CONFIG.panMinVelocity && Number.isFinite(speed)) {
        let { vx, vy } = velocity.current;
        let lastFrame = performance.now();
        const step = () => {
          if (isUserInteracting.current) {
            momentumAnimId.current = null;
            return;
          }
          const now = performance.now();
          const dt = now - lastFrame;
          lastFrame = now;
          const friction = Math.pow(CONFIG.panFriction, dt / CONFIG.frameInterval);
          vx *= friction;
          vy *= friction;
          if (Math.hypot(vx, vy) < CONFIG.panStopThreshold) {
            momentumAnimId.current = null;
            return;
          }
          const current = fg.zoom();
          const k = typeof current === 'number' ? current : transform.k || 1;
          const center = fg.centerAt();
          if (!center || typeof center.x !== 'number') {
            momentumAnimId.current = null;
            return;
          }
          isProgrammatic.current = true;
          fg.centerAt(center.x + (vx * dt) / k, center.y + (vy * dt) / k, 0);
          isProgrammatic.current = false;
          momentumAnimId.current = requestAnimationFrame(step);
        };
        momentumAnimId.current = requestAnimationFrame(step);
      }
      reset();
    },
    [graphRef],
  );

  return { handleZoom, handleZoomEnd, beginProgrammaticMove };
};

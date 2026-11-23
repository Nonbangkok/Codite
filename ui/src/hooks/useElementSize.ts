import { useEffect, useState, type RefObject } from 'react';

/** Tracks an element's content size with ResizeObserver. */
export const useElementSize = (ref: RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) =>
        Math.round(prev.width) === Math.round(width) && Math.round(prev.height) === Math.round(height)
          ? prev
          : { width: Math.round(width), height: Math.round(height) },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
};

import { useCallback, useState } from 'react';

/** useState that is saved to localStorage. Invalid or unavailable storage falls back to `initial`. */
export const usePersistentState = <T,>(key: string, initial: T, isValid: (value: unknown) => boolean) => {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) return typeof initial === 'object' && initial !== null ? { ...initial, ...(parsed as object) } as T : (parsed as T);
      }
    } catch {
      // ignore unreadable storage
    }
    return initial;
  });

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // storage full or blocked: keep the in-memory value
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
};

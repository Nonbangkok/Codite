import { useCallback, useEffect, useRef } from 'react';
import { buildSearchIndex, searchIndex, type SearchFile, type TextHit } from '../utils/codeSearch';

export interface SearchResult {
  hits: TextHit[];
  total: number;
}

/**
 * Full-text search over file contents. Indexing and scanning run in a Web Worker so typing stays
 * responsive on large repositories; environments without workers search inline.
 */
export const useCodeSearch = (files: SearchFile[]) => {
  const workerRef = useRef<Worker | null>(null);
  const inlineIndex = useRef(buildSearchIndex([]));
  const pending = useRef(new Map<number, (r: SearchResult) => void>());
  const nextId = useRef(0);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('../workers/codeSearch.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<SearchResult & { id: number }>) => {
        pending.current.get(e.data.id)?.({ hits: e.data.hits, total: e.data.total });
        pending.current.delete(e.data.id);
      };
      workerRef.current = worker;
      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (workerRef.current) workerRef.current.postMessage({ type: 'index', files });
    else inlineIndex.current = buildSearchIndex(files);
  }, [files]);

  return useCallback((query: string): Promise<SearchResult> => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(searchIndex(inlineIndex.current, query));
    const id = ++nextId.current;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.postMessage({ type: 'query', id, query });
    });
  }, []);
};

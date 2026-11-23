/// <reference lib="webworker" />
import { buildSearchIndex, searchIndex, type SearchFile, type SearchIndex } from '../utils/codeSearch';

type Request = { type: 'index'; files: SearchFile[] } | { type: 'query'; id: number; query: string };

let index: SearchIndex = { files: [] };

self.onmessage = (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (msg.type === 'index') {
    index = buildSearchIndex(msg.files);
  } else {
    const result = searchIndex(index, msg.query);
    (self as unknown as Worker).postMessage({ id: msg.id, ...result });
  }
};

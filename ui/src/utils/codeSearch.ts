/** Full-text search across source files. Runs in a worker for large repos, inline in tests. */

export interface SearchFile {
  id: string;
  code: string;
}

export interface TextHit {
  nodeId: string;
  /** 1-based line in the file. */
  line: number;
  /** 0-based column of the match within the line. */
  column: number;
  /** The line, trimmed and shortened around the match. */
  preview: string;
  matchStart: number;
  matchLength: number;
}

export const MAX_HITS = 200;
const PREVIEW = 120;

export interface SearchIndex {
  files: { id: string; lines: string[]; lower: string[] }[];
}

export const buildSearchIndex = (files: SearchFile[]): SearchIndex => ({
  files: files.map((f) => {
    const lines = f.code.split('\n');
    return { id: f.id, lines, lower: lines.map((l) => l.toLowerCase()) };
  }),
});

/** Case-insensitive substring search; returns hits in file order, capped at MAX_HITS. */
export const searchIndex = (index: SearchIndex, query: string, limit = MAX_HITS): { hits: TextHit[]; total: number } => {
  const q = query.trim().toLowerCase();
  const hits: TextHit[] = [];
  let total = 0;
  if (q.length < 2) return { hits, total };
  for (const file of index.files) {
    for (let i = 0; i < file.lower.length; i++) {
      const col = file.lower[i].indexOf(q);
      if (col < 0) continue;
      total++;
      if (hits.length >= limit) continue;
      const line = file.lines[i];
      const indent = line.length - line.trimStart().length;
      // Keep the preview centred on the match.
      const start = Math.max(indent, Math.min(col - 30, line.length - PREVIEW));
      const preview = line.slice(start, start + PREVIEW);
      hits.push({
        nodeId: file.id,
        line: i + 1,
        column: col,
        preview: (start > indent ? '…' : '') + preview,
        matchStart: col - start + (start > indent ? 1 : 0),
        matchLength: q.length,
      });
    }
  }
  return { hits, total };
};

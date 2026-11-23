import type { NodeData } from '../types';
import { fileIdOf, isSymbolId } from './nodeKinds';

/**
 * 1-based line where a symbol starts inside its file, or null when it cannot be located.
 * Prefers the symbol's own snippet; falls back to the byte offset some IDs end with.
 */
export const symbolStartLine = (symbol: NodeData, fileCode: string | undefined): number | null => {
  if (!fileCode || !isSymbolId(symbol.id)) return null;

  let index = -1;
  const snippet = symbol.code?.trim();
  if (snippet) {
    index = fileCode.indexOf(snippet.split('\n')[0]);
  }
  if (index < 0) {
    const offset = Number(symbol.id.split('::').pop());
    if (Number.isInteger(offset) && offset >= 0) {
      // IDs carry byte offsets; decode the prefix to get a character index.
      const bytes = new TextEncoder().encode(fileCode);
      if (offset <= bytes.length) index = new TextDecoder().decode(bytes.slice(0, offset)).length;
    }
  }
  if (index < 0) return null;

  let line = 1;
  for (let i = 0; i < index; i++) if (fileCode.charCodeAt(i) === 10) line++;
  return line;
};

/** Path inside the repository (node IDs are prefixed with the scanned folder name). */
export const repoRelativePath = (id: string): string => {
  const file = fileIdOf(id);
  const slash = file.indexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : '';
};

/** GitHub URL for a node of a scanned `owner/repo`, pointing at the default branch. */
export const githubUrl = (repo: string, node: NodeData, line: number | null, endLine?: number | null): string => {
  const path = repoRelativePath(node.id);
  const base = `https://github.com/${repo}`;
  if (!path) return base;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  if (node.group === 'folders') return `${base}/tree/HEAD/${encoded}`;
  const anchor = line ? (endLine && endLine > line ? `#L${line}-L${endLine}` : `#L${line}`) : '';
  return `${base}/blob/HEAD/${encoded}${anchor}`;
};

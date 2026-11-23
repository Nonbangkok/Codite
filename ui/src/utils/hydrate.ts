import type { NodeData } from '../types';

/**
 * Fills in source code that the analyzer stored separately (`data.code.json`): files get their
 * code from the map, symbols are cut from their file by `start_line`/`end_line`.
 * Mutates the node objects in place because the graph simulation holds on to them.
 * Returns how many nodes received code.
 */
export const hydrateCode = (nodes: NodeData[], codeByFile: Record<string, string>): number => {
  let filled = 0;
  const lines = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.code || node.id.includes('::')) continue;
    const code = codeByFile[node.id];
    if (typeof code === 'string') {
      node.code = code;
      filled++;
    }
  }
  for (const node of nodes) {
    if (node.code || !node.id.includes('::') || !node.start_line || !node.end_line) continue;
    const fileId = node.id.split('::')[0];
    const source = codeByFile[fileId];
    if (typeof source !== 'string') continue;
    if (!lines.has(fileId)) lines.set(fileId, source.split('\n'));
    node.code = lines.get(fileId)!.slice(node.start_line - 1, node.end_line).join('\n');
    filled++;
  }
  return filled;
};

/** True when the graph was written with its code split into a separate file. */
export const needsCode = (nodes: readonly NodeData[]) => nodes.some((n) => !n.id.includes('::') && n.code === undefined);

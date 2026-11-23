import type { NodeData } from '../types';

/** What a node represents. Files carry their parent folder in `group`, so kind is derived. */
export type NodeKind =
  | 'files'
  | 'folders'
  | 'functions'
  | 'classes'
  | 'structs'
  | 'interfaces'
  | 'traits'
  | 'enums'
  | 'types'
  | 'imports';

const SYMBOL_KINDS = new Set<NodeKind>([
  'functions',
  'classes',
  'structs',
  'interfaces',
  'traits',
  'enums',
  'types',
  'imports',
]);

/** Display order for legends and filters. */
export const KIND_ORDER: readonly NodeKind[] = [
  'folders',
  'files',
  'functions',
  'classes',
  'structs',
  'interfaces',
  'traits',
  'enums',
  'types',
  'imports',
];

export const KIND_LABEL: Record<NodeKind, { one: string; many: string }> = {
  files: { one: 'File', many: 'Files' },
  folders: { one: 'Folder', many: 'Folders' },
  functions: { one: 'Function', many: 'Functions' },
  classes: { one: 'Class', many: 'Classes' },
  structs: { one: 'Struct', many: 'Structs' },
  interfaces: { one: 'Interface', many: 'Interfaces' },
  traits: { one: 'Trait', many: 'Traits' },
  enums: { one: 'Enum', many: 'Enums' },
  types: { one: 'Type', many: 'Types' },
  imports: { one: 'Import', many: 'Imports' },
};

export const LANGUAGE_LABEL: Record<string, string> = {
  rust: 'Rust',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
};

export const languageLabel = (language: string): string =>
  LANGUAGE_LABEL[language] ?? (language ? language[0].toUpperCase() + language.slice(1) : 'Other');

export const nodeKind = (node: Pick<NodeData, 'group'>): NodeKind => {
  if (node.group === 'folders') return 'folders';
  return SYMBOL_KINDS.has(node.group as NodeKind) ? (node.group as NodeKind) : 'files';
};

/** Symbols live inside files and have IDs like `path/to/file.ts::fn::name::123`. */
export const isSymbolId = (id: string): boolean => id.includes('::');

export const fileIdOf = (id: string): string => id.split('::')[0];

export interface CountedKey {
  key: string;
  count: number;
}

/** Counts nodes by kind (in KIND_ORDER) or by language (most common first). */
export const countBy = (nodes: readonly NodeData[], mode: 'kind' | 'language'): CountedKey[] => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = mode === 'kind' ? nodeKind(node) : node.language || 'other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].map(([key, count]) => ({ key, count }));
  if (mode === 'kind') {
    return entries.sort((a, b) => KIND_ORDER.indexOf(a.key as NodeKind) - KIND_ORDER.indexOf(b.key as NodeKind));
  }
  return entries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

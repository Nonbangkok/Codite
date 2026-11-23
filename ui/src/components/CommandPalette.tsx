import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Box, Columns2, File, FileSearch, Folder, FunctionSquare, History, Layers, Route, Search, TerminalSquare, Zap } from 'lucide-react';
import type { NodeData } from '../types';
import { nodeKind, type NodeKind } from '../utils/nodeKinds';
import type { TextHit } from '../utils/codeSearch';
import type { SearchResult } from '../hooks/useCodeSearch';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words to match, e.g. synonyms. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

export type PaletteMode = 'search' | 'path' | 'compare';

interface CommandPaletteProps {
  nodes: NodeData[];
  mode?: PaletteMode;
  /** The node a path or comparison starts from. */
  from?: NodeData | null;
  recent?: NodeData[];
  commands?: PaletteCommand[];
  searchText?: (query: string) => Promise<SearchResult>;
  nodesById?: ReadonlyMap<string, NodeData>;
  initialQuery?: string;
  onSelect: (node: NodeData) => void;
  onOpenText?: (hit: TextHit) => void;
  onClose: () => void;
}

const KIND_ICON: Record<NodeKind, React.ElementType> = {
  files: File,
  folders: Folder,
  functions: FunctionSquare,
  classes: Box,
  structs: Box,
  interfaces: Zap,
  traits: Zap,
  enums: Layers,
  types: Layers,
  imports: File,
};

const MAX_RESULTS = 30;

interface Row {
  key: string;
  icon: React.ElementType;
  label: React.ReactNode;
  sub?: React.ReactNode;
  shortcut?: string;
  run: () => void;
}

export const CommandPalette = ({
  nodes,
  mode = 'search',
  from,
  recent = [],
  commands = [],
  searchText,
  nodesById,
  initialQuery = '',
  onSelect,
  onOpenText,
  onClose,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [text, setText] = useState<SearchResult & { query: string }>({ hits: [], total: 0, query: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const isCommand = mode === 'search' && query.startsWith('>');
  const isText = mode === 'search' && query.startsWith('#') && !!searchText;
  const term = isCommand || isText ? query.slice(1).trim() : query;

  const candidates = useMemo(() => (from ? nodes.filter((n) => n.id !== from.id) : nodes), [nodes, from]);
  const fuse = useMemo(() => new Fuse(candidates, { keys: ['label', 'id'], threshold: 0.4 }), [candidates]);
  const commandFuse = useMemo(() => new Fuse(commands, { keys: ['label', 'keywords'], threshold: 0.4 }), [commands]);

  // Full-text search is async (worker) and debounced.
  useEffect(() => {
    if (!isText || !searchText) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchText(term).then((r) => !cancelled && setText({ ...r, query: term }));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isText, term, searchText]);

  const chooseNode = (node: NodeData) => {
    onSelect(node);
    onClose();
  };

  const rows: Row[] = useMemo(() => {
    if (isCommand) {
      const list = term ? commandFuse.search(term).map((r) => r.item) : commands;
      return list.map((c) => ({ key: c.id, icon: TerminalSquare, label: c.label, shortcut: c.shortcut, run: () => (onClose(), c.run()) }));
    }
    if (isText) {
      if (text.query !== term) return [];
      return text.hits.map((hit) => {
        const file = nodesById?.get(hit.nodeId);
        return {
          key: `${hit.nodeId}:${hit.line}:${hit.column}`,
          icon: FileSearch,
          label: (
            <span className="palette__code">
              {hit.preview.slice(0, hit.matchStart)}
              <mark>{hit.preview.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>
              {hit.preview.slice(hit.matchStart + hit.matchLength)}
            </span>
          ),
          sub: `${file?.label ?? hit.nodeId}, line ${hit.line}`,
          run: () => {
            onClose();
            onOpenText?.(hit);
          },
        };
      });
    }
    const list = term
      ? fuse.search(term, { limit: MAX_RESULTS }).map((r) => r.item)
      : mode === 'search' && recent.length
        ? recent
        : candidates.slice(0, 12);
    return list.map((node) => ({
      key: node.id,
      icon: !term && mode === 'search' && recent.length ? History : KIND_ICON[nodeKind(node)],
      label: node.label,
      sub: node.id.split('::')[0],
      run: () => chooseNode(node),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommand, isText, term, text, commands, commandFuse, fuse, candidates, recent, mode, nodesById]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  const title =
    mode === 'path'
      ? `Find a path from ${from?.label}`
      : mode === 'compare'
        ? `Compare ${from?.label} with`
        : 'Search files and symbols';
  const placeholder =
    mode === 'path'
      ? 'Choose a destination'
      : mode === 'compare'
        ? 'Choose a node to compare'
        : 'Search names, type > for commands or # to search inside code';
  const activeId = rows[active] ? `palette-option-${active}` : undefined;

  let empty = `No files or symbols match “${query}”.`;
  if (isCommand) empty = `No commands match “${term}”.`;
  if (isText) empty = term.length < 2 ? 'Type at least 2 characters to search inside code.' : text.query !== term ? 'Searching…' : `No code contains “${term}”.`;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {from && mode !== 'search' && (
          <div className="palette__context">
            {mode === 'path' ? <Route size={13} aria-hidden="true" /> : <Columns2 size={13} aria-hidden="true" />}{' '}
            {mode === 'path' ? 'Find a path from' : 'Compare'} <strong>{from.label}</strong> {mode === 'path' ? 'to…' : 'with…'}
          </div>
        )}
        <div className="palette__head">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={title}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
        </div>
        {!query && mode === 'search' && recent.length > 0 && <div className="palette__section">Recently opened</div>}
        {isText && text.query === term && text.total > text.hits.length && (
          <div className="palette__section">
            Showing {text.hits.length} of {text.total} matches
          </div>
        )}
        {rows.length > 0 ? (
          <ul id="palette-results" ref={listRef} className="palette__list" role="listbox" aria-label="Results">
            {rows.map((row, i) => {
              const Icon = row.icon;
              return (
                <li
                  key={row.key}
                  id={`palette-option-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="palette__option"
                  onMouseMove={() => setActive(i)}
                  onClick={row.run}
                >
                  <Icon size={17} aria-hidden="true" />
                  <div className="palette__text">
                    <div className="palette__label">{row.label}</div>
                    {row.sub && <div className="palette__id">{row.sub}</div>}
                  </div>
                  {row.shortcut && <kbd className="kbd">{row.shortcut}</kbd>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="palette__empty" role="status">
            {empty}
          </p>
        )}
        <div className="palette__foot" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to {mode === 'path' ? 'find path' : mode === 'compare' ? 'compare' : isCommand ? 'run' : 'open'}
          </span>
          {mode === 'search' && (
            <span>
              <kbd className="kbd">&gt;</kbd> commands <kbd className="kbd">#</kbd> code
            </span>
          )}
          <span>
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
};

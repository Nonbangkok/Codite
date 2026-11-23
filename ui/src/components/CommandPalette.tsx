import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Box, File, Folder, FunctionSquare, Layers, Route, Search, Zap } from 'lucide-react';
import type { NodeData } from '../types';
import { nodeKind, type NodeKind } from '../utils/nodeKinds';

interface CommandPaletteProps {
  nodes: NodeData[];
  onSelect: (node: NodeData) => void;
  onClose: () => void;
  /** When set, the palette picks a path destination from this node. */
  pathFrom?: NodeData | null;
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

export const CommandPalette = ({ nodes, onSelect, onClose, pathFrom }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const candidates = useMemo(() => (pathFrom ? nodes.filter((n) => n.id !== pathFrom.id) : nodes), [nodes, pathFrom]);
  const fuse = useMemo(() => new Fuse(candidates, { keys: ['label', 'id'], threshold: 0.4 }), [candidates]);
  const results = useMemo(
    () => (query ? fuse.search(query, { limit: MAX_RESULTS }).map((r) => r.item) : candidates.slice(0, 12)),
    [fuse, query, candidates],
  );

  // Focus the input on open and restore focus to the previous element on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (node: NodeData | undefined) => {
    if (!node) return;
    onSelect(node);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog; the input is its only tab stop.
      e.preventDefault();
    }
  };

  const title = pathFrom ? `Find a path from ${pathFrom.label}` : 'Search files and symbols';
  const activeId = results[active] ? `palette-option-${active}` : undefined;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {pathFrom && (
          <div className="palette__context">
            <Route size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Find a path from <strong>{pathFrom.label}</strong> to…
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
            placeholder={pathFrom ? 'Choose a destination' : 'Search files, functions, classes…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
        </div>
        {results.length > 0 ? (
          <ul id="palette-results" ref={listRef} className="palette__list" role="listbox" aria-label="Results">
            {results.map((node, i) => {
              const Icon = KIND_ICON[nodeKind(node)];
              return (
                <li
                  key={node.id}
                  id={`palette-option-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="palette__option"
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(node)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <div className="palette__text">
                    <div className="palette__label">{node.label}</div>
                    <div className="palette__id">{node.id.split('::')[0]}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="palette__empty" role="status">
            No files or symbols match “{query}”.
          </p>
        )}
        <div className="palette__foot" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to {pathFrom ? 'find path' : 'open'}
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
};

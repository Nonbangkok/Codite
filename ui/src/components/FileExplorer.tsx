import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, Star, StickyNote, X } from 'lucide-react';
import type { FileTreeItem } from '../utils/treeUtils';
import { fileIdOf } from '../utils/nodeKinds';

interface FileExplorerProps {
  tree: FileTreeItem[];
  sourceLabel: string;
  activeFolderPath: string | null;
  selectedId: string | null;
  onFolderSelect: (path: string | null) => void;
  onFileSelect: (id: string) => void;
  open: boolean;
  onRequestClose: () => void;
  bookmarks?: { id: string; label: string; color: string; hasNote: boolean; bookmarked: boolean }[];
  onOpenBookmark?: (id: string) => void;
  width?: number;
  onResizeStart?: (e: React.PointerEvent) => void;
}

const ancestorsOf = (path: string): string[] => {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
};

interface RowProps {
  item: FileTreeItem;
  level: number;
  expanded: ReadonlySet<string>;
  focusPath: string | null;
  activeFolderPath: string | null;
  selectedFile: string | null;
  onActivate: (item: FileTreeItem) => void;
  onFocusRow: (path: string) => void;
}

const TreeRow = ({ item, level, expanded, focusPath, activeFolderPath, selectedFile, onActivate, onFocusRow }: RowProps) => {
  const isFolder = item.type === 'folder';
  const isOpen = isFolder && expanded.has(item.path);
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        className="tree__row"
        data-path={item.path}
        data-type={item.type}
        aria-level={level + 1}
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={isFolder ? activeFolderPath === item.path : selectedFile === item.path}
        data-active={isFolder && activeFolderPath === item.path}
        data-selected={!isFolder && selectedFile === item.path}
        tabIndex={focusPath === item.path ? 0 : -1}
        style={{ paddingLeft: 8 + level * 12 }}
        onClick={() => onActivate(item)}
        onFocus={() => onFocusRow(item.path)}
        title={item.path}
      >
        {isFolder ? (
          <>
            {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            <Folder size={14} aria-hidden="true" />
          </>
        ) : (
          <FileText size={14} aria-hidden="true" style={{ marginLeft: 20 }} />
        )}
        <span className="tree__name">{item.name}</span>
      </button>
      {isOpen && item.children && (
        <ul role="group">
          {item.children.map((child) => (
            <TreeRow
              key={child.path}
              item={child}
              level={level + 1}
              expanded={expanded}
              focusPath={focusPath}
              activeFolderPath={activeFolderPath}
              selectedFile={selectedFile}
              onActivate={onActivate}
              onFocusRow={onFocusRow}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export const FileExplorer = ({
  tree,
  sourceLabel,
  activeFolderPath,
  selectedId,
  onFolderSelect,
  onFileSelect,
  open,
  onRequestClose,
  bookmarks = [],
  onOpenBookmark,
  onResizeStart,
}: FileExplorerProps) => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const selectedFile = selectedId ? fileIdOf(selectedId) : null;

  // Reveal the selected file in the tree.
  useEffect(() => {
    if (!selectedFile) return;
    const needed = ancestorsOf(selectedFile);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing tree expansion to external selection
    setExpanded((prev) => (needed.every((p) => prev.has(p)) ? prev : new Set([...prev, ...needed])));
  }, [selectedFile]);

  const rovingPath = useMemo(
    () => focusPath ?? selectedFile ?? activeFolderPath ?? tree[0]?.path ?? null,
    [focusPath, selectedFile, activeFolderPath, tree],
  );

  const toggle = (path: string, force?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const shouldOpen = force ?? !next.has(path);
      if (shouldOpen) next.add(path);
      else next.delete(path);
      return next;
    });

  const activate = (item: FileTreeItem) => {
    if (item.type === 'folder') {
      toggle(item.path);
      onFolderSelect(item.path);
    } else {
      onFileSelect(item.path);
      onRequestClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const rows = [...(treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const current = document.activeElement as HTMLButtonElement;
    const i = rows.indexOf(current);
    if (i < 0) return;
    const path = current.dataset.path!;
    const isFolder = current.dataset.type === 'folder';
    const focusRow = (row?: HTMLButtonElement) => {
      if (row) {
        e.preventDefault();
        row.focus();
      }
    };

    switch (e.key) {
      case 'ArrowDown':
        return focusRow(rows[i + 1]);
      case 'ArrowUp':
        return focusRow(rows[i - 1]);
      case 'Home':
        return focusRow(rows[0]);
      case 'End':
        return focusRow(rows[rows.length - 1]);
      case 'ArrowRight':
        e.preventDefault();
        if (isFolder && !expanded.has(path)) toggle(path, true);
        else if (isFolder) focusRow(rows[i + 1]);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (isFolder && expanded.has(path)) return toggle(path, false);
        const parent = path.split('/').slice(0, -1).join('/');
        return focusRow(rows.find((r) => r.dataset.path === parent));
      }
    }
  };

  return (
    <>
      <div className="drawer-backdrop" data-open={open} onClick={onRequestClose} aria-hidden="true" />
      <nav className="sidebar" data-open={open} aria-label="Files">
        <div className="sidebar__head">
          <h1 className="brand">
            <img src="/logo.svg" alt="" />
            Codite
          </h1>
        </div>
        <div className="sidebar__source">
          Showing <strong>{sourceLabel}</strong>
        </div>
        {activeFolderPath && (
          <div className="scope">
            <span title={activeFolderPath}>Only {activeFolderPath.split('/').pop()}</span>
            <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Show all folders" onClick={() => onFolderSelect(null)}>
              <X size={13} />
            </button>
          </div>
        )}
        {bookmarks.length > 0 && (
          <details className="bookmarks" open>
            <summary>Bookmarks and notes ({bookmarks.length})</summary>
            <ul>
              {bookmarks.map((b) => (
                <li key={b.id}>
                  <button type="button" className="tree__row" onClick={() => { onOpenBookmark?.(b.id); onRequestClose(); }} title={b.id}>
                    {b.bookmarked ? <Star size={13} aria-label="Bookmarked" /> : <StickyNote size={13} aria-label="Has a note" />}
                    <span className="dot" style={{ background: b.color }} aria-hidden="true" />
                    <span className="tree__name">{b.label}</span>
                    {b.bookmarked && b.hasNote && <StickyNote size={12} aria-label="Has a note" />}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ul ref={treeRef} className="tree" role="tree" aria-label="Project files" onKeyDown={onKeyDown}>
          {tree.map((item) => (
            <TreeRow
              key={item.path}
              item={item}
              level={0}
              expanded={expanded}
              focusPath={rovingPath}
              activeFolderPath={activeFolderPath}
              selectedFile={selectedFile}
              onActivate={activate}
              onFocusRow={setFocusPath}
            />
          ))}
        </ul>
        <div className="sidebar__foot">Select a folder to show only its files.</div>
        {onResizeStart && (
          <div
            className="sidebar__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={onResizeStart}
          />
        )}
      </nav>
    </>
  );
};

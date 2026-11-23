import { useEffect, useRef, useState } from 'react';
import { BoxSelect, Download, FolderTree, Keyboard, Link2, Maximize, Moon, Search, Sun, Tags, X } from 'lucide-react';
import type { ThemeName } from '../../theme';
import type { ColorMode } from './GraphView';

export type ExportFormat = 'png' | 'svg' | 'json';

interface GraphToolbarProps {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  showNames: boolean;
  onToggleNames: () => void;
  showFolders: boolean;
  onToggleFolders: () => void;
  theme: ThemeName;
  onToggleTheme: () => void;
  onFit: () => void;
  onExport: (format: ExportFormat) => void;
  canShare: boolean;
  onCopyLink: () => void;
  onShowShortcuts: () => void;
  viewMenu: React.ReactNode;
  highlight: string;
  onHighlightChange: (value: string) => void;
  highlightCount: number;
  onHighlightSubmit: () => void;
  lassoMode: boolean;
  onToggleLasso: () => void;
}

const EXPORTS: { format: ExportFormat; label: string; detail: string }[] = [
  { format: 'png', label: 'Image', detail: 'PNG' },
  { format: 'svg', label: 'Vector', detail: 'SVG' },
  { format: 'json', label: 'Graph data', detail: 'JSON' },
];

const ExportMenu = ({ onExport }: { onExport: (format: ExportFormat) => void }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label="Export graph"
        title="Export graph"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Download size={16} />
      </button>
      {open && (
        <ul className="menu" role="menu" aria-label="Export graph" onKeyDown={onMenuKey}>
          {EXPORTS.map(({ format, label, detail }) => (
            <li key={format} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExport(format);
                }}
              >
                <span>{label}</span>
                <small>{detail}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const GraphToolbar = (props: GraphToolbarProps) => (
  <div className="floating toolbar" role="toolbar" aria-label="Graph view options">
    <div className="segmented" role="group" aria-label="Color nodes by">
      {(['kind', 'language', 'heat'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={props.colorMode === mode}
          onClick={() => props.onColorModeChange(mode)}
          title="Color nodes by (C)"
        >
          {mode === 'kind' ? 'Kind' : mode === 'language' ? 'Language' : 'Heat'}
        </button>
      ))}
    </div>
    <button type="button" className="icon-btn" role="switch" aria-checked={props.showNames} aria-label="Show all node names" title="Show all node names (N)" onClick={props.onToggleNames}>
      <Tags size={16} />
    </button>
    <button type="button" className="icon-btn" role="switch" aria-checked={props.showFolders} aria-label="Show folder nodes" title="Show folder nodes (D)" onClick={props.onToggleFolders}>
      <FolderTree size={16} />
    </button>
    <span className="toolbar__sep" aria-hidden="true" />
    <div className="toolbar__find" role="search">
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        aria-label="Highlight nodes by name"
        placeholder="Highlight"
        value={props.highlight}
        onChange={(e) => props.onHighlightChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onHighlightSubmit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            props.onHighlightChange('');
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {props.highlight && (
        <>
          <span className="toolbar__count" aria-live="polite">
            {props.highlightCount}
          </span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Clear highlight" onClick={() => props.onHighlightChange('')}>
            <X size={12} />
          </button>
        </>
      )}
    </div>
    <button
      type="button"
      className="icon-btn"
      aria-pressed={props.lassoMode}
      aria-label="Select an area"
      title="Drag to select several nodes (hold Shift to add)"
      onClick={props.onToggleLasso}
    >
      <BoxSelect size={16} />
    </button>
    {props.viewMenu}
    <button type="button" className="icon-btn" aria-label="Fit graph to screen" title="Fit graph to screen (F)" onClick={props.onFit}>
      <Maximize size={16} />
    </button>
    <ExportMenu onExport={props.onExport} />
    {props.canShare && (
      <button type="button" className="icon-btn" aria-label="Copy link to this scan" title="Copy link to this scan" onClick={props.onCopyLink}>
        <Link2 size={16} />
      </button>
    )}
    <button
      type="button"
      className="icon-btn"
      aria-label={props.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title="Switch theme (T)"
      onClick={props.onToggleTheme}
    >
      {props.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
    <button type="button" className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={props.onShowShortcuts}>
      <Keyboard size={16} />
    </button>
  </div>
);

import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { LayoutMode } from './GraphView';
import type { FolderGroup, SizeMetric } from '../../utils/graphAnalysis';

export type SizeBy = 'uniform' | SizeMetric;

const METRIC_LABEL: Record<SizeMetric, string> = { lines: 'Lines of code', connections: 'Connections', complexity: 'Complexity' };
const LINK_LABEL: Record<string, string> = {
  contains: 'Contains (file → symbol)',
  imports: 'Imports',
  imports_module: 'Imports a file',
  implements: 'Implements',
  declares_module: 'Declares module',
  calls: 'Calls',
};

interface ViewMenuProps {
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  untangle: boolean;
  onToggleUntangle: () => void;
  groupByFolder: boolean;
  onToggleGroups: () => void;
  folders: FolderGroup[];
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (key: string) => void;
  onExpandAll: () => void;
  sizeBy: SizeBy;
  onSizeByChange: (size: SizeBy) => void;
  heatMetric: SizeMetric;
  onHeatMetricChange: (metric: SizeMetric) => void;
  linkTypes: { type: string; count: number }[];
  hiddenLinkTypes: ReadonlySet<string>;
  onToggleLinkType: (type: string) => void;
  pinnedCount: number;
  onSaveLayout: () => void;
  onUnpinAll: () => void;
  onResetLayout: () => void;
}

/** Graph view options in one popover: layout, grouping, sizing, colors and connection types. */
export const ViewMenu = (props: ViewMenuProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-btn"
        aria-label="View options"
        title="Layout, grouping, sizes and connection types"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="menu view-menu" role="dialog" aria-label="View options">
          <fieldset>
            <legend>Layout</legend>
            <div className="segmented" role="group" aria-label="Layout">
              {(['force', 'tree', 'radial', 'structure'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={props.layout === l} onClick={() => props.onLayoutChange(l)}>
                  {{ force: 'Force', tree: 'Tree', radial: 'Radial', structure: 'Structure' }[l]}
                </button>
              ))}
            </div>
            <p className="view-menu__hint">
              {
                {
                  force: 'Physics layout.',
                  tree: 'Files by dependency level, symbols under their file, ordered for fewest crossings.',
                  radial: 'Rings show distance from the selected node (or folder depth).',
                  structure: 'Folders, files and symbols only: no crossing lines. Select a node to see its dependencies.',
                }[props.layout]
              }
            </p>
            {(props.layout === 'force' || props.layout === 'radial') && (
              <label className="check">
                <input type="checkbox" checked={props.untangle} onChange={props.onToggleUntangle} />
                Untangle crossing lines after layout
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend>Folders</legend>
            <label className="check">
              <input type="checkbox" checked={props.groupByFolder} onChange={props.onToggleGroups} />
              Outline folder groups
            </label>
            <div className="view-menu__list" role="group" aria-label="Collapse folders">
              {props.folders.slice(0, 30).map((f) => (
                <label key={f.key} className="check">
                  <input type="checkbox" checked={props.collapsed.has(f.key)} onChange={() => props.onToggleCollapse(f.key)} />
                  Collapse {f.label} <small>{f.count}</small>
                </label>
              ))}
            </div>
            {props.collapsed.size > 0 && (
              <button type="button" className="link-btn" onClick={props.onExpandAll}>
                Expand all folders
              </button>
            )}
          </fieldset>

          <fieldset>
            <legend>Node size</legend>
            <select aria-label="Node size" value={props.sizeBy} onChange={(e) => props.onSizeByChange(e.target.value as SizeBy)}>
              <option value="uniform">By kind (default)</option>
              {(Object.keys(METRIC_LABEL) as SizeMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend>Heat color shows</legend>
            <select aria-label="Heat color metric" value={props.heatMetric} onChange={(e) => props.onHeatMetricChange(e.target.value as SizeMetric)}>
              {(Object.keys(METRIC_LABEL) as SizeMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend>Connections</legend>
            {props.linkTypes.map(({ type, count }) => (
              <label key={type} className="check">
                <input type="checkbox" checked={!props.hiddenLinkTypes.has(type)} onChange={() => props.onToggleLinkType(type)} />
                {LINK_LABEL[type] ?? type} <small>{count}</small>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Positions</legend>
            <p className="view-menu__hint">Drag a node to pin it. {props.pinnedCount > 0 && `${props.pinnedCount} pinned.`}</p>
            <div className="view-menu__actions">
              <button type="button" className="btn" onClick={props.onSaveLayout}>
                Save layout
              </button>
              <button type="button" className="btn" disabled={props.pinnedCount === 0} onClick={props.onUnpinAll}>
                Unpin all
              </button>
              <button type="button" className="btn btn--quiet" onClick={props.onResetLayout}>
                Reset
              </button>
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
};

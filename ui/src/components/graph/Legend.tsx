import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { KIND_LABEL, languageLabel, type CountedKey, type NodeKind } from '../../utils/nodeKinds';
import type { ColorMode } from './GraphView';

interface LegendProps {
  mode: ColorMode;
  entries: CountedKey[];
  hidden: ReadonlySet<string>;
  colorOf: (key: string) => string;
  onToggle: (key: string) => void;
  onShowOnly: (key: string) => void;
  onShowAll: () => void;
  defaultOpen?: boolean;
}

/** Map key for the graph. Click a row to hide or show it; Alt/Option-click to show only that row. */
export const Legend = ({ mode, entries, hidden, colorOf, onToggle, onShowOnly, onShowAll, defaultOpen = true }: LegendProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const label = (key: string) => (mode === 'kind' ? KIND_LABEL[key as NodeKind]?.many ?? key : languageLabel(key));
  const hiddenCount = entries.filter((e) => hidden.has(e.key)).length;

  if (entries.length === 0) return null;

  return (
    <section className="floating legend" aria-labelledby="legend-title">
      <div className="legend__head">
        <h2 id="legend-title" className="legend__title">
          {mode === 'kind' ? 'Kinds' : 'Languages'}
        </h2>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          aria-expanded={open}
          aria-controls="legend-list"
          aria-label={open ? 'Collapse legend' : 'Expand legend'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {open && (
        <>
          <ul id="legend-list" className="legend__list">
            {entries.map(({ key, count }) => {
              const visible = !hidden.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="legend__item"
                    aria-pressed={visible}
                    title={`${visible ? 'Hide' : 'Show'} ${label(key).toLowerCase()} — Alt-click to show only these`}
                    onClick={(e) => (e.altKey ? onShowOnly(key) : onToggle(key))}
                  >
                    <span className="dot" style={{ background: colorOf(key) }} aria-hidden="true" />
                    <span>{label(key)}</span>
                    <span className="legend__count">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="legend__foot">
            <span>{hiddenCount > 0 ? `${hiddenCount} hidden` : 'Click to hide'}</span>
            {hiddenCount > 0 && (
              <button type="button" onClick={onShowAll}>
                Show all
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};

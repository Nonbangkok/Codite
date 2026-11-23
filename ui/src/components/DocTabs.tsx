import { ArrowLeft, ArrowRight, Pin, PinOff, X } from 'lucide-react';
import type { NodeData } from '../types';
import type { DocTab } from '../utils/workspace';

interface DocTabsProps {
  tabs: DocTab[];
  activeId: string | null;
  nodesById: ReadonlyMap<string, NodeData>;
  colorOf: (node: NodeData) => string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onTogglePin: (id: string) => void;
}

/** Open nodes, like editor tabs. The unpinned tab is a preview that the next node replaces. */
export const DocTabs = (props: DocTabsProps) => (
  <div className="doc-tabs">
    <button type="button" className="icon-btn icon-btn--sm" aria-label="Back" title="Back (Alt+←)" disabled={!props.canBack} onClick={props.onBack}>
      <ArrowLeft size={15} />
    </button>
    <button type="button" className="icon-btn icon-btn--sm" aria-label="Forward" title="Forward (Alt+→)" disabled={!props.canForward} onClick={props.onForward}>
      <ArrowRight size={15} />
    </button>
    <ul className="doc-tabs__list" aria-label="Open nodes">
      {props.tabs.map((tab) => {
        const node = props.nodesById.get(tab.id);
        if (!node) return null;
        const active = tab.id === props.activeId;
        return (
          <li key={tab.id} className="doc-tab" data-active={active} data-pinned={tab.pinned}>
            <button
              type="button"
              className="doc-tab__main"
              aria-current={active ? 'page' : undefined}
              title={`${tab.id}${tab.pinned ? '' : ' — double-click to keep open'}`}
              onClick={() => props.onActivate(tab.id)}
              onDoubleClick={() => !tab.pinned && props.onTogglePin(tab.id)}
            >
              <span className="dot" style={{ background: props.colorOf(node) }} aria-hidden="true" />
              <span className="doc-tab__label">{node.label}</span>
            </button>
            <button
              type="button"
              className="doc-tab__icon"
              aria-label={tab.pinned ? `Unpin ${node.label}` : `Keep ${node.label} open`}
              aria-pressed={tab.pinned}
              onClick={() => props.onTogglePin(tab.id)}
            >
              {tab.pinned ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
            <button type="button" className="doc-tab__icon" aria-label={`Close ${node.label}`} onClick={() => props.onClose(tab.id)}>
              <X size={12} />
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);

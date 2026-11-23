import { lazy, Suspense, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import type { NodeData } from '../types';
import { KIND_LABEL, isSymbolId, nodeKind } from '../utils/nodeKinds';
import { repoRelativePath, symbolStartLine } from '../utils/sourceLocation';
import type { ReaderSettings } from './code/CodeReader';
import type { LineRange } from './code/CodeView';

const CodeReader = lazy(() => import('./code/CodeReader').then((m) => ({ default: m.CodeReader })));

interface ComparePaneProps {
  node: NodeData;
  nodesById: ReadonlyMap<string, NodeData>;
  colorOf: (node: NodeData) => string;
  readerSettings: ReaderSettings;
  onReaderSettingsChange: (settings: ReaderSettings) => void;
  symbolNames: ReadonlyMap<string, string>;
  onSymbolClick: (name: string, fromId: string) => void;
  onSwap: () => void;
  onClose: () => void;
  onNotify: (message: string) => void;
}

/** Second reader shown beside the main details panel. */
export const ComparePane = (props: ComparePaneProps) => {
  const { node } = props;
  const [range, setRange] = useState<LineRange | null>(null);
  const file = props.nodesById.get(node.id.split('::')[0]);
  const first = isSymbolId(node.id) ? (symbolStartLine(node, file?.code) ?? 1) : 1;

  return (
    <section className="panel compare" aria-labelledby="compare-title">
      <header className="panel__header compare__header">
        <div className="panel__top">
          <div className="panel__meta">
            <span className="dot" style={{ background: props.colorOf(node) }} aria-hidden="true" />
            <span>Comparing with {KIND_LABEL[nodeKind(node)].one.toLowerCase()}</span>
          </div>
          <div className="panel__controls">
            <button type="button" className="icon-btn" aria-label="Make this the main node" title="Swap sides" onClick={props.onSwap}>
              <ArrowLeftRight size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Close comparison" onClick={props.onClose}>
              <X size={17} />
            </button>
          </div>
        </div>
        <h2 id="compare-title" className="panel__title">
          {node.label}
        </h2>
        <div className="panel__path">
          <span>{repoRelativePath(node.id) || node.id}</span>
        </div>
      </header>
      {node.code ? (
        <div className="panel__code">
          <Suspense fallback={<p className="panel__note" style={{ padding: 20 }}>Loading code…</p>}>
            <CodeReader
              code={node.code}
              language={node.language}
              firstLine={first}
              label={node.label}
              outline={[]}
              symbolNames={props.symbolNames}
              onSymbolClick={(name) => props.onSymbolClick(name, node.id)}
              highlight={range}
              onHighlightChange={setRange}
              scrollTarget={null}
              settings={props.readerSettings}
              onSettingsChange={props.onReaderSettingsChange}
              searchFocusSignal={0}
              onNotify={props.onNotify}
            />
          </Suspense>
        </div>
      ) : (
        <p className="panel__note" style={{ padding: 20 }}>
          The analyzer did not capture source for this node.
        </p>
      )}
    </section>
  );
};

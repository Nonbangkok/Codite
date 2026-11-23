import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Copy, Crosshair, ExternalLink, Maximize2, PanelRight, Radar, Route, SplitSquareHorizontal, Star, X } from 'lucide-react';
import type { NodeData } from '../types';
import type { GraphIndex, PathResult } from '../utils/graphIndex';
import { KIND_LABEL, languageLabel, nodeKind, isSymbolId } from '../utils/nodeKinds';
import { githubUrl, repoRelativePath, symbolStartLine } from '../utils/sourceLocation';
import { codeMetrics } from '../utils/codeAnalysis';
import type { OutlineItem, ReaderSettings } from './code/CodeReader';

// CodeMirror is only needed once a node is opened, so it loads in its own chunk.
const CodeReader = lazy(() => import('./code/CodeReader').then((m) => ({ default: m.CodeReader })));
import type { LineRange } from './code/CodeView';

const LANGUAGE_BADGE: Record<string, { label: string; color: string }> = {
  rust: { label: 'RS', color: '#dea584' },
  typescript: { label: 'TS', color: '#5b9bd5' },
  javascript: { label: 'JS', color: '#f0d83c' },
  python: { label: 'PY', color: '#7ea6d8' },
  go: { label: 'GO', color: '#4cc3e0' },
  c: { label: 'C', color: '#a8bbd9' },
  cpp: { label: 'C++', color: '#7ba3e8' },
};

/** How each link type reads from either end. */
const RELATION: Record<string, { out: string; in: string }> = {
  contains: { out: 'Contains', in: 'Defined in' },
  imports: { out: 'Imports', in: 'Imported by' },
  imports_module: { out: 'Imports', in: 'Imported by' },
  declares_module: { out: 'Declares module', in: 'Declared by' },
  implements: { out: 'Implements', in: 'Implemented by' },
  calls: { out: 'Calls', in: 'Called by' },
};
const relationLabel = (type: string, dir: 'out' | 'in') =>
  RELATION[type]?.[dir] ?? (dir === 'out' ? `Links to (${type})` : `Linked from (${type})`);

const COLLAPSED_COUNT = 8;

export type PanelSize = 'normal' | 'wide' | 'full';
type Tab = 'code' | 'connections' | 'details';

interface NodePanelProps {
  node: NodeData;
  nodesById: ReadonlyMap<string, NodeData>;
  index: GraphIndex;
  repo: string | null;
  colorOf: (node: NodeData) => string;
  focusDepth: number;
  onFocusDepthChange: (depth: number) => void;
  path: PathResult | null;
  onFindPath: () => void;
  onClearPath: () => void;
  onSelect: (id: string, range?: LineRange | null) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
  size: PanelSize;
  onSizeChange: (size: PanelSize) => void;
  lineRange: LineRange | null;
  onLineRangeChange: (range: LineRange | null) => void;
  readerSettings: ReaderSettings;
  onReaderSettingsChange: (settings: ReaderSettings) => void;
  symbolNames: ReadonlyMap<string, string>;
  onSymbolClick: (name: string, fromId: string) => void;
  searchFocusSignal: number;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  note: string;
  onNoteChange: (note: string) => void;
  onCompare: () => void;
  comparing: boolean;
  impactActive: boolean;
  onImpact: () => void;
  codeLoading?: boolean;
}

const ConnectionGroup = ({
  title,
  ids,
  nodesById,
  colorOf,
  onSelect,
}: {
  title: string;
  ids: string[];
  nodesById: ReadonlyMap<string, NodeData>;
  colorOf: (node: NodeData) => string;
  onSelect: (id: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? ids : ids.slice(0, COLLAPSED_COUNT);
  return (
    <div className="conn-group">
      <h4>
        {title} <span style={{ color: 'var(--text-faint)' }}>{ids.length}</span>
      </h4>
      <ul className="conn-list">
        {shown.map((id) => {
          const target = nodesById.get(id)!;
          return (
            <li key={id}>
              <button type="button" className="conn-item" onClick={() => onSelect(id)} title={id}>
                <span className="dot" style={{ background: colorOf(target) }} aria-hidden="true" />
                <span className="conn-item__name">{target.label}</span>
                <span className="conn-item__where">{KIND_LABEL[nodeKind(target)].one}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {ids.length > COLLAPSED_COUNT && (
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `Show all ${ids.length}`}
        </button>
      )}
    </div>
  );
};

const SIZES: { size: PanelSize; label: string; Icon: typeof PanelRight }[] = [
  { size: 'normal', label: 'Side panel', Icon: PanelRight },
  { size: 'wide', label: 'Half screen', Icon: Columns2 },
  { size: 'full', label: 'Full screen', Icon: Maximize2 },
];

export const NodePanel = (props: NodePanelProps) => {
  const { node, nodesById, index, colorOf, path } = props;
  const kind = nodeKind(node);
  const badge = LANGUAGE_BADGE[node.language];
  const fileNode = nodesById.get(node.id.split('::')[0]);
  const isSymbol = isSymbolId(node.id);
  const startLine = useMemo(() => symbolStartLine(node, fileNode?.code), [node, fileNode]);
  const codeLines = node.code ? node.code.split('\n').length : 0;
  const firstLine = isSymbol ? (startLine ?? 1) : 1;
  const endLine = node.code ? firstLine + codeLines - 1 : null;
  const relPath = repoRelativePath(node.id);

  const [tab, setTab] = useState<Tab>(node.code ? 'code' : 'connections');
  const tabsRef = useRef<HTMLDivElement>(null);

  // Show the path as soon as one is found.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external path result
    if (path) setTab('connections');
  }, [path]);
  // A new node opens on its code.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new node, default tab
    setTab((t) => (node.code ? (t === 'connections' && path ? t : 'code') : 'connections'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);
  // Code can arrive after the panel opened (split code files): switch to it once it does.
  const hasCode = !!node.code;
  const [codeSeenFor, setCodeSeenFor] = useState<string | null>(hasCode ? node.id : null);
  useEffect(() => {
    if (!hasCode || codeSeenFor === node.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to late-loaded source
    setCodeSeenFor(node.id);
    if (!path) setTab('code');
  }, [hasCode, codeSeenFor, node.id, path]);
  // Ctrl/Cmd+F while the panel is open goes to the code search.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keyboard request from the app
    if (props.searchFocusSignal !== 0 && node.code) setTab('code');
  }, [props.searchFocusSignal, node.code]);

  const groups = useMemo(() => {
    const byTitle = new Map<string, string[]>();
    const add = (title: string, id: string) => {
      if (!nodesById.has(id)) return;
      const list = byTitle.get(title) ?? [];
      if (!list.includes(id)) list.push(id);
      byTitle.set(title, list);
    };
    for (const e of index.in.get(node.id) ?? []) if (e.type === 'contains') add(relationLabel(e.type, 'in'), e.id);
    for (const e of index.out.get(node.id) ?? []) add(relationLabel(e.type, 'out'), e.id);
    for (const e of index.in.get(node.id) ?? []) if (e.type !== 'contains') add(relationLabel(e.type, 'in'), e.id);
    return [...byTitle.entries()];
  }, [index, node.id, nodesById]);
  const connectionCount = groups.reduce((n, [, ids]) => n + ids.length, 0);

  // Symbols defined in a file, with their line ranges.
  const outline = useMemo<OutlineItem[]>(() => {
    if (isSymbol || !node.code) return [];
    return (index.out.get(node.id) ?? [])
      .filter((e) => e.type === 'contains')
      .map((e) => nodesById.get(e.id))
      .filter((n): n is NodeData => !!n)
      .map((sym) => {
        const line = symbolStartLine(sym, node.code) ?? 1;
        const length = sym.code ? sym.code.split('\n').length : 1;
        return { id: sym.id, label: sym.label, kindLabel: KIND_LABEL[nodeKind(sym)].one, color: colorOf(sym), line, endLine: line + length - 1 };
      })
      .sort((a, b) => a.line - b.line);
  }, [isSymbol, node, index, nodesById, colorOf]);

  const metrics = useMemo(() => (node.code ? codeMetrics(node.code) : null), [node.code]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(relPath || node.id);
      props.onNotify('Path copied');
    } catch {
      props.onNotify('Could not copy the path');
    }
  };

  const pathTarget = path ? nodesById.get(path.nodeIds[path.nodeIds.length - 1]) : null;
  const ghLine = props.lineRange?.from ?? startLine;
  const ghEnd = props.lineRange?.to ?? (isSymbol ? endLine : null);

  const TABS: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: 'code', label: 'Code', disabled: !node.code },
    { id: 'connections', label: `Connections ${connectionCount}` },
    { id: 'details', label: 'Details' },
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = TABS.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === tab);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    setTab(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };

  return (
    <aside className="panel" aria-labelledby="panel-title" data-size={props.size}>
      <header className="panel__header">
        <div className="panel__top">
          <div className="panel__meta">
            <span className="dot" style={{ background: colorOf(node) }} aria-hidden="true" />
            <span>{KIND_LABEL[kind].one}</span>
            {node.language && (
              <span className="badge" style={{ background: badge?.color ?? '#a1a1aa' }} title={languageLabel(node.language)}>
                {badge?.label ?? languageLabel(node.language)}
              </span>
            )}
            {startLine && <span>Line {startLine}</span>}
          </div>
          <div className="panel__controls">
            <button
              type="button"
              className="icon-btn"
              aria-pressed={props.bookmarked}
              aria-label={props.bookmarked ? 'Remove bookmark' : 'Bookmark this node'}
              title={props.bookmarked ? 'Remove bookmark' : 'Bookmark (shows in the sidebar)'}
              onClick={props.onToggleBookmark}
            >
              <Star size={15} fill={props.bookmarked ? 'currentColor' : 'none'} />
            </button>
            <div className="segmented segmented--icons" role="group" aria-label="Panel size">
              {SIZES.map(({ size, label, Icon }) => (
                <button key={size} type="button" aria-pressed={props.size === size} aria-label={label} title={`${label} (E cycles)`} onClick={() => props.onSizeChange(size)}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={props.onClose}>
              <X size={17} />
            </button>
          </div>
        </div>
        <h2 id="panel-title" className="panel__title">
          {node.label}
        </h2>
        <div className="panel__path">
          {isSymbol && fileNode ? (
            <button type="button" className="crumb" onClick={() => props.onSelect(fileNode.id, startLine && endLine ? { from: startLine, to: endLine } : null)} title="Open the file">
              {relPath || fileNode.id}
            </button>
          ) : (
            <span>{relPath || node.id.split('::')[0]}</span>
          )}
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Copy path" title="Copy path" onClick={copyPath}>
            <Copy size={13} />
          </button>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="btn"
            aria-pressed={props.focusDepth > 0}
            onClick={() => props.onFocusDepthChange(props.focusDepth > 0 ? 0 : 1)}
            title="Show only nearby nodes (X)"
          >
            <Crosshair size={14} aria-hidden="true" />
            Focus
          </button>
          {props.focusDepth > 0 && (
            <label className="depth">
              Depth
              <select value={props.focusDepth} onChange={(e) => props.onFocusDepthChange(Number(e.target.value))}>
                {[1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="btn" onClick={props.onFindPath} title="Find how this connects to another node (P)">
            <Route size={14} aria-hidden="true" />
            Find path
          </button>
          <button type="button" className="btn" aria-pressed={props.impactActive} onClick={props.onImpact} title="Highlight everything that depends on this (I)">
            <Radar size={14} aria-hidden="true" />
            Impact
          </button>
          <button type="button" className="btn" aria-pressed={props.comparing} onClick={props.onCompare} title="Open another node side by side">
            <SplitSquareHorizontal size={14} aria-hidden="true" />
            Compare
          </button>
          {props.repo && (
            <a className="btn" href={githubUrl(props.repo, node, ghLine, ghEnd)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              Open on GitHub
            </a>
          )}
        </div>
        {path && pathTarget && tab !== 'connections' && (
          <button type="button" className="path-banner" onClick={() => setTab('connections')}>
            <Route size={13} aria-hidden="true" />
            Path to {pathTarget.label}, {path.nodeIds.length - 1} {path.nodeIds.length === 2 ? 'step' : 'steps'}
          </button>
        )}
        <div className="tabs" role="tablist" aria-label="Node details" ref={tabsRef} onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              disabled={t.disabled}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'code' && node.code && (
        <div id="tabpanel-code" role="tabpanel" aria-labelledby="tab-code" className="panel__code">
          <Suspense fallback={<p className="panel__note" style={{ padding: 20 }}>Loading code…</p>}>
          <CodeReader
            code={node.code}
            language={node.language}
            firstLine={firstLine}
            label={node.label}
            outline={outline}
            onOpenInFile={isSymbol && fileNode?.code && startLine ? () => props.onSelect(fileNode.id, { from: startLine, to: endLine! }) : undefined}
            symbolNames={props.symbolNames}
            onSymbolClick={(name) => props.onSymbolClick(name, node.id)}
            highlight={props.lineRange}
            onHighlightChange={props.onLineRangeChange}
            scrollTarget={props.lineRange ? { line: props.lineRange.from, key: `${node.id}:${props.lineRange.from}` } : null}
            settings={props.readerSettings}
            onSettingsChange={props.onReaderSettingsChange}
            searchFocusSignal={props.searchFocusSignal}
            onNotify={props.onNotify}
          />
          </Suspense>
        </div>
      )}

      {tab === 'connections' && (
        <div id="tabpanel-connections" role="tabpanel" aria-labelledby="tab-connections" className="panel__body">
          {path && pathTarget && (
            <section className="panel__section" aria-labelledby="path-title">
              <h3 id="path-title">
                Path to {pathTarget.label}
                <small>
                  {path.nodeIds.length - 1} {path.nodeIds.length === 2 ? 'step' : 'steps'}
                </small>
              </h3>
              <ol className="path-list">
                {path.nodeIds.map((id) => {
                  const step = nodesById.get(id);
                  if (!step) return null;
                  return (
                    <li key={id}>
                      <button type="button" className="conn-item" data-current={id === node.id} onClick={() => props.onSelect(id)} title={id}>
                        <span className="dot" style={{ background: colorOf(step) }} aria-hidden="true" />
                        <span className="conn-item__name">{step.label}</span>
                        <span className="conn-item__where">{KIND_LABEL[nodeKind(step)].one}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <button type="button" className="link-btn" onClick={props.onClearPath}>
                Clear path
              </button>
            </section>
          )}
          <section className="panel__section" aria-labelledby="conn-title">
            <h3 id="conn-title">Connections</h3>
            {groups.length === 0 ? (
              <p className="panel__note">No connections were found for this node.</p>
            ) : (
              groups.map(([title, ids]) => (
                <ConnectionGroup key={title} title={title} ids={ids} nodesById={nodesById} colorOf={colorOf} onSelect={(id) => props.onSelect(id)} />
              ))
            )}
          </section>
        </div>
      )}

      {tab === 'details' && (
        <div id="tabpanel-details" role="tabpanel" aria-labelledby="tab-details" className="panel__body">
          <section className="panel__section">
            <dl className="facts">
              <dt>Kind</dt>
              <dd>{KIND_LABEL[kind].one}</dd>
              {node.language && (
                <>
                  <dt>Language</dt>
                  <dd>{languageLabel(node.language)}</dd>
                </>
              )}
              <dt>File</dt>
              <dd className="facts__mono">{relPath || node.id.split('::')[0]}</dd>
              {endLine && (
                <>
                  <dt>Lines</dt>
                  <dd>
                    {firstLine}–{endLine} ({codeLines} lines)
                  </dd>
                </>
              )}
              {metrics && (
                <>
                  <dt>Nesting depth</dt>
                  <dd>{metrics.maxDepth}</dd>
                  <dt>Complexity</dt>
                  <dd>{metrics.complexity} (approximate)</dd>
                  <dt>Lines over 100 characters</dt>
                  <dd>{metrics.longLines}</dd>
                </>
              )}
              <dt>Incoming links</dt>
              <dd>{index.in.get(node.id)?.length ?? 0}</dd>
              <dt>Outgoing links</dt>
              <dd>{index.out.get(node.id)?.length ?? 0}</dd>
              {outline.length > 0 && (
                <>
                  <dt>Symbols defined</dt>
                  <dd>{outline.length}</dd>
                </>
              )}
            </dl>
          </section>
          {!node.code && (
            <p className="panel__note">{props.codeLoading ? 'Loading source code…' : 'The analyzer did not capture source for this node.'}</p>
          )}
          <section className="panel__section">
            <h3>
              <label htmlFor="node-note">Notes</label>
              <small>Saved in this browser</small>
            </h3>
            <textarea
              id="node-note"
              className="note-input"
              rows={6}
              placeholder="What does this do? What to check next?"
              defaultValue={props.note}
              key={node.id}
              onBlur={(e) => props.onNoteChange(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </section>
        </div>
      )}
    </aside>
  );
};

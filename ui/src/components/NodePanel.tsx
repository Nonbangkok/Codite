import { useMemo, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { Copy, Crosshair, ExternalLink, Route, X } from 'lucide-react';
import type { NodeData } from '../types';
import type { GraphIndex, PathResult } from '../utils/graphIndex';
import { KIND_LABEL, languageLabel, nodeKind } from '../utils/nodeKinds';
import { githubUrl, repoRelativePath, symbolStartLine } from '../utils/sourceLocation';
import type { ThemeName } from '../theme';

// Register only the languages the analyzer produces (the full Prism build is ~1 MB).
for (const [name, grammar] of Object.entries({ c, cpp, go, javascript, python, rust, tsx, typescript })) {
  SyntaxHighlighter.registerLanguage(name, grammar);
}

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
};
const relationLabel = (type: string, dir: 'out' | 'in') => RELATION[type]?.[dir] ?? (dir === 'out' ? `Links to (${type})` : `Linked from (${type})`);

const COLLAPSED_COUNT = 8;

// oneLight's function blue (#4078f2) is 3.9:1 on its background; darken it to meet WCAG AA.
const LIGHT_CODE_STYLE = { ...oneLight, function: { ...oneLight.function, color: '#2a5bd7' } };

interface NodePanelProps {
  node: NodeData;
  nodesById: ReadonlyMap<string, NodeData>;
  index: GraphIndex;
  repo: string | null;
  theme: ThemeName;
  colorOf: (node: NodeData) => string;
  focusDepth: number;
  onFocusDepthChange: (depth: number) => void;
  path: PathResult | null;
  onFindPath: () => void;
  onClearPath: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
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

export const NodePanel = ({
  node,
  nodesById,
  index,
  repo,
  theme,
  colorOf,
  focusDepth,
  onFocusDepthChange,
  path,
  onFindPath,
  onClearPath,
  onSelect,
  onClose,
  onNotify,
}: NodePanelProps) => {
  const kind = nodeKind(node);
  const badge = LANGUAGE_BADGE[node.language];
  const fileNode = nodesById.get(node.id.split('::')[0]);
  const startLine = useMemo(() => symbolStartLine(node, fileNode?.code), [node, fileNode]);
  const relPath = repoRelativePath(node.id);

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

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(relPath || node.id);
      onNotify('Path copied');
    } catch {
      onNotify('Could not copy the path');
    }
  };

  const pathTarget = path ? nodesById.get(path.nodeIds[path.nodeIds.length - 1]) : null;

  return (
    <aside className="panel" aria-labelledby="panel-title">
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
          <button type="button" className="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <h2 id="panel-title" className="panel__title">
          {node.label}
        </h2>
        <div className="panel__path">
          <span>{relPath || node.id.split('::')[0]}</span>
          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Copy path" title="Copy path" onClick={copyPath}>
            <Copy size={13} />
          </button>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="btn"
            aria-pressed={focusDepth > 0}
            onClick={() => onFocusDepthChange(focusDepth > 0 ? 0 : 1)}
            title="Show only nearby nodes (X)"
          >
            <Crosshair size={14} aria-hidden="true" />
            Focus
          </button>
          {focusDepth > 0 && (
            <label className="depth">
              Depth
              <select value={focusDepth} onChange={(e) => onFocusDepthChange(Number(e.target.value))}>
                {[1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="btn" onClick={onFindPath} title="Find how this connects to another node (P)">
            <Route size={14} aria-hidden="true" />
            Find path
          </button>
          {repo && (
            <a className="btn" href={githubUrl(repo, node, startLine)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              Open on GitHub
            </a>
          )}
        </div>
      </header>

      <div className="panel__body">
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
                    <button type="button" className="conn-item" data-current={id === node.id} onClick={() => onSelect(id)} title={id}>
                      <span className="dot" style={{ background: colorOf(step) }} aria-hidden="true" />
                      <span className="conn-item__name">{step.label}</span>
                      <span className="conn-item__where">{KIND_LABEL[nodeKind(step)].one}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <button type="button" className="link-btn" onClick={onClearPath}>
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
              <ConnectionGroup key={title} title={title} ids={ids} nodesById={nodesById} colorOf={colorOf} onSelect={onSelect} />
            ))
          )}
        </section>

        <section className="panel__section" aria-labelledby="code-title">
          <h3 id="code-title">Source</h3>
          {node.code ? (
            <div className="code-block">
              <SyntaxHighlighter
                language={node.id.split('::')[0].endsWith('.tsx') ? 'tsx' : node.language || 'text'}
                style={theme === 'dark' ? atomDark : LIGHT_CODE_STYLE}
                showLineNumbers
                startingLineNumber={startLine ?? 1}
                wrapLongLines
                customStyle={{ margin: 0, padding: '14px 12px', background: 'transparent' }}
              >
                {node.code}
              </SyntaxHighlighter>
            </div>
          ) : (
            <p className="panel__note">The analyzer did not capture source for this node.</p>
          )}
        </section>
      </div>
    </aside>
  );
};

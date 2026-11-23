import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, ListTree, Minus, Plus, Search, WrapText, IndentDecrease, FileCode } from 'lucide-react';
import { CodeView, type CodeViewHandle, type LineRange, type Viewport } from './CodeView';
import { findAll } from './editorExtensions';
import { codeMetrics, enclosingScopes, metricLevel } from '../../utils/codeAnalysis';

export interface OutlineItem {
  id: string;
  label: string;
  kindLabel: string;
  color: string;
  /** Absolute start/end lines in the file. */
  line: number;
  endLine: number;
}

export interface ReaderSettings {
  wrap: boolean;
  compact: boolean;
  fontSize: number;
}

interface CodeReaderProps {
  code: string;
  language: string;
  firstLine: number;
  label: string;
  outline: OutlineItem[];
  /** For a symbol: opens its file at this symbol's lines. */
  onOpenInFile?: () => void;
  symbolNames: ReadonlyMap<string, string>;
  onSymbolClick: (name: string) => void;
  highlight: LineRange | null;
  onHighlightChange: (range: LineRange | null) => void;
  /** Changing `key` scrolls to `line`. */
  scrollTarget: { line: number; key: string } | null;
  settings: ReaderSettings;
  onSettingsChange: (next: ReaderSettings) => void;
  /** Incrementing this focuses the search box. */
  searchFocusSignal: number;
  onNotify: (message: string) => void;
}

const MAX_MARKERS = 400;

/** Line numbers (1-based within `code`) of character positions. */
const linesOf = (code: string, positions: number[]) => {
  const breaks: number[] = [];
  for (let i = code.indexOf('\n'); i >= 0; i = code.indexOf('\n', i + 1)) breaks.push(i);
  return positions.map((pos) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  });
};

export const CodeReader = (props: CodeReaderProps) => {
  const { code, firstLine, settings, onSettingsChange } = props;
  const viewRef = useRef<CodeViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [viewport, setViewport] = useState<Viewport>({ top: firstLine, bottom: firstLine });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const anchor = useRef<number | null>(null);

  const lines = useMemo(() => code.split('\n'), [code]);
  const metrics = useMemo(() => codeMetrics(code), [code]);
  const lastLine = firstLine + lines.length - 1;
  const searchTerm = /^:\d*$/.test(term) ? '' : term;
  const matches = useMemo(() => findAll(code, searchTerm), [code, searchTerm]);
  const matchLines = useMemo(() => linesOf(code, matches.slice(0, MAX_MARKERS)), [code, matches]);

  // Headers of the blocks that enclose the top of the viewport (sticky scroll).
  const scopes = useMemo(() => {
    const top = viewport.top - firstLine;
    const first = enclosingScopes(lines, top, 4);
    return enclosingScopes(lines, Math.min(lines.length - 1, top + first.length), 4);
  }, [lines, viewport.top, firstLine]);

  useEffect(() => {
    if (props.searchFocusSignal === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- G shortcut pre-fills go-to-line
    if (props.searchFocusSignal < 0) setTerm(':');
    searchRef.current?.focus();
  }, [props.searchFocusSignal]);

  useEffect(() => {
    if (!props.scrollTarget) return;
    // Wait a frame so a freshly loaded document is laid out first.
    const id = requestAnimationFrame(() => viewRef.current?.scrollToLine(props.scrollTarget!.line));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scrollTarget?.key]);

  const setSetting = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  // `:120` in the search box means "go to line 120".
  const goTo = term.match(/^:(\d+)$/);
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && goTo) {
      e.preventDefault();
      const line = Math.min(Math.max(Number(goTo[1]), firstLine), lastLine);
      props.onHighlightChange({ from: line, to: line });
      viewRef.current?.scrollToLine(line, { select: true });
      setTerm('');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) viewRef.current?.findPrevious();
      else viewRef.current?.findNext();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setTerm('');
      viewRef.current?.focus();
    }
  };

  const onFold = (value: string) => {
    const view = viewRef.current;
    if (!view) return;
    if (value === 'all') view.foldAll();
    else if (value === 'none') view.unfoldAll();
    else {
      const folded = view.foldDeeperThan(Number(value));
      props.onNotify(folded ? `Folded ${folded} blocks below depth ${value}` : `Nothing is nested deeper than ${value}`);
    }
  };

  const onLineClick = (line: number, extend: boolean) => {
    if (extend && anchor.current !== null) {
      const from = Math.min(anchor.current, line);
      props.onHighlightChange({ from, to: Math.max(anchor.current, line) });
    } else if (props.highlight && props.highlight.from === line && props.highlight.to === line) {
      anchor.current = null;
      props.onHighlightChange(null);
    } else {
      anchor.current = line;
      props.onHighlightChange({ from: line, to: line });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      props.onNotify('Code copied');
    } catch {
      props.onNotify('Could not copy the code');
    }
  };

  const pct = (line: number) => `${((line - firstLine) / Math.max(1, lines.length)) * 100}%`;

  const onStripClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    viewRef.current?.scrollToLine(Math.round(firstLine + ratio * lines.length));
  };

  const level = (m: 'lines' | 'maxDepth' | 'complexity', v: number) => metricLevel(m, v);

  return (
    <div className="reader" style={{ ['--code-font-size' as string]: `${settings.fontSize}px` }}>
      <div className="reader__toolbar" role="toolbar" aria-label="Code reading options">
        <div className="reader__search" role="search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Find in code"
            placeholder="Find, or :line to jump"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setMatchIndex(-1);
            }}
            onKeyDown={onSearchKey}
          />
          {searchTerm && (
            <span className="reader__count" aria-live="polite">
              {matches.length === 0 ? 'No matches' : `${matchIndex >= 0 ? matchIndex + 1 : 0} of ${matches.length}`}
            </span>
          )}
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Previous match" disabled={!matches.length} onClick={() => viewRef.current?.findPrevious()}>
            <ChevronUp size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Next match" disabled={!matches.length} onClick={() => viewRef.current?.findNext()}>
            <ChevronDown size={14} />
          </button>
        </div>

        <button type="button" className="icon-btn" aria-pressed={settings.wrap} aria-label="Wrap long lines" title="Wrap long lines (W)" onClick={() => setSetting('wrap', !settings.wrap)}>
          <WrapText size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={settings.compact}
          aria-label="Compact indentation"
          title="Draw indentation at half width"
          onClick={() => setSetting('compact', !settings.compact)}
        >
          <IndentDecrease size={16} />
        </button>
        <select className="reader__select" aria-label="Fold code" value="" onChange={(e) => onFold(e.target.value)}>
          <option value="" disabled>
            Fold
          </option>
          <option value="all">Fold all</option>
          <option value="none">Unfold all</option>
          {[1, 2, 3, 4].filter((d) => d < metrics.maxDepth).map((d) => (
            <option key={d} value={d}>
              Show {d} {d === 1 ? 'level' : 'levels'}
            </option>
          ))}
        </select>

        {props.outline.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn--quiet"
              aria-haspopup="true"
              aria-expanded={outlineOpen}
              onClick={() => setOutlineOpen((o) => !o)}
            >
              <ListTree size={14} aria-hidden="true" />
              Outline
            </button>
            {outlineOpen && (
              <ul className="menu outline" aria-label="Symbols in this file">
                {props.outline.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOutlineOpen(false);
                        props.onHighlightChange({ from: item.line, to: item.endLine });
                        viewRef.current?.scrollToLine(item.line);
                      }}
                    >
                      <span className="outline__name">
                        <span className="dot" style={{ background: item.color }} aria-hidden="true" />
                        {item.label}
                      </span>
                      <small>
                        {item.kindLabel}, line {item.line}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {props.onOpenInFile && (
          <button type="button" className="btn btn--quiet" onClick={props.onOpenInFile} title="Open the whole file at this symbol">
            <FileCode size={14} aria-hidden="true" />
            View in file
          </button>
        )}

        <span className="reader__spacer" />
        <button type="button" className="icon-btn" aria-label="Smaller text" disabled={settings.fontSize <= 11} onClick={() => setSetting('fontSize', settings.fontSize - 1)}>
          <Minus size={14} />
        </button>
        <span className="reader__font" aria-label={`Text size ${settings.fontSize} pixels`}>
          {settings.fontSize}
        </span>
        <button type="button" className="icon-btn" aria-label="Larger text" disabled={settings.fontSize >= 20} onClick={() => setSetting('fontSize', settings.fontSize + 1)}>
          <Plus size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label="Copy code" title="Copy code" onClick={() => void copy()}>
          <Copy size={14} />
        </button>
      </div>

      <div className="reader__metrics" aria-label="Code metrics">
        <span data-level={level('lines', metrics.lines)}>{metrics.lines} {metrics.lines === 1 ? 'line' : 'lines'}</span>
        <span data-level={level('maxDepth', metrics.maxDepth)}>Nesting depth {metrics.maxDepth}</span>
        <span data-level={level('complexity', metrics.complexity)} title="Approximate: 1 + number of branches (if, for, match, &&, ||…)">
          Complexity {metrics.complexity}
        </span>
        {props.highlight && (
          <span className="reader__selection">
            {props.highlight.from === props.highlight.to ? `Line ${props.highlight.from}` : `Lines ${props.highlight.from}–${props.highlight.to}`} selected
            <button type="button" className="link-btn" onClick={() => props.onHighlightChange(null)}>
              Clear
            </button>
          </span>
        )}
      </div>

      <div className="reader__body">
        {scopes.length > 0 && (
          <nav className="reader__scopes" aria-label="Enclosing blocks">
            {scopes.map((s) => (
              <button
                key={s.line}
                type="button"
                className="reader__scope"
                onClick={() => viewRef.current?.scrollToLine(s.line + firstLine)}
                title={`Go to line ${s.line + firstLine}`}
              >
                <span className="reader__scope-num">{s.line + firstLine}</span>
                <span className="reader__scope-text" style={{ paddingLeft: `${Math.min(s.text.length - s.text.trimStart().length, 24) * (settings.compact ? 0.5 : 1)}ch` }}>
                  {s.text.trim()}
                </span>
              </button>
            ))}
          </nav>
        )}
        <CodeView
          ref={viewRef}
          code={code}
          language={props.language}
          firstLine={firstLine}
          wrap={settings.wrap}
          compact={settings.compact}
          searchTerm={searchTerm}
          symbolNames={props.symbolNames}
          onSymbolClick={props.onSymbolClick}
          highlight={props.highlight}
          onLineClick={onLineClick}
          onViewportChange={setViewport}
          onSearchIndexChange={setMatchIndex}
          ariaLabel={`Source of ${props.label}`}
        />
        <div className="reader__overview" aria-hidden="true" onClick={onStripClick} title="Overview: click to jump">
          <div className="reader__viewport" style={{ top: pct(viewport.top), height: `max(4px, calc(${pct(viewport.bottom + 1)} - ${pct(viewport.top)}))` }} />
          {props.highlight && (
            <div className="reader__mark reader__mark--range" style={{ top: pct(props.highlight.from), height: `max(3px, calc(${pct(props.highlight.to + 1)} - ${pct(props.highlight.from)}))` }} />
          )}
          {props.outline.map((o) => (
            <div key={o.id} className="reader__mark reader__mark--symbol" style={{ top: pct(o.line), background: o.color }} />
          ))}
          {matchLines.map((l, i) => (
            <div key={i} className="reader__mark reader__mark--match" style={{ top: pct(l + firstLine - 1) }} />
          ))}
        </div>
      </div>
      <span className="visually-hidden">
        Lines {firstLine} to {lastLine}
      </span>
    </div>
  );
};

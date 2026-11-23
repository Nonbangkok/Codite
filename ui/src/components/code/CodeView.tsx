import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { codeFolding, foldAll, foldGutter, syntaxHighlighting, unfoldAll } from '@codemirror/language';
import { defaultKeymap } from '@codemirror/commands';
import {
  codeHighlightStyle,
  docLines,
  findAll,
  foldDeeperThan,
  indentation,
  indentationFolding,
  lineHighlight,
  loadLanguage,
  searchHighlight,
  symbolLinks,
} from './editorExtensions';

export interface LineRange {
  from: number;
  to: number;
}

export interface CodeViewHandle {
  /** Scrolls so `line` (absolute file line) is near the top; optionally moves the cursor there. */
  scrollToLine(line: number, opts?: { select?: boolean }): void;
  foldAll(): void;
  unfoldAll(): void;
  foldDeeperThan(depth: number): number;
  /** Moves to the next/previous search match; returns its 0-based index or -1. */
  findNext(): number;
  findPrevious(): number;
  focus(): void;
}

export interface Viewport {
  /** First and last visible absolute line numbers. */
  top: number;
  bottom: number;
}

interface CodeViewProps {
  code: string;
  language: string;
  /** Absolute line number of the first line of `code`. */
  firstLine: number;
  wrap: boolean;
  compact: boolean;
  searchTerm: string;
  symbolNames: ReadonlyMap<string, string>;
  onSymbolClick: (name: string) => void;
  /** Absolute line range to tint. */
  highlight: LineRange | null;
  onLineClick: (line: number, extend: boolean) => void;
  onViewportChange: (viewport: Viewport) => void;
  onSearchIndexChange?: (index: number) => void;
  ariaLabel: string;
}

const readerTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--code-bg)', color: 'var(--code-text)', fontSize: 'var(--code-font-size, 13px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '8px 0 40vh', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-gutter)', border: 'none', paddingLeft: '4px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '3.5ch', cursor: 'pointer' },
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--text)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-selection) !important' },
  '.cm-foldGutter .cm-gutterElement': { width: '14px', cursor: 'pointer', color: 'var(--code-gutter)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--accent-soft)',
    border: '1px solid var(--accent)',
    color: 'var(--accent-text)',
    borderRadius: '4px',
    padding: '0 6px',
    margin: '0 4px',
  },
});

export const CodeView = forwardRef<CodeViewHandle, CodeViewProps>((props, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  const matchIndex = useRef(-1);

  const compartments = useRef({
    language: new Compartment(),
    gutter: new Compartment(),
    wrap: new Compartment(),
    indent: new Compartment(),
    search: new Compartment(),
    symbols: new Compartment(),
    highlight: new Compartment(),
  }).current;

  const gutterFor = (offset: number) =>
    lineNumbers({
      formatNumber: (n) => String(n + offset),
      domEventHandlers: {
        mousedown(view, block, event) {
          const n = view.state.doc.lineAt(block.from).number + offset;
          propsRef.current.onLineClick(n, (event as MouseEvent).shiftKey);
          return true;
        },
      },
    });

  const buildState = () => {
    const p = propsRef.current;
    const offset = p.firstLine - 1;
    return EditorState.create({
      doc: p.code,
      extensions: [
        docLines,
        EditorState.readOnly.of(true),
        EditorState.tabSize.of(4),
        EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel, 'aria-readonly': 'true' }),
        compartments.gutter.of(gutterFor(offset)),
        codeFolding({ placeholderText: '…' }),
        foldGutter({ openText: '▾', closedText: '▸' }),
        indentationFolding,
        drawSelection(),
        highlightActiveLine(),
        keymap.of(defaultKeymap),
        syntaxHighlighting(codeHighlightStyle),
        readerTheme,
        compartments.language.of([]),
        compartments.wrap.of(p.wrap ? EditorView.lineWrapping : []),
        compartments.indent.of(indentation({ compact: p.compact, wrap: p.wrap })),
        compartments.search.of(searchHighlight(p.searchTerm)),
        compartments.symbols.of(symbolLinks(p.symbolNames, (name) => propsRef.current.onSymbolClick(name))),
        compartments.highlight.of(lineHighlight(toDocRange(p.highlight, p.firstLine))),
        EditorView.updateListener.of((u) => {
          if (u.viewportChanged || u.geometryChanged) reportViewport(u.view);
        }),
      ],
    });
  };

  const reportViewport = (view: EditorView) => {
    const offset = propsRef.current.firstLine - 1;
    const scrollTop = view.scrollDOM.scrollTop;
    const top = view.lineBlockAtHeight(scrollTop);
    const bottom = view.lineBlockAtHeight(scrollTop + view.scrollDOM.clientHeight - 1);
    propsRef.current.onViewportChange({
      top: view.state.doc.lineAt(top.from).number + offset,
      bottom: view.state.doc.lineAt(bottom.from).number + offset,
    });
  };

  // Create the editor once.
  useEffect(() => {
    const view = new EditorView({ state: buildState(), parent: hostRef.current! });
    viewRef.current = view;
    const onScroll = () => reportViewport(view);
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; props flow in via effects
  }, []);

  // New document: fresh state (also resets folds and scroll).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== props.code) {
      view.setState(buildState());
      matchIndex.current = -1;
    }
    let cancelled = false;
    void loadLanguage(props.language).then((support) => {
      if (!cancelled && support && viewRef.current) {
        viewRef.current.dispatch({ effects: compartments.language.reconfigure(support) });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.code, props.language]);

  const reconfigure = (compartment: Compartment, ext: Parameters<Compartment['reconfigure']>[0]) =>
    viewRef.current?.dispatch({ effects: compartment.reconfigure(ext) });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => reconfigure(compartments.gutter, gutterFor(props.firstLine - 1)), [props.firstLine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => reconfigure(compartments.wrap, props.wrap ? EditorView.lineWrapping : []), [props.wrap]);
  useEffect(
    () => reconfigure(compartments.indent, indentation({ compact: props.compact, wrap: props.wrap })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.compact, props.wrap],
  );
  useEffect(() => {
    reconfigure(compartments.search, searchHighlight(props.searchTerm));
    matchIndex.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.searchTerm]);
  useEffect(
    () => reconfigure(compartments.symbols, symbolLinks(props.symbolNames, (name) => propsRef.current.onSymbolClick(name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.symbolNames],
  );
  useEffect(
    () => reconfigure(compartments.highlight, lineHighlight(toDocRange(props.highlight, props.firstLine))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.highlight?.from, props.highlight?.to, props.firstLine],
  );

  const goToMatch = (direction: 1 | -1) => {
    const view = viewRef.current;
    const term = propsRef.current.searchTerm;
    if (!view || !term) return -1;
    const matches = findAll(view.state.doc.toString(), term);
    if (matches.length === 0) return -1;
    const next = (matchIndex.current + direction + matches.length) % matches.length;
    matchIndex.current = next;
    const from = matches[next];
    view.dispatch({
      selection: EditorSelection.single(from, from + term.length),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    propsRef.current.onSearchIndexChange?.(next);
    return next;
  };

  useImperativeHandle(ref, () => ({
    scrollToLine(line, opts) {
      const view = viewRef.current;
      if (!view) return;
      const n = Math.min(Math.max(1, line - (propsRef.current.firstLine - 1)), view.state.doc.lines);
      const pos = view.state.doc.line(n).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
        selection: opts?.select ? EditorSelection.cursor(pos) : undefined,
      });
    },
    foldAll: () => void (viewRef.current && foldAll(viewRef.current)),
    unfoldAll: () => void (viewRef.current && unfoldAll(viewRef.current)),
    foldDeeperThan: (depth) => (viewRef.current ? foldDeeperThan(viewRef.current, depth) : 0),
    findNext: () => goToMatch(1),
    findPrevious: () => goToMatch(-1),
    focus: () => viewRef.current?.focus(),
  }));

  return <div ref={hostRef} className="code-view" data-wrap={props.wrap} data-compact={props.compact} />;
});
CodeView.displayName = 'CodeView';

const toDocRange = (range: LineRange | null, firstLine: number) =>
  range ? { from: range.from - firstLine + 1, to: range.to - firstLine + 1 } : null;

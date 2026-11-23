import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { HighlightStyle, foldEffect, foldService, unfoldAll, type LanguageSupport } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { blocksDeeperThan, detectIndentUnit, indentBlockEnd, indentColumns } from '../../utils/codeAnalysis';

/** The document split into lines once; the reader never edits, so this is computed once per file. */
export const docLines = StateField.define<string[]>({
  create: (state) => state.doc.toString().split('\n'),
  update: (value, tr) => (tr.docChanged ? tr.state.doc.toString().split('\n') : value),
});

/** Folds any line whose following lines are indented deeper — works for every language. */
export const indentationFolding = foldService.of((state, lineStart) => {
  const lines = state.field(docLines, false) ?? state.doc.toString().split('\n');
  const line = state.doc.lineAt(lineStart);
  const end = indentBlockEnd(lines, line.number - 1);
  if (end === null) return null;
  // Keep a closing `}` visible so folded blocks read as `if x { … }`.
  const closing = /^\s*[)}\]]/.test(lines[end]) && end > line.number;
  const last = state.doc.line((closing ? end : end + 1));
  return { from: line.to, to: closing ? last.from - 1 : last.to };
});

/** Folds every indentation block that starts `depth` levels deep. */
export const foldDeeperThan = (view: EditorView, depth: number) => {
  unfoldAll(view);
  const lines = view.state.field(docLines);
  const effects = blocksDeeperThan(lines, depth)
    .map(([start, end]) => {
      const range = indentationRange(view.state, start, end);
      return range ? foldEffect.of(range) : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (effects.length) view.dispatch({ effects });
  return effects.length;
};

const indentationRange = (state: EditorState, start: number, end: number) => {
  const from = state.doc.line(start + 1).to;
  const lines = state.field(docLines);
  const closing = /^\s*[)}\]]/.test(lines[end]) && end > start;
  const to = closing ? state.doc.line(end + 1).from - 1 : state.doc.line(end + 1).to;
  return to > from ? { from, to } : null;
};

export interface IndentOptions {
  /** Draw indentation at half width (2 columns per 4-space level). */
  compact: boolean;
  /** Indent wrapped continuation lines under the start of their own line. */
  wrap: boolean;
}

/**
 * Indentation-aware rendering for the visible lines:
 *  - hanging indent so wrapped text continues under its own indentation (+2 columns),
 *  - compact indentation by narrowing leading whitespace,
 *  - indent guides painted on the leading whitespace.
 */
export const indentation = ({ compact, wrap }: IndentOptions): Extension => {
  const scale = compact ? 0.5 : 1;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const lines = view.state.field(docLines);
        const unit = detectIndentUnit(lines) * scale;
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos);
            const text = line.text;
            const ws = text.length - text.trimStart().length;
            const cols = indentColumns(text) * scale;
            if (wrap) {
              const hang = cols + 2;
              builder.add(
                line.from,
                line.from,
                Decoration.line({ attributes: { style: `padding-left: calc(${hang}ch + 6px); text-indent: -${hang}ch` } }),
              );
            }
            if (ws > 0 && ws < text.length) {
              builder.add(
                line.from,
                line.from + ws,
                Decoration.mark({
                  class: compact ? 'cm-indent cm-indent-compact' : 'cm-indent',
                  attributes: { style: `background-size: ${unit}ch 100%` },
                }),
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Highlights every visible match of `term` (case-insensitive). */
export const searchHighlight = (term: string): Extension => {
  if (!term) return [];
  const pattern = new RegExp(escapeRegExp(term), 'gi');
  const mark = Decoration.mark({ class: 'cm-search-match' });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          pattern.lastIndex = 0;
          for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
            if (m[0].length === 0) break;
            builder.add(from + m.index, from + m.index + m[0].length, mark);
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
};

/** Positions of every match of `term` in the document (case-insensitive). */
export const findAll = (doc: string, term: string): number[] => {
  if (!term) return [];
  const hay = doc.toLowerCase();
  const needle = term.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(needle.length, 1))) out.push(i);
  return out;
};

/** Underlines identifiers that name a node in the graph; clicking one calls `onClick(name)`. */
export const symbolLinks = (names: ReadonlyMap<string, string>, onClick: (name: string) => void): Extension => {
  if (names.size === 0) return [];
  const ident = /[A-Za-z_][A-Za-z0-9_]*/g;
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          ident.lastIndex = 0;
          for (let m = ident.exec(text); m; m = ident.exec(text)) {
            const title = names.get(m[0]);
            if (!title) continue;
            builder.add(
              from + m.index,
              from + m.index + m[0].length,
              Decoration.mark({ class: 'cm-symbol-link', attributes: { 'data-symbol': m[0], title } }),
            );
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
  const clicks = EditorView.domEventHandlers({
    click(event) {
      const target = (event.target as HTMLElement).closest<HTMLElement>('.cm-symbol-link');
      if (!target || !window.getSelection()?.isCollapsed) return false;
      onClick(target.dataset.symbol!);
      return true;
    },
  });
  return [plugin, clicks];
};

/** Tints an inclusive range of document lines (1-based, relative to the document). */
export const lineHighlight = (range: { from: number; to: number } | null): Extension => {
  if (!range) return [];
  return EditorView.decorations.of((view) => {
    const builder = new RangeSetBuilder<Decoration>();
    const deco = Decoration.line({ class: 'cm-line-highlight' });
    const last = Math.min(range.to, view.state.doc.lines);
    for (let n = Math.max(1, range.from); n <= last; n++) builder.add(view.state.doc.line(n).from, view.state.doc.line(n).from, deco);
    return builder.finish();
  });
};

/** Syntax colors come from CSS variables so both themes stay in sync with the app tokens. */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--code-type)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--code-definition)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--code-punctuation)' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: 'var(--code-meta)' },
]);

/** Lazy language support per analyzer language; each grammar is a separate chunk. */
const loaders: Record<string, () => Promise<LanguageSupport>> = {
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
};
const loaded = new Map<string, Promise<LanguageSupport | null>>();

export const loadLanguage = (language: string): Promise<LanguageSupport | null> => {
  if (!loaded.has(language)) {
    const loader = loaders[language];
    loaded.set(language, loader ? loader().catch(() => null) : Promise.resolve(null));
  }
  return loaded.get(language)!;
};

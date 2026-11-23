import type { GraphData, NodeData } from '../types';
import { codeMetrics } from './codeAnalysis';
import { KIND_LABEL, isSymbolId, languageLabel, nodeKind } from './nodeKinds';
import { DEPENDENCY_TYPES } from './graphAnalysis';

export interface RankedNode {
  id: string;
  label: string;
  value: number;
  detail?: string;
}

export interface HealthCheck {
  id: 'cycles' | 'orphans' | 'long' | 'deep' | 'complex';
  title: string;
  description: string;
  severity: 'info' | 'warn' | 'high';
  /** Each item is a list of node ids (a cycle has several; other checks have one). */
  items: { ids: string[]; detail: string }[];
}

export interface Insights {
  totals: { files: number; symbols: number; links: number; codeLines: number; languages: number };
  languages: { language: string; label: string; files: number; lines: number }[];
  kinds: { kind: string; label: string; count: number }[];
  largestFiles: RankedNode[];
  longestFunctions: RankedNode[];
  mostComplex: RankedNode[];
  mostImported: RankedNode[];
  mostDependencies: RankedNode[];
  checks: HealthCheck[];
}

export const LIMITS = { longFunction: 80, deepNesting: 5, complexity: 15 };

const isFile = (n: NodeData) => !isSymbolId(n.id) && n.group !== 'folders';
const isCallable = (n: NodeData) => nodeKind(n) === 'functions';
const top = (list: RankedNode[], n = 10) => list.filter((r) => r.value > 0).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, n);

/** Files that are usually entry points, configuration or tests, so "nothing imports them" is expected. */
const ENTRY = /(^|\/)(main|index|lib|mod|app|server|cli|build|setup|__init__|__main__|vite\.config|eslint\.config|playwright\.config|vitest\.config)\.[a-z]+$|(^|\/)(tests?|__tests__|e2e|examples?|scripts?|bin)\/|\.(test|spec)\.[a-z]+$|_test\.(go|rs)$/i;

/** Strongly connected components with more than one node (iterative Tarjan). */
export const findCycles = (ids: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[][] => {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  for (const root of ids) {
    if (index.has(root)) continue;
    const work: { id: string; next: number }[] = [{ id: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = edges.get(frame.id) ?? [];
      if (frame.next < succ.length) {
        const w = succ[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.id);
        const selfLoop = component.length === 1 && (edges.get(frame.id) ?? []).includes(frame.id);
        if (component.length > 1 || selfLoop) out.push(component.reverse());
      }
    }
  }
  return out;
};

export const computeInsights = (graph: GraphData): Insights => {
  const files = graph.nodes.filter(isFile);
  const symbols = graph.nodes.filter((n) => isSymbolId(n.id) && nodeKind(n) !== 'imports');
  const metrics = new Map(graph.nodes.filter((n) => n.code).map((n) => [n.id, codeMetrics(n.code!)]));
  const codeLines = files.reduce((sum, f) => sum + (metrics.get(f.id)?.codeLines ?? 0), 0);

  const byLanguage = new Map<string, { files: number; lines: number }>();
  for (const f of files) {
    const entry = byLanguage.get(f.language) ?? { files: 0, lines: 0 };
    entry.files++;
    entry.lines += metrics.get(f.id)?.codeLines ?? 0;
    byLanguage.set(f.language, entry);
  }
  const kindCounts = new Map<string, number>();
  for (const s of symbols) kindCounts.set(nodeKind(s), (kindCounts.get(nodeKind(s)) ?? 0) + 1);

  // File-level dependency graph: a symbol's links count for its file.
  const fileOf = (id: string) => id.split('::')[0];
  const fileIds = new Set(files.map((f) => f.id));
  const deps = new Map<string, Set<string>>();
  for (const link of graph.links) {
    if (!DEPENDENCY_TYPES.has(link.type)) continue;
    const s = fileOf(typeof link.source === 'string' ? link.source : link.source.id);
    const t = fileOf(typeof link.target === 'string' ? link.target : link.target.id);
    if (!fileIds.has(s) || !fileIds.has(t) || s === t) continue;
    if (!deps.has(s)) deps.set(s, new Set());
    deps.get(s)!.add(t);
  }
  const importedBy = new Map<string, number>();
  for (const targets of deps.values()) for (const t of targets) importedBy.set(t, (importedBy.get(t) ?? 0) + 1);

  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const ranked = (list: NodeData[], value: (n: NodeData) => number, detail?: (n: NodeData) => string) =>
    list.map((n) => ({ id: n.id, label: n.label, value: value(n), detail: detail?.(n) }));
  const fileName = (n: NodeData) => fileOf(n.id).split('/').slice(1).join('/');

  const cycles = findCycles([...fileIds].sort(), new Map([...deps].map(([k, v]) => [k, [...v].sort()])));
  const orphans = files.filter((f) => !importedBy.has(f.id) && !ENTRY.test(fileOf(f.id)) && fileIds.size > 1);
  const callables = symbols.filter(isCallable);
  const long = callables.filter((n) => (metrics.get(n.id)?.lines ?? 0) > LIMITS.longFunction);
  const deep = callables.filter((n) => (metrics.get(n.id)?.maxDepth ?? 0) > LIMITS.deepNesting);
  const complex = callables.filter((n) => (metrics.get(n.id)?.complexity ?? 0) > LIMITS.complexity);
  const bySize = (key: 'lines' | 'maxDepth' | 'complexity') => (a: NodeData, b: NodeData) => (metrics.get(b.id)?.[key] ?? 0) - (metrics.get(a.id)?.[key] ?? 0);

  const checks: HealthCheck[] = [
    {
      id: 'cycles',
      title: 'Import cycles',
      description: 'Files that import each other in a loop. Cycles make code harder to change and to load in order.',
      severity: cycles.length ? 'high' : 'info',
      items: cycles.map((c) => ({ ids: c, detail: `${c.map((id) => label(id)).join(' → ')} → ${label(c[0])}` })),
    },
    {
      id: 'complex',
      title: `Functions with complexity above ${LIMITS.complexity}`,
      description: 'Many branches in one function. Consider splitting it or simplifying conditions.',
      severity: complex.length ? 'warn' : 'info',
      items: complex.sort(bySize('complexity')).map((n) => ({ ids: [n.id], detail: `${n.label}: complexity ${metrics.get(n.id)!.complexity}, in ${fileName(n)}` })),
    },
    {
      id: 'long',
      title: `Functions longer than ${LIMITS.longFunction} lines`,
      description: 'Long functions are hard to read in one pass.',
      severity: long.length ? 'warn' : 'info',
      items: long.sort(bySize('lines')).map((n) => ({ ids: [n.id], detail: `${n.label}: ${metrics.get(n.id)!.lines} lines, in ${fileName(n)}` })),
    },
    {
      id: 'deep',
      title: `Nesting deeper than ${LIMITS.deepNesting} levels`,
      description: 'Deeply nested blocks hide the main path. Early returns usually help.',
      severity: deep.length ? 'warn' : 'info',
      items: deep.sort(bySize('maxDepth')).map((n) => ({ ids: [n.id], detail: `${n.label}: depth ${metrics.get(n.id)!.maxDepth}, in ${fileName(n)}` })),
    },
    {
      id: 'orphans',
      title: 'Files nothing imports',
      description: 'Not imported by any other scanned file and not an obvious entry point, test or config. They may be unused.',
      severity: 'info',
      items: orphans.map((f) => ({ ids: [f.id], detail: fileName(f) })),
    },
  ];

  return {
    totals: { files: files.length, symbols: symbols.length, links: graph.links.length, codeLines, languages: byLanguage.size },
    languages: [...byLanguage]
      .map(([language, v]) => ({ language, label: languageLabel(language), ...v }))
      .sort((a, b) => b.lines - a.lines),
    kinds: [...kindCounts].map(([kind, count]) => ({ kind, label: KIND_LABEL[kind as keyof typeof KIND_LABEL]?.many ?? kind, count })).sort((a, b) => b.count - a.count),
    largestFiles: top(ranked(files, (n) => metrics.get(n.id)?.codeLines ?? 0, fileName)),
    longestFunctions: top(ranked(callables, (n) => metrics.get(n.id)?.lines ?? 0, fileName)),
    mostComplex: top(ranked(callables, (n) => metrics.get(n.id)?.complexity ?? 0, fileName)),
    mostImported: top(ranked(files, (n) => importedBy.get(n.id) ?? 0, fileName)),
    mostDependencies: top(ranked(files, (n) => deps.get(n.id)?.size ?? 0, fileName)),
    checks,
  };
};

const mdEscape = (s: string) => s.replace(/([|\\`*_])/g, '\\$1');

/** A Markdown report suitable for an issue, a PR description or a wiki page. */
export const insightsToMarkdown = (insights: Insights, project: string, date = new Date()): string => {
  const t = insights.totals;
  const rows = (list: RankedNode[], unit: string) =>
    list.length ? list.map((r, i) => `| ${i + 1} | ${mdEscape(r.label)} | ${mdEscape(r.detail ?? '')} | ${r.value} ${unit} |`).join('\n') : '| | None | | |';
  const table = (title: string, list: RankedNode[], unit: string) =>
    `### ${title}\n\n| # | Name | Where | Value |\n| - | - | - | - |\n${rows(list, unit)}\n`;
  return [
    `# Codite report: ${project}`,
    '',
    `Generated ${date.toISOString().slice(0, 10)}.`,
    '',
    '## Summary',
    '',
    `- ${t.files} files, ${t.symbols} symbols, ${t.codeLines} lines of code`,
    `- ${t.languages} languages: ${insights.languages.map((l) => `${l.label} (${l.files} files, ${l.lines} lines)`).join(', ') || 'none'}`,
    `- ${t.links} connections`,
    '',
    '## Health checks',
    '',
    ...insights.checks.flatMap((c) => [
      `### ${c.items.length ? (c.severity === 'high' ? '🔴' : c.severity === 'warn' ? '🟡' : '🔵') : '✅'} ${c.title} (${c.items.length})`,
      '',
      c.description,
      '',
      ...(c.items.length ? c.items.slice(0, 50).map((i) => `- ${mdEscape(i.detail)}`) : ['None found.']),
      ...(c.items.length > 50 ? [`- …and ${c.items.length - 50} more`] : []),
      '',
    ]),
    '## Rankings',
    '',
    table('Largest files', insights.largestFiles, 'lines'),
    table('Longest functions', insights.longestFunctions, 'lines'),
    table('Most complex functions', insights.mostComplex, ''),
    table('Most imported files', insights.mostImported, 'importers'),
  ].join('\n');
};

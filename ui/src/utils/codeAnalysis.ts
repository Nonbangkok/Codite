/** Line-based helpers for reading code: indentation, folding, enclosing scopes and metrics. */

const TAB_WIDTH = 4;

/** Visual columns of leading whitespace (tabs count as TAB_WIDTH). */
export const indentColumns = (line: string): number => {
  let cols = 0;
  for (const ch of line) {
    if (ch === ' ') cols++;
    else if (ch === '\t') cols += TAB_WIDTH - (cols % TAB_WIDTH);
    else break;
  }
  return cols;
};

export const isBlank = (line: string) => line.trim().length === 0;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The indentation step used by the code (usually 2 or 4), detected from indentation changes. */
export const detectIndentUnit = (lines: readonly string[]): number => {
  const counts = new Map<number, number>();
  let prev = 0;
  for (const line of lines) {
    if (isBlank(line)) continue;
    const cols = indentColumns(line);
    const delta = Math.abs(cols - prev);
    if (delta > 0 && delta <= 8) counts.set(delta, (counts.get(delta) ?? 0) + 1);
    prev = cols;
  }
  if (counts.size === 0) return TAB_WIDTH;
  // The most common step wins; ties go to the smaller step.
  const [unit] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return unit === 1 ? [...counts.keys()].reduce(gcd) || 2 : unit;
};

/**
 * Last line (0-based) of the block opened by `index`: following lines indented deeper than it,
 * ignoring blank lines and including a closing line at the same indent (`}`, `)`, `]`, `end`).
 * Returns null when nothing is nested under the line.
 */
export const indentBlockEnd = (lines: readonly string[], index: number): number | null => {
  if (index < 0 || index >= lines.length || isBlank(lines[index])) return null;
  const base = indentColumns(lines[index]);
  let last: number | null = null;
  for (let i = index + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    const cols = indentColumns(lines[i]);
    if (cols > base) {
      last = i;
      continue;
    }
    if (last !== null && cols === base && /^\s*[)}\]]/.test(lines[i])) last = i;
    break;
  }
  return last;
};

export interface ScopeHeader {
  /** 0-based line index. */
  line: number;
  text: string;
}

/**
 * Lines that open the blocks enclosing `topLine` (0-based), outermost first: walking upward,
 * every non-blank line indented less than everything seen so far starts an enclosing block.
 */
export const enclosingScopes = (lines: readonly string[], topLine: number, max = 4): ScopeHeader[] => {
  if (topLine <= 0 || topLine >= lines.length) return [];
  let probe = topLine;
  while (probe < lines.length && isBlank(lines[probe])) probe++;
  if (probe >= lines.length) return [];
  let level = indentColumns(lines[probe]);
  const headers: ScopeHeader[] = [];
  for (let i = topLine - 1; i >= 0 && level > 0; i--) {
    if (isBlank(lines[i])) continue;
    const cols = indentColumns(lines[i]);
    if (cols < level) {
      headers.push({ line: i, text: lines[i] });
      level = cols;
    }
  }
  return headers.reverse().slice(-max);
};

/** All indentation blocks deeper than `depth` levels, as [startLine, endLine] (0-based). */
export const blocksDeeperThan = (lines: readonly string[], depth: number): [number, number][] => {
  const unit = detectIndentUnit(lines);
  const ranges: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    if (Math.round(indentColumns(lines[i]) / unit) !== depth) continue;
    const end = indentBlockEnd(lines, i);
    if (end !== null) {
      ranges.push([i, end]);
      i = end;
    }
  }
  return ranges;
};

const BRANCH = /\b(if|elif|else if|for|foreach|while|match|case|catch|except|switch|when|loop)\b|&&|\|\||\?\?|\?(?=\s)/g;

export interface CodeMetrics {
  lines: number;
  /** Lines with code (not blank). */
  codeLines: number;
  /** Deepest nesting, in indentation levels relative to the first line. */
  maxDepth: number;
  /** Rough cyclomatic complexity: 1 + number of branch points. */
  complexity: number;
  longLines: number;
  indentUnit: number;
}

export const codeMetrics = (code: string): CodeMetrics => {
  const lines = code.split('\n');
  const unit = detectIndentUnit(lines);
  const nonBlank = lines.filter((l) => !isBlank(l));
  const baseline = nonBlank.length ? Math.min(...nonBlank.map(indentColumns)) : 0;
  let maxDepth = 0;
  let complexity = 1;
  let longLines = 0;
  for (const line of nonBlank) {
    maxDepth = Math.max(maxDepth, Math.round((indentColumns(line) - baseline) / unit));
    const stripped = line.replace(/\/\/.*$|#.*$/, '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    complexity += stripped.match(BRANCH)?.length ?? 0;
    if (line.length > 100) longLines++;
  }
  return { lines: lines.length, codeLines: nonBlank.length, maxDepth, complexity, longLines, indentUnit: unit };
};

export type MetricLevel = 'ok' | 'warn' | 'high';

/** Thresholds for flagging code that is hard to read. */
export const metricLevel = (metric: 'lines' | 'maxDepth' | 'complexity', value: number): MetricLevel => {
  const limits = { lines: [80, 200], maxDepth: [4, 6], complexity: [10, 25] }[metric];
  return value > limits[1] ? 'high' : value > limits[0] ? 'warn' : 'ok';
};

/** Parses a `L=76` or `L=76-120` URL value into an inclusive 1-based range. */
export const parseLineRange = (value: string | null | undefined): { from: number; to: number } | null => {
  const m = value?.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return from >= 1 && to >= from ? { from, to } : null;
};

export const formatLineRange = (range: { from: number; to: number }) =>
  range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`;

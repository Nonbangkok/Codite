import { describe, expect, test } from 'vitest';
import {
  blocksDeeperThan,
  codeMetrics,
  detectIndentUnit,
  enclosingScopes,
  formatLineRange,
  indentBlockEnd,
  indentColumns,
  metricLevel,
  parseLineRange,
} from '../src/utils/codeAnalysis';

const rust = `fn parse() {
    for m in matches {
        match name {
            "func" => {
                if let Some(parent) = node.parent() {
                    let kind = parent.kind();

                    if kind == "block" {
                        continue;
                    }
                }
            }
            _ => {}
        }
    }
}`;
const lines = rust.split('\n');

describe('indentation', () => {
  test('counts spaces and tabs', () => {
    expect(indentColumns('    x')).toBe(4);
    expect(indentColumns('\tx')).toBe(4);
    expect(indentColumns('  \tx')).toBe(4);
    expect(indentColumns('x')).toBe(0);
  });
  test('detects 4-space and 2-space code', () => {
    expect(detectIndentUnit(lines)).toBe(4);
    expect(detectIndentUnit(['a', '  b', '    c', '  d'])).toBe(2);
    expect(detectIndentUnit(['one line'])).toBe(4);
  });
});

describe('indentBlockEnd', () => {
  test('includes nested lines, blank lines inside, and the closing brace', () => {
    expect(indentBlockEnd(lines, 0)).toBe(15);
    expect(indentBlockEnd(lines, 4)).toBe(10); // `if let Some` … its `}`
    expect(indentBlockEnd(lines, 7)).toBe(9);
  });
  test('returns null for leaf lines and blank lines', () => {
    expect(indentBlockEnd(lines, 5)).toBeNull();
    expect(indentBlockEnd(lines, 6)).toBeNull();
  });
});

describe('enclosingScopes', () => {
  test('lists the block openers above a line, outermost first', () => {
    const scopes = enclosingScopes(lines, 8).map((s) => s.line);
    expect(scopes).toEqual([2, 3, 4, 7]); // innermost four
    expect(enclosingScopes(lines, 8, 10).map((s) => s.line)).toEqual([0, 1, 2, 3, 4, 7]);
  });
  test('skips blank lines when finding the current level', () => {
    expect(enclosingScopes(lines, 6, 10).map((s) => s.line)).toEqual([0, 1, 2, 3, 4]);
    expect(enclosingScopes(lines, 0)).toEqual([]);
  });
});

describe('blocksDeeperThan', () => {
  test('finds blocks starting at the given depth', () => {
    expect(blocksDeeperThan(lines, 3)).toEqual([[3, 11]]);
    expect(blocksDeeperThan(lines, 4)).toEqual([[4, 10]]);
  });
});

describe('codeMetrics', () => {
  test('measures size, depth and branches', () => {
    const m = codeMetrics(rust);
    expect(m.lines).toBe(16);
    expect(m.codeLines).toBe(15);
    expect(m.maxDepth).toBe(6);
    expect(m.complexity).toBe(1 + 4); // for, match, if, if
  });
  test('ignores keywords in strings and comments', () => {
    expect(codeMetrics('x = "if for while" // if else\nlet y = 1').complexity).toBe(1);
  });
  test('levels', () => {
    expect(metricLevel('lines', 50)).toBe('ok');
    expect(metricLevel('lines', 150)).toBe('warn');
    expect(metricLevel('maxDepth', 9)).toBe('high');
  });
});

describe('line ranges', () => {
  test('parse and format', () => {
    expect(parseLineRange('76')).toEqual({ from: 76, to: 76 });
    expect(parseLineRange('76-120')).toEqual({ from: 76, to: 120 });
    expect(parseLineRange('120-76')).toBeNull();
    expect(parseLineRange('0')).toBeNull();
    expect(parseLineRange(null)).toBeNull();
    expect(formatLineRange({ from: 3, to: 3 })).toBe('3');
    expect(formatLineRange({ from: 3, to: 9 })).toBe('3-9');
  });
});

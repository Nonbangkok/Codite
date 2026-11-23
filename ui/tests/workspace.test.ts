import { describe, expect, test } from 'vitest';
import {
  EMPTY_HISTORY,
  canGoBack,
  canGoForward,
  closeTab,
  moveHistory,
  openTab,
  pruneTabs,
  pushHistory,
  recentIds,
  togglePin,
} from '../src/utils/workspace';
import { buildSearchIndex, searchIndex } from '../src/utils/codeSearch';

const e = (id: string, from?: number) => ({ id, range: from ? { from, to: from } : null });

describe('history', () => {
  test('push, back, forward and branching', () => {
    let h = pushHistory(pushHistory(pushHistory(EMPTY_HISTORY, e('a')), e('b')), e('c'));
    expect(h.index).toBe(2);
    h = moveHistory(h, -1);
    expect(h.stack[h.index].id).toBe('b');
    expect(canGoForward(h)).toBe(true);
    h = pushHistory(h, e('d')); // drops the forward entry "c"
    expect(h.stack.map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(canGoForward(h)).toBe(false);
    expect(moveHistory(moveHistory(moveHistory(h, -1), -1), -1).index).toBe(0);
    expect(canGoBack({ stack: [e('a')], index: 0 })).toBe(false);
  });
  test('ignores repeating the current entry but records a new line range', () => {
    const h = pushHistory(EMPTY_HISTORY, e('a'));
    expect(pushHistory(h, e('a'))).toBe(h);
    expect(pushHistory(h, e('a', 5)).stack).toHaveLength(2);
  });
  test('recent ids are distinct and newest first', () => {
    let h = EMPTY_HISTORY;
    for (const id of ['a', 'b', 'a', 'c', 'b']) h = pushHistory(h, e(id));
    expect(recentIds(h)).toEqual(['b', 'c', 'a']);
  });
});

describe('tabs', () => {
  test('a preview tab is replaced; pinned tabs stay', () => {
    let tabs = openTab([], null, 'a');
    expect(tabs).toEqual([{ id: 'a', pinned: false }]);
    tabs = openTab(tabs, 'a', 'b');
    expect(tabs).toEqual([{ id: 'b', pinned: false }]);
    tabs = togglePin(tabs, 'b');
    tabs = openTab(tabs, 'b', 'c');
    expect(tabs).toEqual([
      { id: 'b', pinned: true },
      { id: 'c', pinned: false },
    ]);
    expect(openTab(tabs, 'c', 'b')).toBe(tabs); // already open
  });
  test('closing the active tab activates its neighbor', () => {
    const tabs = [
      { id: 'a', pinned: true },
      { id: 'b', pinned: true },
      { id: 'c', pinned: false },
    ];
    expect(closeTab(tabs, 'b', 'b')).toEqual({ tabs: [tabs[0], tabs[2]], nextActive: 'c' });
    expect(closeTab(tabs, 'c', 'c').nextActive).toBe('b');
    expect(closeTab(tabs, 'a', 'c').nextActive).toBe('a');
    expect(closeTab([tabs[0]], 'a', 'a')).toEqual({ tabs: [], nextActive: null });
  });
  test('prune drops missing nodes', () => {
    const tabs = [
      { id: 'a', pinned: true },
      { id: 'b', pinned: false },
    ];
    expect(pruneTabs(tabs, (id) => id === 'a')).toEqual([tabs[0]]);
    expect(pruneTabs(tabs, () => true)).toBe(tabs);
  });
});

describe('full-text code search', () => {
  const index = buildSearchIndex([
    { id: 'a.ts', code: 'const helper = 1;\n    return helper(2);\nnothing here' },
    { id: 'b.rs', code: 'fn Helper() {}' },
  ]);
  test('finds case-insensitive matches with line, column and preview', () => {
    const { hits, total } = searchIndex(index, 'helper');
    expect(total).toBe(3);
    expect(hits.map((h) => `${h.nodeId}:${h.line}:${h.column}`)).toEqual(['a.ts:1:6', 'a.ts:2:11', 'b.rs:1:3']);
    const second = hits[1];
    expect(second.preview).toBe('return helper(2);');
    expect(second.preview.slice(second.matchStart, second.matchStart + second.matchLength)).toBe('helper');
  });
  test('ignores very short queries and caps results', () => {
    expect(searchIndex(index, 'h').hits).toEqual([]);
    const capped = searchIndex(index, 'helper', 1);
    expect(capped.hits).toHaveLength(1);
    expect(capped.total).toBe(3);
  });
  test('long lines are shortened around the match', () => {
    const long = buildSearchIndex([{ id: 'x', code: `${'a'.repeat(300)}needle${'b'.repeat(300)}` }]);
    const [hit] = searchIndex(long, 'needle').hits;
    expect(hit.preview.startsWith('…')).toBe(true);
    expect(hit.preview.slice(hit.matchStart, hit.matchStart + 6)).toBe('needle');
  });
});

describe('notes import', async () => {
  const { parseNotesImport } = await import('../src/hooks/useNotes');
  test('accepts an export file or a bare map, and drops empty or invalid entries', () => {
    const exported = JSON.stringify({ scope: 'x', notes: { a: { bookmarked: true, note: '' }, b: { note: 'hi' }, c: { note: '' }, d: 5 } });
    const parsed = parseNotesImport(exported)!;
    expect(Object.keys(parsed).sort()).toEqual(['a', 'b']);
    expect(parsed.b).toMatchObject({ note: 'hi', bookmarked: false });
    expect(parseNotesImport('{"a":{"bookmarked":true}}')!.a.bookmarked).toBe(true);
  });
  test('rejects non-objects', () => {
    expect(parseNotesImport('[1,2]')).toBeNull();
    expect(parseNotesImport('nope')).toBeNull();
  });
});

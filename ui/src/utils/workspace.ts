/** Pure state helpers for navigation history and open tabs. */

export interface LineSpan {
  from: number;
  to: number;
}

export interface NavEntry {
  id: string;
  range: LineSpan | null;
}

export interface History {
  stack: NavEntry[];
  index: number;
}

export const EMPTY_HISTORY: History = { stack: [], index: -1 };
const MAX_HISTORY = 100;

const sameEntry = (a: NavEntry | undefined, b: NavEntry) =>
  !!a && a.id === b.id && a.range?.from === b.range?.from && a.range?.to === b.range?.to;

/** Records a visit: drops any forward entries, ignores repeats of the current entry. */
export const pushHistory = (h: History, entry: NavEntry): History => {
  if (sameEntry(h.stack[h.index], entry)) return h;
  const stack = [...h.stack.slice(0, h.index + 1), entry].slice(-MAX_HISTORY);
  return { stack, index: stack.length - 1 };
};

export const canGoBack = (h: History) => h.index > 0;
export const canGoForward = (h: History) => h.index < h.stack.length - 1;

export const moveHistory = (h: History, delta: -1 | 1): History =>
  (delta < 0 ? canGoBack(h) : canGoForward(h)) ? { ...h, index: h.index + delta } : h;

/** Most recent distinct node ids, newest first. */
export const recentIds = (h: History, limit = 8): string[] => {
  const seen: string[] = [];
  for (let i = h.stack.length - 1; i >= 0 && seen.length < limit; i--) {
    const id = h.stack[i].id;
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
};

export interface DocTab {
  id: string;
  pinned: boolean;
}

/**
 * Opens `id` in the tab strip like a preview tab: an existing tab is reused; otherwise the
 * active unpinned tab is replaced, or a new tab is added when the active one is pinned.
 */
export const openTab = (tabs: DocTab[], activeId: string | null, id: string): DocTab[] => {
  if (tabs.some((t) => t.id === id)) return tabs;
  const active = tabs.findIndex((t) => t.id === activeId);
  if (active >= 0 && !tabs[active].pinned) {
    const next = [...tabs];
    next[active] = { id, pinned: false };
    // Keep at most one unpinned (preview) tab.
    return next.filter((t, i) => t.pinned || i === active);
  }
  return [...tabs.filter((t) => t.pinned), { id, pinned: false }];
};

export const togglePin = (tabs: DocTab[], id: string): DocTab[] =>
  tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));

/** Closes a tab and returns the tab to show next (the neighbor), or null when none remain. */
export const closeTab = (tabs: DocTab[], activeId: string | null, id: string): { tabs: DocTab[]; nextActive: string | null } => {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, nextActive: activeId };
  const next = tabs.filter((t) => t.id !== id);
  if (activeId !== id) return { tabs: next, nextActive: activeId };
  return { tabs: next, nextActive: next[Math.min(i, next.length - 1)]?.id ?? null };
};

/** Drops tabs whose nodes no longer exist (e.g. after loading another repository). */
export const pruneTabs = (tabs: DocTab[], exists: (id: string) => boolean) => {
  const next = tabs.filter((t) => exists(t.id));
  return next.length === tabs.length ? tabs : next;
};

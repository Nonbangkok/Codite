import { useCallback, useEffect, useState } from 'react';

export interface NodeNote {
  bookmarked: boolean;
  note: string;
  updatedAt: number;
}

export type NotesMap = Record<string, NodeNote>;

const keyFor = (scope: string) => `codite.notes.${scope}`;

const read = (scope: string): NotesMap => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(keyFor(scope)) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as NotesMap) : {};
  } catch {
    return {};
  }
};

/** Validates imported JSON: `{ [nodeId]: { bookmarked?, note? } }`. */
export const parseNotesImport = (text: string): NotesMap | null => {
  try {
    const raw: unknown = JSON.parse(text);
    const source = raw && typeof raw === 'object' && 'notes' in raw ? (raw as { notes: unknown }).notes : raw;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const out: NotesMap = {};
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<NodeNote>;
      const note = typeof v.note === 'string' ? v.note.slice(0, 20_000) : '';
      const bookmarked = v.bookmarked === true;
      if (note || bookmarked) out[id] = { note, bookmarked, updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now() };
    }
    return out;
  } catch {
    return null;
  }
};

/** Bookmarks and notes per node, stored per project (`scope`) in localStorage. */
export const useNotes = (scope: string) => {
  const [notes, setNotes] = useState<NotesMap>(() => read(scope));

  // eslint-disable-next-line react-hooks/set-state-in-effect -- switching projects loads their notes
  useEffect(() => setNotes(read(scope)), [scope]);

  const save = useCallback(
    (update: (prev: NotesMap) => NotesMap) =>
      setNotes((prev) => {
        const next = update(prev);
        try {
          window.localStorage.setItem(keyFor(scope), JSON.stringify(next));
        } catch {
          // storage blocked or full: keep notes for this session only
        }
        return next;
      }),
    [scope],
  );

  const upsert = (prev: NotesMap, id: string, patch: Partial<NodeNote>): NotesMap => {
    const current = prev[id] ?? { bookmarked: false, note: '', updatedAt: 0 };
    const next = { ...current, ...patch, updatedAt: Date.now() };
    const out = { ...prev };
    if (!next.bookmarked && !next.note.trim()) delete out[id];
    else out[id] = next;
    return out;
  };

  const toggleBookmark = useCallback((id: string) => save((p) => upsert(p, id, { bookmarked: !p[id]?.bookmarked })), [save]);
  const setNote = useCallback((id: string, note: string) => save((p) => upsert(p, id, { note })), [save]);
  const importNotes = useCallback((incoming: NotesMap) => save((p) => ({ ...p, ...incoming })), [save]);

  return { notes, toggleBookmark, setNote, importNotes };
};

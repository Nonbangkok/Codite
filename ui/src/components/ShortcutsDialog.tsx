import { useEffect, useRef } from 'react';

const SHORTCUTS:{ keys: string[]; action: string }[] = [
  { keys: ['/'], action: 'Search files and symbols' },
  { keys: ['⌘', 'K'], action: 'Search (also Ctrl+K)' },
  { keys: ['Esc'], action: 'Clear path, then close the details panel' },
  { keys: ['F'], action: 'Fit the graph to the screen' },
  { keys: ['X'], action: 'Focus on the selected node’s neighborhood' },
  { keys: ['P'], action: 'Find a path from the selected node' },
  { keys: ['N'], action: 'Show or hide all names' },
  { keys: ['C'], action: 'Color by kind or language' },
  { keys: ['D'], action: 'Show or hide folder nodes' },
  { keys: ['T'], action: 'Switch light and dark theme' },
  { keys: ['+', '−'], action: 'Zoom in and out' },
  { keys: ['?'], action: 'Show this list' },
];

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <button ref={closeRef} type="button" className="btn btn--quiet" onClick={onClose}>
              Close
            </button>
          </div>
          <dl>
            {SHORTCUTS.map(({ keys, action }) => (
              <div key={action} style={{ display: 'contents' }}>
                <dt>
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
};

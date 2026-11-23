import { useEffect, useState } from 'react';

const EXAMPLES = ['sindresorhus/slugify', 'tj/commander.js', 'spf13/cobra'];

interface EmptyStateProps {
  recent: readonly string[];
  onScan: (repo: string) => void;
}

/** Shown when there is no graph at all. */
export const EmptyState = ({ recent, onScan }: EmptyStateProps) => (
  <div className="center-state">
    <section className="center-state__card" aria-labelledby="empty-title">
      <h2 id="empty-title">Map a repository</h2>
      <p>
        Paste a public GitHub URL in the bar above, or run the analyzer on your own project to load it here.
      </p>
      {recent.length > 0 && (
        <>
          <p className="center-state__label">Scanned recently</p>
          <div className="center-state__examples">
            {recent.map((repo) => (
              <button key={repo} type="button" className="btn" onClick={() => onScan(repo)}>
                {repo}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="center-state__label">Try one of these</p>
      <div className="center-state__examples">
        {EXAMPLES.filter((r) => !recent.includes(r)).map((repo) => (
          <button key={repo} type="button" className="btn" onClick={() => onScan(repo)}>
            {repo}
          </button>
        ))}
      </div>
    </section>
  </div>
);

/** Shown when filters hide every node. */
export const FilteredOutState = ({ onReset }: { onReset: () => void }) => (
  <div className="center-state">
    <section className="center-state__card" aria-labelledby="filtered-title">
      <h2 id="filtered-title">Nothing to show</h2>
      <p>The current folder and legend filters hide every node.</p>
      <button type="button" className="btn btn--primary" onClick={onReset}>
        Reset filters
      </button>
    </section>
  </div>
);

interface ScanningStateProps {
  repo: string;
  startedAt: number;
  onCancel: () => void;
}

/** Progress card while the server clones and parses a repository. */
export const ScanningState = ({ repo, startedAt, onCancel }: ScanningStateProps) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="center-state">
      <section className="center-state__card" aria-labelledby="scanning-title" aria-busy="true">
        <div className="center-state__row">
          <div className="spinner" aria-hidden="true" />
          <h2 id="scanning-title" style={{ margin: 0 }}>
            Scanning {repo}
          </h2>
        </div>
        <p style={{ marginTop: 10 }}>
          {seconds < 15
            ? 'Cloning the repository and parsing its source files.'
            : 'Still working. Large repositories can take up to a couple of minutes.'}
        </p>
        <div className="center-state__row" style={{ justifyContent: 'space-between' }}>
          <span className="center-state__elapsed">{seconds}s elapsed</span>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel scan
          </button>
        </div>
      </section>
    </div>
  );
};

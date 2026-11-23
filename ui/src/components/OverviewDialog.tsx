import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import type { HealthCheck, Insights, RankedNode } from '../utils/insights';

interface OverviewDialogProps {
  project: string;
  insights: Insights;
  languageColor: (language: string) => string;
  onOpen: (id: string) => void;
  onShowNodes: (ids: string[]) => void;
  onExport: (format: 'md' | 'json') => void;
  onClose: () => void;
}

const SEVERITY_ICON = { high: OctagonAlert, warn: AlertTriangle, info: Info } as const;

const Ranking = ({ title, list, unit, onOpen }: { title: string; list: RankedNode[]; unit: string; onOpen: (id: string) => void }) => {
  const id = `rank-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
  <section className="overview__card" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {list.length === 0 ? (
      <p className="panel__note">Nothing to rank.</p>
    ) : (
      <ol className="ranking">
        {list.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} title={r.id}>
              <span className="ranking__name">{r.label}</span>
              <span className="ranking__where">{r.detail}</span>
              <span className="ranking__value">
                {r.value}
                {unit && ` ${unit}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
  );
};

const Check = ({ check, onOpen, onShowNodes }: { check: HealthCheck; onOpen: (id: string) => void; onShowNodes: (ids: string[]) => void }) => {
  const ok = check.items.length === 0;
  const Icon = ok ? CheckCircle2 : SEVERITY_ICON[check.severity];
  return (
    <details className="check-item" data-severity={ok ? 'ok' : check.severity}>
      <summary>
        <Icon size={16} aria-hidden="true" />
        <span className="check-item__title">{check.title}</span>
        <span className="check-item__count">{ok ? 'None' : check.items.length}</span>
      </summary>
      <p className="check-item__desc">{check.description}</p>
      {!ok && (
        <ul className="check-item__list">
          {check.items.slice(0, 100).map((item, i) => (
            <li key={i}>
              <button type="button" onClick={() => (item.ids.length > 1 ? onShowNodes(item.ids) : onOpen(item.ids[0]))}>
                {item.detail}
              </button>
              {item.ids.length > 1 && <span className="check-item__hint">Shows the files in this cycle</span>}
            </li>
          ))}
          {check.items.length > 100 && <li className="check-item__hint">…and {check.items.length - 100} more (see the exported report)</li>}
        </ul>
      )}
    </details>
  );
};

/** Project-level statistics, health checks and rankings. */
export const OverviewDialog = ({ project, insights, languageColor, onOpen, onShowNodes, onExport, onClose }: OverviewDialogProps) => {
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

  const t = insights.totals;
  const totalLines = insights.languages.reduce((s, l) => s + l.lines, 0) || 1;
  const problems = insights.checks.filter((c) => c.items.length && c.severity !== 'info').length;

  return (
    <div className="backdrop backdrop--full" onClick={onClose}>
      <div className="dialog overview" role="dialog" aria-modal="true" aria-labelledby="overview-title" onClick={(e) => e.stopPropagation()}>
        <header className="overview__head">
          <div>
            <h2 id="overview-title">Overview of {project}</h2>
            <p className="overview__sub">
              {problems === 0 ? 'No problems found by the health checks.' : `${problems} ${problems === 1 ? 'check needs' : 'checks need'} attention.`}
            </p>
          </div>
          <div className="overview__actions">
            <button type="button" className="btn" onClick={() => onExport('md')}>
              Export Markdown
            </button>
            <button type="button" className="btn" onClick={() => onExport('json')}>
              Export JSON
            </button>
            <button ref={closeRef} type="button" className="icon-btn" aria-label="Close overview" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="overview__body">
          <dl className="overview__totals">
            <div>
              <dt>Files</dt>
              <dd>{t.files.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Symbols</dt>
              <dd>{t.symbols.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Lines of code</dt>
              <dd>{t.codeLines.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Connections</dt>
              <dd>{t.links.toLocaleString()}</dd>
            </div>
          </dl>

          <section className="overview__card overview__wide" aria-labelledby="languages-title">
            <h3 id="languages-title">Languages</h3>
            <div className="langbar" role="img" aria-label={insights.languages.map((l) => `${l.label} ${Math.round((l.lines / totalLines) * 100)}%`).join(', ')}>
              {insights.languages.map((l) => (
                <span key={l.language} style={{ flexGrow: Math.max(l.lines, 1), background: languageColor(l.language) }} />
              ))}
            </div>
            <ul className="langlist">
              {insights.languages.map((l) => (
                <li key={l.language}>
                  <span className="dot" style={{ background: languageColor(l.language) }} aria-hidden="true" />
                  {l.label}
                  <span className="langlist__meta">
                    {l.files} {l.files === 1 ? 'file' : 'files'}, {l.lines.toLocaleString()} lines ({Math.round((l.lines / totalLines) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="overview__card overview__wide" aria-labelledby="checks-title">
            <h3 id="checks-title">Health checks</h3>
            {insights.checks.map((c) => (
              <Check key={c.id} check={c} onOpen={onOpen} onShowNodes={onShowNodes} />
            ))}
          </section>

          <Ranking title="Largest files" list={insights.largestFiles} unit="lines" onOpen={onOpen} />
          <Ranking title="Most imported files" list={insights.mostImported} unit="" onOpen={onOpen} />
          <Ranking title="Longest functions" list={insights.longestFunctions} unit="lines" onOpen={onOpen} />
          <Ranking title="Most complex functions" list={insights.mostComplex} unit="" onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
};

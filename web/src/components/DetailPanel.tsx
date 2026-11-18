import { useEffect, useState } from 'react';
import type { Diagnosis, ScannedPackage } from '../types';
import { diagnose } from '../api';
import { ago, plural, riskBand, ROUTE_HINT, ROUTE_LABEL, shortDate, STATUS_LABEL } from '../format';

interface Props {
  pkg: ScannedPackage | null;
  zombieCount: number;
  resurrected: boolean;
  running: boolean;
  hasRun: boolean;
  onResurrect: (name: string) => void;
  onShowRun: (name: string) => void;
  onSelect: (name: string) => void;
}

type DiagState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; diagnosis: Diagnosis | null }
  | { state: 'error'; message: string };

export function DetailPanel({ pkg, zombieCount, resurrected, running, hasRun, onResurrect, onShowRun, onSelect }: Props) {
  const [diag, setDiag] = useState<DiagState>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const name = pkg?.name;

  useEffect(() => {
    if (!name || !pkg?.score.zombie) {
      setDiag({ state: 'idle' });
      return;
    }
    let live = true;
    setDiag({ state: 'loading' });
    diagnose(name)
      .then((diagnosis) => live && setDiag({ state: 'ready', diagnosis }))
      .catch((err: unknown) => live && setDiag({ state: 'error', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [name, pkg?.score.zombie, attempt]);

  if (!pkg) {
    return (
      <aside className="panel detail detail--empty" aria-live="polite">
        <div className="detail__ghost" aria-hidden="true">
          <svg viewBox="0 0 64 72" width="64" height="72">
            <path d="M8 66V30a24 24 0 0 1 48 0v36l-8-6-8 6-8-6-8 6-8-6z" fill="currentColor" />
            <circle cx="24" cy="30" r="4" fill="#0d1020" />
            <circle cx="40" cy="30" r="4" fill="#0d1020" />
          </svg>
        </div>
        <h2>Pick a grave</h2>
        <p className="muted">
          {zombieCount > 0
            ? `${plural(zombieCount, 'zombie')} found. Select a tombstone to see why it is dead and how the crew would fix it.`
            : 'Select a tombstone to see its details.'}
        </p>
      </aside>
    );
  }

  const band = riskBand(pkg.score.risk);
  const s = pkg.signals;
  const deprecationMsg = pkg.facts?.deprecated ?? pkg.facts?.latestDeprecated;

  return (
    <aside className="panel detail" aria-live="polite" aria-label={`Details for ${pkg.name}`}>
      <header className="detail__head">
        <div>
          <h2 className="detail__name">{pkg.name}</h2>
          <div className="detail__meta">
            <span className="mono">{pkg.version}</span>
            <span className={`chip chip--status chip--${pkg.score.status}`}>{STATUS_LABEL[pkg.score.status]}</span>
            <span className="chip">{pkg.direct ? 'Direct' : 'Transitive'}</span>
            {pkg.dev && <span className="chip">Dev</span>}
            {resurrected && <span className="chip chip--risen">Resurrected</span>}
          </div>
        </div>
      </header>

      <div className="risk" aria-label={`Risk ${Math.round(pkg.score.risk)} of 100`}>
        <div className="risk__label">
          <span>Risk</span>
          <strong className={`risk__value risk__value--${band}`}>{Math.round(pkg.score.risk)}</strong>
          <span className="muted">/ 100</span>
          <span className="risk__dead muted">deadness {Math.round(pkg.score.deadness * 100)}%</span>
        </div>
        <div className="risk__track">
          <div className={`risk__fill risk__fill--${band}`} style={{ width: `${Math.max(2, Math.min(100, pkg.score.risk))}%` }} />
        </div>
      </div>

      {pkg.error && <p className="notice notice--warn">Some lookups failed: {pkg.error}</p>}

      {pkg.score.reasons.length > 0 && (
        <section className="detail__section">
          <h3>Why it's here</h3>
          <ul className="reasons">
            {pkg.score.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail__section">
        <h3>Signals</h3>
        <dl className="signals">
          {deprecationMsg && (
            <>
              <dt>Deprecated</dt>
              <dd className="signals__quote">“{deprecationMsg}”</dd>
            </>
          )}
          <dt>Last publish</dt>
          <dd>
            {shortDate(pkg.facts?.lastPublish)} <span className="muted">({ago(s.daysSinceLastPublish)})</span>
          </dd>
          {pkg.facts?.latest && pkg.facts.latest !== pkg.version && (
            <>
              <dt>Latest</dt>
              <dd className="mono">{pkg.facts.latest}</dd>
            </>
          )}
          <dt>Repository</dt>
          <dd>
            <span className={`chip chip--repo-${s.repo}`}>{s.repo}</span>
            {pkg.facts?.repositoryUrl && <span className="muted mono signals__url"> {cleanRepo(pkg.facts.repositoryUrl)}</span>}
          </dd>
          {pkg.facts?.license && (
            <>
              <dt>Licence</dt>
              <dd>{pkg.facts.license}</dd>
            </>
          )}
          <dt>Used by</dt>
          <dd>
            {s.usageSites > 0
              ? `${plural(s.usageSites, 'import site')} in ${plural(s.usageFiles, 'file')}`
              : 'No direct imports found'}
            {s.dependents > 0 && <span className="muted"> · {plural(s.dependents, 'dependent package')}</span>}
          </dd>
        </dl>
      </section>

      <section className="detail__section">
        <h3>Known flaws {s.advisories.length > 0 && <span className="count count--red">{s.advisories.length}</span>}</h3>
        {s.advisories.length === 0 ? (
          <p className="muted">No known advisories for this version.</p>
        ) : (
          <ul className="advisories">
            {s.advisories.map((a) => (
              <li key={a.id} className="advisory">
                <div className="advisory__top">
                  <span className={`sev sev--${a.severity}`}>{a.severity}</span>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer noopener" className="mono">{a.id}</a>
                  ) : (
                    <span className="mono">{a.id}</span>
                  )}
                  {a.aliases.slice(0, 2).map((al) => (
                    <span key={al} className="mono muted">{al}</span>
                  ))}
                  {a.simulated && <span className="chip chip--sim">Simulated</span>}
                </div>
                <p>{a.summary}</p>
                {a.fixedIn && <p className="muted">Fixed in {a.fixedIn}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pkg.importedBy.length > 0 && (
        <section className="detail__section">
          <h3>Imported by</h3>
          <ul className="files">
            {pkg.importedBy.map((f) => (
              <li key={f} className="mono">{f}</li>
            ))}
          </ul>
        </section>
      )}

      {pkg.score.zombie && (
        <section className="detail__section coroner">
          <h3>Coroner's verdict</h3>
          {diag.state === 'loading' && <p className="muted pulse">The Coroner is examining the body…</p>}
          {diag.state === 'error' && (
            <div className="notice notice--error">
              <p>{diag.message}</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {diag.state === 'ready' && !diag.diagnosis && (
            <p className="muted">No verdict was recorded for this package in the demo.</p>
          )}
          {diag.state === 'ready' && diag.diagnosis && (
            <Verdict
              diagnosis={diag.diagnosis}
              resurrected={resurrected}
              running={running}
              hasRun={hasRun}
              onResurrect={() => onResurrect(pkg.name)}
              onShowRun={() => onShowRun(pkg.name)}
              onSelect={onSelect}
            />
          )}
        </section>
      )}
    </aside>
  );
}

function Verdict({
  diagnosis,
  resurrected,
  running,
  hasRun,
  onResurrect,
  onShowRun,
  onSelect,
}: {
  diagnosis: Diagnosis;
  resurrected: boolean;
  running: boolean;
  hasRun: boolean;
  onResurrect: () => void;
  onShowRun: () => void;
  onSelect: (name: string) => void;
}) {
  const blocked = Boolean(diagnosis.viaParent) || !diagnosis.automated;
  let why = '';
  if (diagnosis.viaParent) why = `This is a transitive dependency. Fixing ${diagnosis.viaParent} removes it.`;
  else if (!diagnosis.automated) why = 'This route needs a human: the Surgeon will not make this change on its own.';
  else if (!diagnosis.licenseOk) why = 'The licence needs a human check before code is copied.';

  return (
    <div className="verdict">
      <div className="verdict__route">
        <span className={`route route--${diagnosis.route}`}>{ROUTE_LABEL[diagnosis.route]}</span>
        <span className={`chip ${diagnosis.automated && !diagnosis.viaParent ? 'chip--auto' : 'chip--human'}`}>
          {diagnosis.viaParent ? 'Via parent' : diagnosis.automated ? 'Automated' : 'Needs a human'}
        </span>
        {!diagnosis.licenseOk && <span className="chip chip--human">Licence check</span>}
      </div>
      <p className="muted verdict__hint">{ROUTE_HINT[diagnosis.route]}</p>
      {diagnosis.replacement && (
        <p>
          Replacement: <code>{diagnosis.replacement}</code>
        </p>
      )}
      {diagnosis.rationale.length > 0 && (
        <ul className="reasons">
          {diagnosis.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {diagnosis.viaParent && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onSelect(diagnosis.viaParent!)}>
          Go to {diagnosis.viaParent}
        </button>
      )}
      <div className="verdict__actions">
        {hasRun && !running ? (
          <button type="button" className="btn btn--ghost" onClick={onShowRun}>
            {resurrected ? 'View resurrection' : 'View last run'}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          disabled={blocked || running}
          aria-describedby={why ? 'resurrect-why' : undefined}
          onClick={onResurrect}
        >
          {running ? 'Resurrecting…' : resurrected ? 'Resurrect again' : 'Resurrect'}
        </button>
      </div>
      {why && blocked && (
        <p id="resurrect-why" className="verdict__why muted">
          {why}
        </p>
      )}
    </div>
  );
}

function cleanRepo(url: string): string {
  return url.replace(/^git\+/, '').replace(/^(git|ssh):\/\/(git@)?/, '').replace(/^https?:\/\//, '').replace(/\.git$/, '');
}

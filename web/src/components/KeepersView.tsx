import { useCallback, useEffect, useState } from 'react';
import type { KeeperRecord, WardenDecision, WardenMemory } from '../types';
import type { Mode, PatrolResponse } from '../api';
import { getWarden, patrol } from '../api';
import { dateTime, plural, ROUTE_LABEL, seconds } from '../format';
import { Markdown } from './Markdown';
import { DiffView } from './DiffView';

interface Props {
  mode: Mode;
  /** Bumps when a resurrection finishes, so new keepers show up. */
  refreshKey: number;
  onOpenGraveyard: () => void;
}

type Load = { state: 'loading' } | { state: 'ready'; memory: WardenMemory } | { state: 'error'; message: string };

const DECISION_LABEL: Record<WardenDecision['kind'], string> = {
  adopted: 'Adopted',
  patrol: 'Patrol',
  advisory: 'Advisory',
  release: 'Upstream release',
  'patch-drafted': 'Patch drafted',
  escalated: 'Escalated',
};

export function KeepersView({ mode, refreshKey, onOpenGraveyard }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<'patrol' | 'simulate' | null>(null);
  const [simTarget, setSimTarget] = useState('');
  const [patrolResult, setPatrolResult] = useState<PatrolResponse | null>(null);
  const [patrolError, setPatrolError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoad({ state: 'loading' });
    getWarden()
      .then((memory) => setLoad({ state: 'ready', memory }))
      .catch((err: unknown) => setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  useEffect(refresh, [refresh, refreshKey]);

  const keepers = load.state === 'ready' ? load.memory.keepers : [];
  useEffect(() => {
    if (keepers.length && !keepers.some((k) => k.package === simTarget)) setSimTarget(keepers[0].package);
  }, [keepers, simTarget]);

  const run = async (simulate: boolean) => {
    setBusy(simulate ? 'simulate' : 'patrol');
    setPatrolError(null);
    try {
      const res = await patrol(simulate ? simTarget : undefined, load.state === 'ready' ? load.memory : undefined);
      setPatrolResult(res);
      setLoad({ state: 'ready', memory: res.memory });
    } catch (err) {
      setPatrolError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="keepers">
      <section className="panel keepers__intro">
        <div>
          <p className="eyebrow">Warden</p>
          <h2>Keeper bots on watch</h2>
          <p className="muted">
            Every resurrected package gets a keeper. It watches advisories and upstream releases, drafts patch pull
            requests, and remembers every decision so it never acts twice.
          </p>
        </div>
        <div className="keepers__controls">
          <button type="button" className="btn btn--primary" disabled={!keepers.length || busy !== null} onClick={() => run(false)}>
            {busy === 'patrol' ? 'Patrolling…' : 'Patrol now'}
          </button>
          <div className="sim">
            <label htmlFor="sim-target" className="sim__label">
              <span className="chip chip--sim">Simulated</span> advisory for
            </label>
            <div className="sim__row">
              <select
                id="sim-target"
                value={simTarget}
                onChange={(e) => setSimTarget(e.target.value)}
                disabled={!keepers.length || busy !== null}
              >
                {keepers.map((k) => (
                  <option key={k.package} value={k.package}>
                    {k.package}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn--ghost" disabled={!keepers.length || busy !== null} onClick={() => run(true)}>
                {busy === 'simulate' ? 'Simulating…' : 'Simulate advisory'}
              </button>
            </div>
            <p className="sim__note muted">Injects a fake advisory to show how a keeper reacts. It is never real data.</p>
          </div>
        </div>
      </section>

      {patrolError && (
        <div className="notice notice--error">
          <p>{patrolError}</p>
        </div>
      )}

      {patrolResult && <PatrolReport result={patrolResult} />}

      {load.state === 'loading' && (
        <div className="panel state">
          <div className="shovel" aria-hidden="true" />
          <p className="muted">Waking the keepers…</p>
        </div>
      )}
      {load.state === 'error' && (
        <div className="panel state">
          <p className="state__title">Could not reach the keepers</p>
          <p className="muted">{load.message}</p>
          <button type="button" className="btn btn--ghost" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {load.state === 'ready' && keepers.length === 0 && (
        <div className="panel state">
          <p className="state__title">No keepers yet</p>
          <p className="muted">Resurrect a package and a keeper bot takes the night watch.</p>
          <button type="button" className="btn btn--ghost" onClick={onOpenGraveyard}>
            Go to the graveyard
          </button>
        </div>
      )}
      {load.state === 'ready' && keepers.length > 0 && (
        <div className="keepers__list">
          {keepers.map((k) => (
            <KeeperCard key={k.package} keeper={k} />
          ))}
        </div>
      )}
      {mode === 'demo' && load.state === 'ready' && (
        <p className="muted small">In this hosted demo the keepers' memory is a recorded snapshot.</p>
      )}
    </div>
  );
}

function KeeperCard({ keeper }: { keeper: KeeperRecord }) {
  const decisions = [...keeper.decisions].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <article className="panel keeper">
      <header className="keeper__head">
        <div className="keeper__avatar" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="40" height="40">
            <circle cx="20" cy="20" r="19" fill="#1d2440" stroke="#5ee3a1" strokeWidth="1.5" />
            <path d="M12 30V18a8 8 0 0 1 16 0v12l-2.7-2-2.6 2-2.7-2-2.7 2-2.6-2z" fill="#cfd5ef" />
            <circle cx="17" cy="18" r="1.6" fill="#0d1020" />
            <circle cx="23" cy="18" r="1.6" fill="#0d1020" />
          </svg>
        </div>
        <div className="keeper__title">
          <h3>
            {keeper.package}
            <span className="mono muted"> @{keeper.version}</span>
          </h3>
          <p className="muted small">
            Keeper since {dateTime(keeper.adoptedAt)}
            {keeper.branch && (
              <>
                {' '}· <span className="mono">{keeper.branch}</span>
              </>
            )}
          </p>
        </div>
        <span className={`route route--${keeper.route}`}>{ROUTE_LABEL[keeper.route]}</span>
      </header>
      <dl className="keeper__facts">
        <div>
          <dt>Last patrol</dt>
          <dd>{keeper.lastPatrol ? dateTime(keeper.lastPatrol) : 'Not yet'}</dd>
        </div>
        <div>
          <dt>Upstream</dt>
          <dd className="mono">{keeper.lastKnownUpstream ?? '—'}</dd>
        </div>
        <div>
          <dt>Advisories handled</dt>
          <dd>{keeper.seenAdvisories.length}</dd>
        </div>
      </dl>
      <h4 className="keeper__mem-title">Memory · {plural(decisions.length, 'decision')}</h4>
      {decisions.length === 0 ? (
        <p className="muted small">Nothing remembered yet.</p>
      ) : (
        <ol className="memory">
          {decisions.map((d, i) => (
            <li key={i} className={`memory__item memory__item--${d.kind}`}>
              <span className="memory__dot" aria-hidden="true" />
              <div>
                <p className="memory__top">
                  <span className="memory__kind">{DECISION_LABEL[d.kind]}</span>
                  {d.simulated && <span className="chip chip--sim">Simulated</span>}
                  {d.advisoryId && <span className="mono muted">{d.advisoryId}</span>}
                  <span className="muted small">{dateTime(d.at)}</span>
                </p>
                <p>{d.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function PatrolReport({ result }: { result: PatrolResponse }) {
  const simulated = result.events.some((e) => /simulat/i.test(e.message));
  return (
    <section className="panel patrol" aria-live="polite">
      <header className="patrol__head">
        <h3>Patrol report</h3>
        {simulated && <span className="chip chip--sim">Simulated advisory</span>}
      </header>
      <ul className="timeline__events">
        {result.events.map((e, i) => (
          <li key={i}>
            <span className="timeline__at mono">{seconds(e.at)}</span>
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
      {result.drafts.map((d) => (
        <details key={d.branch} className="draft" open>
          <summary>
            <span className="draft__label">Patch pull request drafted</span>
            <strong>{d.title}</strong>
            <span className="mono muted">{d.branch}</span>
          </summary>
          <div className="draft__body">
            <Markdown source={d.body} />
            {d.diff.trim() && (
              <details className="draft__diff">
                <summary>Diff</summary>
                <DiffView diff={d.diff} />
              </details>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}

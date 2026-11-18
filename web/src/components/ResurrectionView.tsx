import { useState } from 'react';
import type { AttemptRecord, ProgressEvent, ProofResult, PropertyResult, ResurrectionResult, Stage } from '../types';
import { Markdown } from './Markdown';
import { DiffView } from './DiffView';
import { plural, ROUTE_LABEL, seconds } from '../format';

export interface RunState {
  status: 'running' | 'done' | 'error';
  events: ProgressEvent[];
  result?: ResurrectionResult;
  error?: string;
}

interface Props {
  name: string;
  run: RunState;
  onRetry: () => void;
  onClose: () => void;
  onKeepers: () => void;
}

const STAGES: { id: Stage; title: string; sub: string }[] = [
  { id: 'coroner', title: 'Coroner', sub: 'Diagnose and pick the safest route' },
  { id: 'surgeon', title: 'Surgeon', sub: 'Make the smallest possible fix' },
  { id: 'prover', title: 'Proof', sub: 'Generated inputs: old and new code must agree' },
  { id: 'pr', title: 'Pull request', sub: 'Diff, proof and risk note for a human to review' },
];

type StageState = 'pending' | 'active' | 'done' | 'failed';

export function ResurrectionView({ name, run, onRetry, onClose, onKeepers }: Props) {
  const { events, result } = run;
  const lastStage = events.length ? events[events.length - 1].stage : null;
  const failed = run.status === 'error' || result?.status === 'failed';
  const finished = run.status !== 'running';
  const reachedIdx = Math.max(-1, ...events.map((e) => STAGES.findIndex((s) => s.id === e.stage)));

  const stageState = (id: Stage, idx: number): StageState => {
    const has = events.some((e) => e.stage === id);
    if (!has) {
      if (finished && failed && idx === reachedIdx + 1 && reachedIdx >= 0 && !result) return 'failed';
      return 'pending';
    }
    if (!finished && lastStage === id) return 'active';
    if (failed && idx === reachedIdx && result?.status !== 'proven') return 'failed';
    return 'done';
  };

  const attempts = result?.attempts?.length ? result.attempts : liveAttempts(events);
  const liveProps = result ? [] : liveProperties(events);

  return (
    <section className="panel run" aria-label={`Resurrection of ${name}`} aria-live="polite" aria-busy={run.status === 'running'}>
      <header className="run__head">
        <div>
          <p className="eyebrow">Operating table</p>
          <h2>
            Resurrecting <span className="mono">{name}</span>
            {result && <span className="mono muted"> @{result.version}</span>}
          </h2>
        </div>
        <div className="run__head-actions">
          <RunBadge run={run} />
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close resurrection view">
            Close
          </button>
        </div>
      </header>

      <div className="run__grid">
        <ol className="timeline">
          {STAGES.map((stage, idx) => {
            const state = stageState(stage.id, idx);
            // Keeper hand-off and the final "done" note close out the PR stage.
            const stageEvents = events.filter(
              (e) => e.stage === stage.id || (stage.id === 'pr' && (e.stage === 'warden' || e.stage === 'done')),
            );
            return (
              <li key={stage.id} className={`timeline__stage is-${state}`}>
                <span className="timeline__dot" aria-hidden="true" />
                <div className="timeline__body">
                  <h3>
                    {stage.title}
                    <span className="sr-only"> ({state})</span>
                  </h3>
                  <p className="muted timeline__sub">{stage.sub}</p>
                  {stageEvents.length > 0 && (
                    <ul className="timeline__events">
                      {stageEvents.map((e, i) => (
                        <li key={i}>
                          <span className="timeline__at mono">{seconds(e.at)}</span>
                          <span>{e.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {stage.id === 'coroner' && result && (
                    <p className="timeline__verdict">
                      Route: <span className={`route route--${result.diagnosis.route}`}>{ROUTE_LABEL[result.diagnosis.route]}</span>
                      {result.diagnosis.replacement && (
                        <>
                          {' '}→ <code>{result.diagnosis.replacement}</code>
                        </>
                      )}
                    </p>
                  )}
                  {stage.id === 'prover' && liveProps.length > 0 && attempts.length === 0 && <PropertyTable props={liveProps} />}
                </div>
              </li>
            );
          })}
          {events
            .filter((e) => e.stage === 'error')
            .map((e, i) => (
              <li key={`err${i}`} className="timeline__stage is-failed">
                <span className="timeline__dot" aria-hidden="true" />
                <div className="timeline__body">
                  <h3>Stopped</h3>
                  <p>{e.message}</p>
                </div>
              </li>
            ))}
        </ol>

        <div className="run__evidence">
          {attempts.length > 0 && (
            <div className="attempts">
              <h3 className="run__subhead">Proof attempts</h3>
              {attempts.map((a, i) => (
                <AttemptCard key={`${a.candidate}-${i}`} attempt={a} index={i + 1} />
              ))}
            </div>
          )}

          {run.status === 'running' && attempts.length === 0 && (
            <div className="run__waiting">
              <div className="shovel" aria-hidden="true" />
              <p className="muted">The night crew is working…</p>
            </div>
          )}

          {run.status === 'error' && (
            <div className="notice notice--error">
              <p>{run.error ?? 'The resurrection stopped.'}</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={onRetry}>
                Try again
              </button>
            </div>
          )}

          {result?.status === 'escalated' && (
            <div className="notice notice--warn">
              <h3>Handed to a human</h3>
              <p>{result.escalation ?? 'The crew could not prove a safe fix, so a human needs to look.'}</p>
            </div>
          )}

          {result?.status === 'failed' && !result.pr && (
            <div className="notice notice--error">
              <h3>No fix passed the proof</h3>
              <p>{result.escalation ?? 'Every candidate fix disagreed with the old code, so nothing was opened.'}</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={onRetry}>
                Run again
              </button>
            </div>
          )}

          {result?.pr && <PrCard result={result} onKeepers={onKeepers} />}
        </div>
      </div>
    </section>
  );
}

function RunBadge({ run }: { run: RunState }) {
  if (run.status === 'running') return <span className="badge badge--running">In progress</span>;
  if (run.status === 'error') return <span className="badge badge--failed">Stopped</span>;
  const s = run.result?.status;
  if (s === 'proven') return <span className="badge badge--proven">Proven</span>;
  if (s === 'escalated') return <span className="badge badge--escalated">Escalated</span>;
  return <span className="badge badge--failed">Failed</span>;
}

function AttemptCard({ attempt, index }: { attempt: AttemptRecord; index: number }) {
  const { proof } = attempt;
  const failing = proof.properties.find((p) => !p.passed && p.counterexample);
  return (
    <article className={`attempt ${proof.passed ? 'attempt--pass' : 'attempt--fail'}`}>
      <header className="attempt__head">
        <span className="attempt__n">Attempt {index}</span>
        <span className="mono attempt__cand">{attempt.candidate}</span>
        <span className={`badge ${proof.passed ? 'badge--proven' : 'badge--failed'}`}>{proof.passed ? 'Passed' : 'Rejected'}</span>
      </header>
      {attempt.description && <p className="attempt__desc">{attempt.description}</p>}

      {failing?.counterexample && (
        <div className="caught">
          <p className="caught__title">The proof caught it</p>
          <p className="muted">
            Property <strong>{failing.name}</strong> failed after {plural(failing.runs, 'run')} (seed {failing.seed}).
          </p>
          <div className="caught__grid">
            <span className="caught__label">Input</span>
            <code className="caught__val">{failing.counterexample.args}</code>
            <span className="caught__label">Old code</span>
            <code className="caught__val caught__val--old">{failing.counterexample.oldResult}</code>
            <span className="caught__label">New code</span>
            <code className="caught__val caught__val--new">{failing.counterexample.newResult}</code>
          </div>
        </div>
      )}

      <PropertyTable props={proof.properties} />
      <p className="attempt__stats muted">
        {proof.totalRuns.toLocaleString()} generated inputs
        {proof.goldenCases > 0 && <> · {proof.goldenCases.toLocaleString()} golden cases saved</>}
        {' '}· {(proof.durationMs / 1000).toFixed(1)}s
        {proof.sandboxed && <> · <span className="chip chip--auto">Sandboxed</span></>}
      </p>
    </article>
  );
}

function PropertyTable({ props }: { props: PropertyResult[] }) {
  if (!props.length) return null;
  return (
    <ul className="props">
      {props.map((p, i) => (
        <li key={`${p.name}-${i}`} className={p.passed ? 'is-pass' : 'is-fail'}>
          <span className="props__icon" aria-hidden="true">{p.passed ? '✓' : '✕'}</span>
          <span className="props__name">{p.name}</span>
          <span className="props__runs mono">{p.runs.toLocaleString()} runs</span>
          {p.error && <span className="props__err">{p.error}</span>}
        </li>
      ))}
    </ul>
  );
}

function PrCard({ result, onKeepers }: { result: ResurrectionResult; onKeepers: () => void }) {
  const pr = result.pr!;
  const [tab, setTab] = useState<'body' | 'diff'>('body');
  return (
    <article className="pr">
      <header className="pr__head">
        <span className="pr__icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path fill="currentColor" d="M5 3.3a1.8 1.8 0 1 1-1.5 0v9.4a1.8 1.8 0 1 1 1.5 0zM12.5 12.7a1.8 1.8 0 1 1-1.5 0V7a1.5 1.5 0 0 0-1.5-1.5H8.6l1.4 1.4-1 1L6.3 5.2 9 2.5l1 1-1.4 1.5h.9A3 3 0 0 1 12.5 8z" />
          </svg>
        </span>
        <div className="pr__title-wrap">
          <h3 className="pr__title">{pr.title}</h3>
          <p className="muted mono pr__branch">{pr.branch}</p>
        </div>
        {pr.url ? (
          <a className="btn btn--ghost btn--small" href={pr.url} target="_blank" rel="noreferrer noopener">
            Open pull request
          </a>
        ) : (
          <span className="chip" title={pr.bodyPath}>Drafted locally</span>
        )}
      </header>

      <ul className="pr__files">
        {pr.files.map((f) => (
          <li key={f.path}>
            <span className={`file-kind file-kind--${f.kind}`}>{f.kind === 'added' ? 'A' : f.kind === 'deleted' ? 'D' : 'M'}</span>
            <span className="mono">{f.path}</span>
          </li>
        ))}
      </ul>

      <div className="tabs tabs--small" role="tablist" aria-label="Pull request views">
        <button type="button" role="tab" aria-selected={tab === 'body'} className={tab === 'body' ? 'is-active' : ''} onClick={() => setTab('body')}>
          Description
        </button>
        <button type="button" role="tab" aria-selected={tab === 'diff'} className={tab === 'diff' ? 'is-active' : ''} onClick={() => setTab('diff')}>
          Diff
        </button>
      </div>
      <div className="pr__view" role="tabpanel">
        {tab === 'body' ? <Markdown source={pr.body} /> : <DiffView diff={pr.diff} />}
      </div>

      <footer className="pr__foot muted">
        <span className="mono" title="Where the PR body and patch were written">{pr.patchPath}</span>
        <button type="button" className="btn btn--ghost btn--small" onClick={onKeepers}>
          See the keeper bot
        </button>
      </footer>
    </article>
  );
}

// ---- reading attempts out of live progress events ----

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isProof(v: unknown): v is ProofResult {
  return isObj(v) && Array.isArray(v.properties) && typeof v.passed === 'boolean';
}

function isAttempt(v: unknown): v is AttemptRecord {
  return isObj(v) && typeof v.candidate === 'string' && isProof(v.proof);
}

function isProperty(v: unknown): v is PropertyResult {
  return isObj(v) && typeof v.name === 'string' && typeof v.runs === 'number' && typeof v.passed === 'boolean';
}

function liveAttempts(events: ProgressEvent[]): AttemptRecord[] {
  const out: AttemptRecord[] = [];
  for (const e of events) {
    const d = e.data;
    if (isAttempt(d)) out.push(d);
    else if (isObj(d) && isAttempt(d.attempt)) out.push(d.attempt);
    else if (isProof(d)) out.push({ candidate: d.candidate, description: '', proof: d });
  }
  return out;
}

function liveProperties(events: ProgressEvent[]): PropertyResult[] {
  const out: PropertyResult[] = [];
  for (const e of events) {
    if (e.stage !== 'prover') continue;
    const d = e.data;
    if (isProperty(d)) out.push(d);
    else if (isObj(d) && isProperty(d.property)) out.push(d.property);
  }
  return out;
}

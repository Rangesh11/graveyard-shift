import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanReport } from './types';
import type { Mode } from './api';
import { detectMode, reset, resurrect, scanExample, scanLockfile } from './api';
import { GraveyardMap } from './components/GraveyardMap';
import { DetailPanel } from './components/DetailPanel';
import { ResurrectionView } from './components/ResurrectionView';
import type { RunState } from './components/ResurrectionView';
import { KeepersView } from './components/KeepersView';
import { PasteModal } from './components/PasteModal';
import { Totals } from './components/Totals';
import { EmptyState, ErrorState, LoadingState } from './components/States';

type Tab = 'graveyard' | 'keepers';
type Scan =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => Promise<void> }
  | { state: 'ready'; report: ScanReport };

export function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [tab, setTab] = useState<Tab>('graveyard');
  const [scan, setScan] = useState<Scan>({ state: 'idle' });
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [keeperKey, setKeeperKey] = useState(0);
  const cancels = useRef<Record<string, () => void>>({});
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    detectMode().then(setMode);
  }, []);

  const clearRuns = () => {
    Object.values(cancels.current).forEach((c) => c());
    cancels.current = {};
    setRuns({});
    setActiveRun(null);
  };

  const runScan = useCallback((load: () => Promise<ScanReport>) => {
    const go = (): Promise<void> => {
      setScan({ state: 'loading' });
      setSelected(null);
      clearRuns();
      return load().then(
        (report) => {
          setScan({ state: 'ready', report });
          const top = report.packages.find((p) => p.score.zombie && p.direct) ?? report.packages.find((p) => p.score.zombie);
          setSelected(top?.name ?? null);
        },
        (err: unknown) => {
          setScan({ state: 'error', message: err instanceof Error ? err.message : String(err), retry: go });
          throw err;
        },
      );
    };
    return go();
  }, []);

  const scanExampleProject = () => {
    setTab('graveyard');
    runScan(scanExample).catch(() => {});
  };

  const scanPasted = (lockfile: string, packageJson?: string) => {
    setTab('graveyard');
    // Validate on the server first so a bad lockfile keeps the modal open.
    return scanLockfile(lockfile, packageJson).then((report) => runScan(() => Promise.resolve(report)));
  };

  const startResurrect = (name: string) => {
    cancels.current[name]?.();
    setRuns((r) => ({ ...r, [name]: { status: 'running', events: [] } }));
    setActiveRun(name);
    requestAnimationFrame(() => runRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    cancels.current[name] = resurrect(name, {
      onProgress: (event) =>
        setRuns((r) => ({ ...r, [name]: { ...(r[name] ?? { status: 'running', events: [] }), events: [...(r[name]?.events ?? []), event] } })),
      onResult: (result) => {
        setRuns((r) => ({ ...r, [name]: { ...(r[name] ?? { events: [] }), status: 'done', result } }));
        setKeeperKey((k) => k + 1);
        delete cancels.current[name];
      },
      onError: (message) => {
        setRuns((r) => ({ ...r, [name]: { ...(r[name] ?? { events: [] }), status: 'error', error: message } }));
        delete cancels.current[name];
      },
    });
  };

  const doReset = async () => {
    try {
      await reset();
    } finally {
      clearRuns();
      setScan({ state: 'idle' });
      setSelected(null);
      setKeeperKey((k) => k + 1);
    }
  };

  const report = scan.state === 'ready' ? scan.report : null;
  const resurrected = useMemo(
    () => new Set(Object.entries(runs).filter(([, r]) => r.result?.status === 'proven').map(([name]) => name)),
    [runs],
  );
  const selectedPkg = report?.packages.find((p) => p.name === selected) ?? null;
  const selectPackage = (name: string) => {
    if (report?.packages.some((p) => p.name === name)) setSelected(name);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 32 36" width="28" height="32" aria-hidden="true">
            <path d="M4 34V15a12 12 0 0 1 24 0v19z" fill="#8b93b5" />
            <path d="M16 9v14M10 14h12" stroke="#0a0c16" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div>
            <h1 className="brand__name">Graveyard Shift</h1>
            <p className="brand__tag">Dead code gets a night crew.</p>
          </div>
        </div>

        <nav className="tabs" role="tablist" aria-label="Views">
          <button type="button" role="tab" aria-selected={tab === 'graveyard'} className={tab === 'graveyard' ? 'is-active' : ''} onClick={() => setTab('graveyard')}>
            Graveyard
          </button>
          <button type="button" role="tab" aria-selected={tab === 'keepers'} className={tab === 'keepers' ? 'is-active' : ''} onClick={() => setTab('keepers')}>
            Keepers
          </button>
        </nav>

        <div className="topbar__actions">
          {mode === 'demo' && (
            <span className="badge badge--demo" title="No server is running, so this page replays a recorded run.">
              Demo data — recorded run
            </span>
          )}
          <button type="button" className="btn btn--primary" onClick={scanExampleProject} disabled={scan.state === 'loading'}>
            Scan example project
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPasteOpen(true)}>
            Paste lockfile
          </button>
          {mode === 'live' && (
            <button type="button" className="btn btn--ghost btn--small" onClick={doReset} title="Clear workspaces, keepers and this page">
              Reset
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {tab === 'keepers' ? (
          mode ? (
            <KeepersView mode={mode} refreshKey={keeperKey} onOpenGraveyard={() => setTab('graveyard')} />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            {scan.state === 'idle' && <EmptyState onScanExample={scanExampleProject} onPaste={() => setPasteOpen(true)} />}
            {scan.state === 'loading' && <LoadingState />}
            {scan.state === 'error' && <ErrorState message={scan.message} onRetry={() => scan.retry().catch(() => {})} />}
            {report && (
              <>
                <Totals report={report} resurrectedCount={resurrected.size} />
                <div className="yard">
                  <section className="panel yard__map" aria-label="Graveyard map">
                    <GraveyardMap packages={report.packages} selected={selected} resurrected={resurrected} onSelect={selectPackage} />
                  </section>
                  <DetailPanel
                    pkg={selectedPkg}
                    zombieCount={report.totals.zombies}
                    resurrected={selected ? resurrected.has(selected) : false}
                    running={selected ? runs[selected]?.status === 'running' : false}
                    hasRun={selected ? Boolean(runs[selected]) : false}
                    onResurrect={startResurrect}
                    onShowRun={(name) => {
                      setActiveRun(name);
                      requestAnimationFrame(() => runRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }}
                    onSelect={selectPackage}
                  />
                </div>
                <div ref={runRef}>
                  {activeRun && runs[activeRun] && (
                    <ResurrectionView
                      name={activeRun}
                      run={runs[activeRun]}
                      onRetry={() => startResurrect(activeRun)}
                      onClose={() => setActiveRun(null)}
                      onKeepers={() => setTab('keepers')}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <footer className="footer muted small">
        Graveyard Shift · open source · every fix ships with proof
        {mode === 'demo' && ' · this page replays recorded data, nothing here is live'}
      </footer>

      <PasteModal open={pasteOpen} demo={mode === 'demo'} onClose={() => setPasteOpen(false)} onSubmit={scanPasted} />
    </div>
  );
}

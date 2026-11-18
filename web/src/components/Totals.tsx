import { useState } from 'react';
import type { ScanReport } from '../types';
import { dateTime, plural } from '../format';

export function Totals({ report, resurrectedCount }: { report: ScanReport; resurrectedCount: number }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const t = report.totals;
  const items = [
    { label: 'Packages', value: t.packages, tone: '' },
    { label: 'Zombies', value: t.zombies, tone: 'zombie' },
    { label: 'Direct zombies', value: t.directZombies, tone: 'zombie' },
    { label: 'With known flaws', value: t.withAdvisories, tone: 'flaw' },
  ];
  return (
    <section className="totals" aria-label="Scan totals">
      <div className="totals__project">
        <p className="eyebrow">Project</p>
        <h2 className="mono">{report.project}</h2>
        <p className="muted small">
          Scanned {dateTime(report.scannedAt)} · lockfile v{report.lockfileVersion}
          {!report.usageScanned && ' · lockfile only, no source usage'}
          {report.offline && ' · offline (cached data)'}
        </p>
        {report.warnings.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => setShowWarnings((v) => !v)} aria-expanded={showWarnings}>
            {plural(report.warnings.length, 'warning')}
          </button>
        )}
        {showWarnings && (
          <ul className="totals__warnings small">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
      <dl className="totals__grid">
        {items.map((it) => (
          <div key={it.label} className={`stat ${it.tone ? `stat--${it.tone}` : ''}`}>
            <dt>{it.label}</dt>
            <dd>{it.value.toLocaleString()}</dd>
          </div>
        ))}
        {resurrectedCount > 0 && (
          <div className="stat stat--risen">
            <dt>Resurrected</dt>
            <dd>{resurrectedCount}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

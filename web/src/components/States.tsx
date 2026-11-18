interface ScanButtonsProps {
  onScanExample: () => void;
  onPaste: () => void;
}

export function EmptyState({ onScanExample, onPaste }: ScanButtonsProps) {
  return (
    <section className="panel hero">
      <div className="hero__art" aria-hidden="true">
        <svg viewBox="0 0 240 140" width="240" height="140">
          <circle cx="196" cy="34" r="20" fill="#f3edc8" />
          <path d="M0 120 C60 96 140 112 240 98 V140 H0Z" fill="#1a2036" />
          <g fill="#6b7394">
            <path d="M40 120V86a16 16 0 0 1 32 0v34z" />
            <path d="M96 122V74a22 22 0 0 1 44 0v48z" />
            <path d="M162 118V92a12 12 0 0 1 24 0v26z" />
          </g>
          <g fill="#0d1020" fontFamily="Georgia, serif" fontSize="8" textAnchor="middle">
            <text x="56" y="100">R.I.P.</text>
            <text x="118" y="92">R.I.P.</text>
          </g>
        </svg>
      </div>
      <h2>Most codebases depend on code nobody maintains.</h2>
      <p className="muted hero__lead">
        Graveyard Shift reads a lockfile, finds the dead packages, ranks them by risk, and fixes each one by the safest
        route. Every fix comes with generated-test proof that the new code behaves like the old, and a keeper bot stays
        on watch.
      </p>
      <div className="hero__actions">
        <button type="button" className="btn btn--primary" onClick={onScanExample}>
          Scan example project
        </button>
        <button type="button" className="btn btn--ghost" onClick={onPaste}>
          Paste lockfile
        </button>
      </div>
      <ol className="hero__steps">
        <li><strong>Scan.</strong> Registry, repository and advisory data give every package a zombie score.</li>
        <li><strong>Diagnose.</strong> The Coroner picks Inline, Replace or Adopt.</li>
        <li><strong>Prove.</strong> Property tests check the old and new code agree on generated inputs.</li>
        <li><strong>Keep watch.</strong> A keeper bot remembers every decision.</li>
      </ol>
    </section>
  );
}

export function LoadingState() {
  return (
    <section className="panel state state--loading" aria-busy="true" aria-live="polite">
      <div className="skeleton-yard" aria-hidden="true">
        {[0.8, 1.1, 0.9, 1.3, 0.85].map((s, i) => (
          <span key={i} className="skeleton-stone" style={{ height: `${s * 70}px`, animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <p className="state__title">Digging…</p>
      <p className="muted">Reading the lockfile and checking the registry, repositories and advisories.</p>
    </section>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="panel state state--error" role="alert">
      <p className="state__title">The scan hit a snag</p>
      <p className="muted">{message}</p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

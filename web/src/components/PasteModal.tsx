import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

interface Props {
  open: boolean;
  demo: boolean;
  onClose: () => void;
  onSubmit: (lockfile: string, packageJson?: string) => Promise<void>;
}

export function PasteModal({ open, demo, onClose, onSubmit }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [lockfile, setLockfile] = useState('');
  const [pkgJson, setPkgJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const readFile = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setter, () => setError(`Could not read ${file.name}.`));
    e.target.value = '';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(lockfile, pkgJson);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(lockfile, pkgJson.trim() ? pkgJson : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onCancel={onClose} aria-labelledby="paste-title">
      <form className="modal__form" onSubmit={submit} noValidate>
        <header className="modal__head">
          <h2 id="paste-title">Paste a lockfile</h2>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <p className="muted">
          Paste the contents of a <code>package-lock.json</code> (versions 1 to 3). Usage counts need source files, so a
          pasted lockfile is ranked by registry, repository and advisory data only.
        </p>
        {demo && (
          <p className="notice notice--warn">This hosted demo has no server. Run Graveyard Shift locally to scan your own lockfile.</p>
        )}
        <div className="field">
          <div className="field__label-row">
            <label htmlFor="lockfile">package-lock.json</label>
            <label className="file-pick">
              Load file
              <input type="file" accept=".json,application/json" onChange={readFile(setLockfile)} />
            </label>
          </div>
          <textarea
            id="lockfile"
            value={lockfile}
            onChange={(e) => setLockfile(e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder='{ "name": "my-app", "lockfileVersion": 3, "packages": { … } }'
            autoFocus
          />
        </div>
        <div className="field">
          <div className="field__label-row">
            <label htmlFor="pkgjson">
              package.json <span className="muted">(optional, marks direct dependencies)</span>
            </label>
            <label className="file-pick">
              Load file
              <input type="file" accept=".json,application/json" onChange={readFile(setPkgJson)} />
            </label>
          </div>
          <textarea id="pkgjson" value={pkgJson} onChange={(e) => setPkgJson(e.target.value)} spellCheck={false} rows={4} />
        </div>
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || demo || !lockfile.trim()}>
            {busy ? 'Digging…' : 'Scan lockfile'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function validate(lockfile: string, pkgJson: string): string | null {
  let lock: unknown;
  try {
    lock = JSON.parse(lockfile);
  } catch (err) {
    return `The lockfile is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return 'The lockfile must be a JSON object.';
  const l = lock as Record<string, unknown>;
  if (!('lockfileVersion' in l) && !('packages' in l) && !('dependencies' in l)) {
    return 'This does not look like a package-lock.json: no lockfileVersion, packages or dependencies.';
  }
  if (pkgJson.trim()) {
    try {
      const p = JSON.parse(pkgJson);
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'package.json must be a JSON object.';
    } catch (err) {
      return `package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return null;
}

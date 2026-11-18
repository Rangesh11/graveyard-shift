import { useMemo, useState } from 'react';

interface FileDiff {
  path: string;
  lines: string[];
  added: number;
  removed: number;
}

const COLLAPSE_AT = 400;

/** Unified diff viewer with per-file sections and +/- colouring. */
export function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => splitFiles(diff), [diff]);
  const [expanded, setExpanded] = useState(false);
  const totalLines = files.reduce((n, f) => n + f.lines.length, 0);

  if (!diff.trim()) return <p className="muted">No changes in this diff.</p>;

  let budget = expanded ? Infinity : COLLAPSE_AT;
  return (
    <div className="diff">
      {files.map((file) => {
        const shown = file.lines.slice(0, Math.max(0, budget));
        budget -= shown.length;
        return (
          <section key={file.path} className="diff__file">
            <header className="diff__head">
              <span className="diff__path">{file.path}</span>
              <span className="diff__stat">
                <span className="d-add">+{file.added}</span> <span className="d-del">−{file.removed}</span>
              </span>
            </header>
            {shown.length > 0 && (
              <pre className="diff__body">
                {shown.map((line, i) => (
                  <span key={i} className={`diff__line ${lineClass(line)}`}>
                    {line || ' '}
                    {'\n'}
                  </span>
                ))}
              </pre>
            )}
          </section>
        );
      })}
      {totalLines > COLLAPSE_AT && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show all ${totalLines} lines`}
        </button>
      )}
    </div>
  );
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'd-hunk';
  if (line.startsWith('+')) return 'd-add';
  if (line.startsWith('-')) return 'd-del';
  if (line.startsWith('\\')) return 'd-meta';
  return '';
}

function splitFiles(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2], lines: [], added: 0, removed: 0 };
      files.push(current);
      continue;
    }
    if (!current) {
      current = { path: '(changes)', lines: [], added: 0, removed: 0 };
      files.push(current);
    }
    if (/^(index |new file mode|deleted file mode|similarity index|rename (from|to))/.test(line)) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (line.startsWith('+++ ') && current.path === '(changes)') current.path = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('+')) current.added++;
    else if (line.startsWith('-')) current.removed++;
    current.lines.push(line);
  }
  for (const f of files) {
    while (f.lines.length && !f.lines[f.lines.length - 1]) f.lines.pop();
  }
  return files.filter((f) => f.lines.length || f.path !== '(changes)');
}

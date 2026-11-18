import type { ReactNode } from 'react';

// A small, safe Markdown renderer for pull-request bodies: headings, lists,
// tables, code blocks, quotes and inline code/bold/italic/links. It builds
// React elements and never injects HTML.

export function Markdown({ source }: { source: string }) {
  return <div className="md">{renderBlocks(source)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className={`md__code${lang === 'diff' ? ' md__code--diff' : ''}`} data-lang={lang || undefined}>
          <code>
            {lang === 'diff'
              ? body.map((l, n) => (
                  <span key={n} className={diffClass(l)}>
                    {l}
                    {'\n'}
                  </span>
                ))
              : body.join('\n')}
          </code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      const Tag = `h${level}` as 'h2';
      out.push(<Tag key={key++}>{inline(heading[2])}</Tag>);
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        <div key={key++} className="md__table-wrap">
          <table>
            <thead>
              <tr>{header.map((h, n) => <th key={n}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>{header.map((_, c) => <td key={c}>{inline(r[c] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key++}>{renderBlocks(body.join('\n'))}</blockquote>);
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          item += ' ' + lines[i++].trim();
        }
        items.push(item);
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key++}>
          {items.map((item, n) => {
            const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
            return task ? (
              <li key={n} className="md__task">
                <span className={`md__check${task[1].trim() ? ' is-done' : ''}`} aria-hidden="true" />
                {inline(task[2])}
              </li>
            ) : (
              <li key={n}>{inline(item)}</li>
            );
          })}
        </List>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|.*\|\s*$)/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    if (para.length) out.push(<p key={key++}>{inline(para.join(' '))}</p>);
    else i++;
  }
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function diffClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'd-file';
  if (line.startsWith('+')) return 'd-add';
  if (line.startsWith('-')) return 'd-del';
  if (line.startsWith('@@')) return 'd-hunk';
  return '';
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(_[^_\s][^_]*_|\*[^*\s][^*]*\*)/;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{inline(tok.slice(2, -2))}</strong>);
    else if (m[3]) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = /^(https?:|mailto:|#|\.{0,2}\/)/.test(link[2]) ? link[2] : '#';
      out.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
          {inline(link[1])}
        </a>,
      );
    } else out.push(<em key={key++}>{inline(tok.slice(1, -1))}</em>);
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

import type { AttemptRecord, Diagnosis, ScannedPackage } from '../core/types.ts';

export interface PrContext {
  pkg: ScannedPackage;
  diagnosis: Diagnosis;
  attempts: AttemptRecord[];
  changes: string[];
  rewrite: { files: string[]; sites: number };
  replay: { testRel: string; dataRel: string; cases: number; ok: boolean };
  projectTests?: { ok: boolean; command: string; tail: string };
  originalSource: string;
  integrity?: string;
  license?: string;
  removedFromLockfile: boolean;
  stillNeededBy: string[];
  riskNotes: string[];
}

const ROUTE_LABEL = { inline: 'Inline', replace: 'Replace', adopt: 'Adopt' } as const;

export function prTitle(d: Diagnosis): string {
  if (d.route === 'inline') return `Resurrect ${d.package}@${d.version}: inline a proven copy and drop the dependency`;
  return `Resurrect ${d.package}@${d.version}: replace with ${d.replacement ?? 'maintained code'}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderPrBody(c: PrContext): string {
  const { pkg, diagnosis: d } = c;
  const final = c.attempts.at(-1)!;
  const lines: string[] = [];
  lines.push(`## 🪦 ${pkg.name}@${pkg.version} → ${ROUTE_LABEL[d.route]} route`);
  lines.push('');
  lines.push(`**Why this package:** risk ${pkg.score.risk}/100, status **${pkg.score.status}**.`);
  for (const r of pkg.score.reasons) lines.push(`- ${r}`);
  if (pkg.facts?.deprecated) lines.push(`- Author's deprecation notice: "${pkg.facts.deprecated}"`);
  for (const a of pkg.signals.advisories) lines.push(`- Advisory [${a.id}](${a.url ?? `https://osv.dev/vulnerability/${a.id}`}) (${a.severity}): ${a.summary}`);
  lines.push('');
  const verdict = d.rationale.filter((r) => !pkg.score.reasons.includes(r));
  lines.push(`**Coroner's verdict:** ${verdict.join(' ')}`);
  lines.push('');

  lines.push('### What changed');
  for (const ch of c.changes) lines.push(`- ${ch}`);
  lines.push(`- Rewrote ${c.rewrite.sites} import${c.rewrite.sites === 1 ? '' : 's'} in ${c.rewrite.files.length} file${c.rewrite.files.length === 1 ? '' : 's'}: ${c.rewrite.files.map((f) => `\`${f}\``).join(', ')}`);
  lines.push(
    c.removedFromLockfile
      ? `- Removed \`${pkg.name}\` from package.json and package-lock.json`
      : `- Removed \`${pkg.name}\` from package.json; it stays in the lockfile because ${c.stillNeededBy.map((n) => `\`${n}\``).join(', ')} still depend${c.stillNeededBy.length === 1 ? 's' : ''} on it`,
  );
  lines.push('- The public API of this project is unchanged: callers keep the same function names and arguments.');
  lines.push('');

  lines.push('### Proof');
  lines.push(`fast-check generated inputs and ran each one through **both** the original \`${pkg.name}@${pkg.version}\` and the new code. Every output had to be deep-equal (or both had to throw the same error type).`);
  lines.push('');
  lines.push('| Property | Runs | Result |');
  lines.push('| --- | ---: | --- |');
  for (const p of final.proof.properties) lines.push(`| ${cell(p.name)} | ${p.runs} | ${p.passed ? '✅ agree' : '❌ differ'} |`);
  lines.push('');
  lines.push(
    `${final.proof.totalRuns} generated inputs, seed \`${final.proof.properties[0]?.seed}\`, ${final.proof.durationMs} ms. ` +
      (final.proof.sandboxed ? 'Ran in a Node.js permission-model sandbox: read-only file access, no child processes, empty environment.' : ''),
  );
  lines.push('');

  if (c.attempts.length > 1) {
    lines.push('#### Attempts');
    c.attempts.forEach((a, i) => {
      const failed = a.proof.properties.find((p) => !p.passed);
      if (a.proof.passed) {
        lines.push(`${i + 1}. ✅ **${a.candidate}**: ${a.description}. Agreed on all ${a.proof.totalRuns} inputs.`);
      } else if (failed?.counterexample) {
        lines.push(`${i + 1}. ❌ **${a.candidate}**: ${a.description}. Rejected after ${failed.runs} input${failed.runs === 1 ? '' : 's'}.`);
        lines.push(`   Counterexample \`${failed.counterexample.args}\`: original returns \`${failed.counterexample.oldResult}\`, candidate returns \`${failed.counterexample.newResult}\`.`);
      } else {
        lines.push(`${i + 1}. ❌ **${a.candidate}**: ${a.description}. ${failed?.error ?? 'Rejected.'}`);
      }
    });
    lines.push('');
  }

  lines.push('### Replay test (stays in the repo)');
  lines.push(`${c.replay.cases} recorded cases in \`${c.replay.dataRel}\`, replayed by \`${c.replay.testRel}\` with \`node --test\`: ${c.replay.ok ? '✅ pass' : '❌ fail'}. They keep guarding the behaviour after the original package is gone.`);
  if (c.projectTests) {
    lines.push('');
    lines.push(`Project tests (\`${c.projectTests.command}\`): ${c.projectTests.ok ? '✅ pass' : '❌ fail'}`);
    if (!c.projectTests.ok) lines.push('```\n' + c.projectTests.tail + '\n```');
  }
  lines.push('');

  lines.push('### Risk note');
  for (const n of c.riskNotes) lines.push(`- ${n}`);
  lines.push('');

  lines.push('### Provenance');
  lines.push(`- Original: \`${pkg.name}@${pkg.version}\` (${c.originalSource === 'node_modules' ? 'installed copy, matching the lockfile version' : 'registry tarball, hash-checked against the lockfile'})`);
  if (c.integrity) lines.push(`- Integrity: \`${c.integrity.slice(0, 40)}…\``);
  lines.push(`- Licence: ${c.license ?? 'not declared'}${d.route === 'inline' ? ' (licence file copied with the code)' : ' (no original code is copied)'}`);
  if (d.recipe) lines.push(`- Recipe: \`${d.recipe}\`, candidate \`${final.candidate}\``);
  lines.push('');

  lines.push('### Reviewer checklist');
  lines.push('- [ ] The rewritten imports are the only call sites');
  lines.push('- [ ] The risk note matches how this project uses the package');
  lines.push('- [ ] CI passes');
  lines.push('');
  lines.push('_Opened by Graveyard Shift. The Coroner chose the route, the Surgeon made the change, the proof decided. A human reviews and merges; nothing is published automatically. After merge, a Warden keeper bot watches this package for new advisories._');
  return lines.join('\n');
}

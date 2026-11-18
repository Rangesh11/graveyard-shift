import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProjectDir } from '../core/scanner.ts';
import type {
  AttemptRecord,
  Diagnosis,
  ProgressEvent,
  PullRequestDraft,
  ResurrectionResult,
  ScannedPackage,
  ScanReport,
  Stage,
} from '../core/types.ts';
import { adopt, adoptCommitted } from '../warden/memory.ts';
import { diagnose } from './coroner.ts';
import { git, run } from './git.ts';
import { prTitle, renderPrBody } from './pr.ts';
import { prove, type GoldenGroup } from './prover.ts';
import { findRecipe, inlineProperties } from './recipes.ts';
import {
  findRemainingUses,
  linkNodeModules,
  prepareWorkspace,
  removeDependency,
  rewriteImports,
  safeName,
  vendorPackage,
  writeProofTest,
  writeShim,
} from './surgeon.ts';
import { locateOriginal } from './tarball.ts';

const CODEC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'codec.cjs');

export interface ResurrectOptions {
  /** Reuse a scan instead of scanning again. */
  report?: ScanReport;
  onEvent?: (e: ProgressEvent) => void;
  numRuns?: number;
  /** Run the project's own `npm test` in the workspace (default true). */
  projectTests?: boolean;
}

export function findPackage(report: ScanReport, name: string): ScannedPackage | undefined {
  return report.packages.find((p) => p.name === name && p.direct) ?? report.packages.find((p) => p.name === name);
}

function escalationReport(pkg: ScannedPackage, d: Diagnosis): string {
  const lines = [`# Escalation: ${pkg.name}@${pkg.version}`, '', `Route: **${d.route}**, needs a human.`, ''];
  for (const r of d.rationale) lines.push(`- ${r}`);
  if (pkg.importedBy.length) {
    lines.push('', 'Call sites to migrate:');
    for (const f of pkg.importedBy) lines.push(`- \`${f}\``);
  }
  return lines.join('\n');
}

/**
 * One package's journey: diagnose, fix on a scratch branch, prove, open a
 * pull-request draft, hand over to the Warden. Nothing touches the user's
 * working tree; the change lives on a branch in .graveyard/workspaces.
 */
export async function resurrect(root: string, name: string, opts: ResurrectOptions = {}): Promise<ResurrectionResult> {
  const started = Date.now();
  const emit = (stage: Stage, message: string, data?: unknown) =>
    opts.onEvent?.({ stage, message, at: Date.now() - started, ...(data === undefined ? {} : { data }) });

  const report = opts.report ?? (await scanProjectDir(root));
  const pkg = findPackage(report, name);
  if (!pkg) throw new Error(`"${name}" is not in this project's lockfile.`);
  if (!pkg.score.zombie) throw new Error(`"${name}" is alive (released ${pkg.signals.daysSinceLastPublish} days ago). Version bots handle living packages.`);

  // 1. Coroner
  const diagnosis = diagnose(pkg, report.packages);
  emit('coroner', `Diagnosed ${pkg.name}@${pkg.version}: ${diagnosis.route} route${diagnosis.automated ? '' : ', needs a human'}`, diagnosis);
  const base = { package: pkg.name, version: pkg.version, diagnosis };

  if (!diagnosis.automated) {
    const escalation = escalationReport(pkg, diagnosis);
    emit('done', 'Escalated to a human with the Coroner\'s notes', { escalation });
    return { ...base, status: 'escalated', attempts: [], escalation, finishedAt: new Date().toISOString() };
  }

  // 2. Surgeon: find the exact original code, then work on a scratch branch.
  const original = await locateOriginal(root, pkg.name, pkg.version, pkg);
  emit('surgeon', `Found the original code (${original.source === 'node_modules' ? 'installed copy' : 'registry tarball, integrity verified'})`, {
    entry: original.main,
  });
  const branch = `graveyard/${diagnosis.route}-${safeName(pkg.name)}`;
  const ws = await prepareWorkspace(root, branch);
  emit('surgeon', `Opened scratch branch ${branch}`);

  const attempts: AttemptRecord[] = [];
  let golden: GoldenGroup[] = [];
  let subjectRel = '';
  let vendoredLicense: string | undefined;
  const changes: string[] = [];

  if (diagnosis.route === 'replace') {
    const recipe = findRecipe(pkg.name, pkg.version)!;
    for (const candidate of recipe.candidates) {
      subjectRel = await writeShim(ws, pkg.name, candidate.shim);
      emit('surgeon', `Candidate ${attempts.length + 1}: ${candidate.description}`, { candidate: candidate.id, file: subjectRel });
      emit('prover', `Proving "${candidate.id}" against ${pkg.name}@${pkg.version} on generated inputs…`);
      const out = await prove({
        oldPath: original.entry,
        newPath: path.join(ws, subjectRel),
        properties: recipe.properties,
        candidate: candidate.id,
        numRuns: opts.numRuns,
      });
      const attempt: AttemptRecord = { candidate: candidate.id, description: candidate.description, proof: out.result };
      attempts.push(attempt);
      if (out.result.passed) {
        golden = out.golden;
        emit('prover', `"${candidate.id}" agrees with the original on all ${out.result.totalRuns} inputs`, { attempt });
        changes.push(`Added \`${subjectRel}\`: ${candidate.description}`);
        break;
      }
      const bad = out.result.properties.find((p) => !p.passed);
      emit(
        'prover',
        bad?.counterexample
          ? `Rejected "${candidate.id}": for ${bad.counterexample.args} the original gives ${bad.counterexample.oldResult}, the candidate gives ${bad.counterexample.newResult}`
          : `Rejected "${candidate.id}": ${bad?.error ?? 'proof failed'}`,
        { attempt },
      );
    }
  } else {
    const vendored = await vendorPackage(ws, pkg.name, pkg.version, original);
    subjectRel = vendored.entryRel;
    changes.push(
      `Inlined ${pkg.name}@${pkg.version} unchanged into \`${vendored.dirRel}/\` (${vendored.files.length} files, with ${vendored.licenseFile ? `\`${vendored.licenseFile}\`` : 'its licence recorded in PROVENANCE.json'})`,
    );
    emit('surgeon', `Inlined ${vendored.files.length} files into ${vendored.dirRel}/ with licence and provenance`, { files: vendored.files });
    emit('prover', 'Proving the inlined copy behaves like the installed package…');
    vendoredLicense = vendored.licenseFile;
    const out = await prove({
      oldPath: original.entry,
      newPath: path.join(ws, subjectRel),
      // The entry may sit in a subfolder and require files above it.
      readDirs: [path.join(ws, vendored.dirRel)],
      properties: inlineProperties(),
      candidate: 'inline-copy',
      numRuns: opts.numRuns,
    });
    const attempt: AttemptRecord = { candidate: 'inline-copy', description: 'Exact copy of the published code', proof: out.result };
    attempts.push(attempt);
    golden = out.golden;
    emit('prover', out.result.passed ? `Inlined copy agrees on all ${out.result.totalRuns} inputs` : 'Inlined copy failed the proof', { attempt });
  }

  const final = attempts.at(-1);
  if (!final?.proof.passed) {
    const escalation = `${escalationReport(pkg, diagnosis)}\n\nEvery candidate failed the proof, so no pull request was opened.`;
    emit('done', 'No candidate passed the proof. Escalated with the counterexamples.', { escalation });
    return { ...base, status: 'failed', attempts, escalation, finishedAt: new Date().toISOString() };
  }

  // 3. Rewire the project to the proven code.
  const rewrite = await rewriteImports(ws, pkg.name, subjectRel);
  if (rewrite.unsupported.length) {
    const escalation = `${escalationReport(pkg, diagnosis)}\n\nSub-path imports cannot be redirected automatically:\n${rewrite.unsupported.map((u) => `- ${u}`).join('\n')}`;
    emit('done', 'Sub-path imports found. Escalated.', { escalation });
    return { ...base, status: 'escalated', attempts, escalation, finishedAt: new Date().toISOString() };
  }
  const remaining = await findRemainingUses(ws, pkg.name, original.bins);
  if (remaining.length) {
    const escalation = `${escalationReport(pkg, diagnosis)}\n\nThe project still uses the package in ways the Surgeon cannot redirect, so removing it would break them:\n${remaining.map((u) => `- ${u}`).join('\n')}`;
    emit('done', 'The package is still used outside rewritable imports. Escalated.', { escalation });
    return { ...base, status: 'escalated', attempts, escalation, finishedAt: new Date().toISOString() };
  }
  const stillNeededBy = pkg.dependents;
  await removeDependency(ws, pkg.name, stillNeededBy);
  emit('surgeon', `Rewrote ${rewrite.sites} imports in ${rewrite.files.length} files and removed the dependency`, rewrite);

  const codec = await readFile(CODEC_PATH, 'utf8');
  const proofTest = await writeProofTest(ws, pkg.name, pkg.version, subjectRel, golden, codec);
  // The replay runs the new code, which for the inline route is the dead
  // package's own code, so it gets the same read-only sandbox as the proof.
  const wsReal = await realpath(ws);
  const replay = await run(process.execPath, ['--permission', `--allow-fs-read=${wsReal}`, '--test-isolation=none', '--test', proofTest.testRel], ws);
  emit('prover', `Replay test with ${proofTest.cases} recorded cases: ${replay.ok ? 'pass' : 'FAIL'}`, { file: proofTest.testRel });

  let projectTests: { ok: boolean; command: string; tail: string } | undefined;
  const pj = JSON.parse(await readFile(path.join(ws, 'package.json'), 'utf8'));
  if (opts.projectTests !== false && pj.scripts?.test && !/no test specified/.test(pj.scripts.test)) {
    const linked = await linkNodeModules(root, ws);
    const res = await run('npm', ['test', '--silent'], ws, 120_000);
    projectTests = { ok: res.ok, command: 'npm test', tail: res.output.trim().split('\n').slice(-12).join('\n') };
    emit('prover', `Project tests (npm test): ${res.ok ? 'pass' : 'FAIL'}${linked ? '' : ' (no node_modules to link)'}`);
  }

  // The keeper ships inside the PR: merging the fix deploys its Warden.
  const keeperRecord = {
    package: pkg.name,
    version: pkg.version,
    route: diagnosis.route,
    adoptedAt: new Date().toISOString(),
    branch,
    lastKnownUpstream: pkg.facts?.latest,
    seenAdvisories: pkg.signals.advisories.map((a) => a.id),
  };
  const keeperSummary =
    `Proven ${diagnosis.route} fix drafted on ${branch} (${final.proof.totalRuns} inputs, candidate "${final.candidate}"). ` +
    (pkg.signals.advisories.length ? `Advisories resolved by removal: ${pkg.signals.advisories.map((a) => a.id).join(', ')}.` : 'No open advisories.');
  await adoptCommitted(ws, keeperRecord, keeperSummary);

  // 4. Commit and draft the pull request.
  await git(ws, ['add', '-A']);
  const recipe = findRecipe(pkg.name, pkg.version);
  await git(ws, [
    'commit',
    '-q',
    '-m',
    `${prTitle(diagnosis)}\n\nProof: ${final.proof.totalRuns} generated inputs agree with ${pkg.name}@${pkg.version}.\nReplay: ${proofTest.testRel}`,
  ]);
  const diff = await git(ws, ['diff', 'main', branch, '--', '.', ':(exclude)package-lock.json']);
  const lockDiff = await git(ws, ['diff', '--stat', 'main', branch, '--', 'package-lock.json']);
  const nameStatus = await git(ws, ['diff', '--name-status', 'main', branch]);
  const files = nameStatus
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, file] = line.split('\t');
      return { path: file, kind: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified' } as const;
    });

  const riskNotes: string[] = [];
  if (diagnosis.route === 'replace') {
    riskNotes.push(`Equivalence is proven on generated inputs within the documented API, not on every possible value. ${recipe?.summary ?? ''}`.trim());
    const header = recipe?.candidates.find((c) => c.id === final.candidate)?.shim.split('\n')[2]?.replace(/^\/\/\s*/, '');
    if (header) riskNotes.push(header);
  } else {
    riskNotes.push('The code is copied unchanged, so behaviour is identical; the project now owns it and the Warden watches for advisories against the original.');
  }
  if (!replay.ok) riskNotes.push('⚠️ The replay test failed in the workspace; do not merge until it passes.');
  if (projectTests && !projectTests.ok) riskNotes.push('⚠️ The project\'s own tests failed on this branch; see the output above.');

  const body = renderPrBody({
    pkg,
    diagnosis,
    attempts,
    changes,
    rewrite,
    replay: { ...proofTest, ok: replay.ok },
    projectTests,
    originalSource: original.source,
    integrity: original.integrity,
    license: original.license ?? pkg.facts?.license,
    licenseFile: vendoredLicense,
    removedFromLockfile: stillNeededBy.length === 0,
    stillNeededBy,
    riskNotes,
  });

  const prDir = path.join(root, '.graveyard', 'prs');
  await mkdir(prDir, { recursive: true });
  const bodyPath = path.join(prDir, `${safeName(pkg.name)}.md`);
  const patchPath = path.join(prDir, `${safeName(pkg.name)}.patch`);
  await writeFile(bodyPath, `# ${prTitle(diagnosis)}\n\n${body}\n`);
  await writeFile(patchPath, await git(ws, ['format-patch', '--stdout', `main..${branch}`]));

  const pr: PullRequestDraft = {
    title: prTitle(diagnosis),
    branch,
    body,
    diff: lockDiff.trim() ? `${diff}\n# package-lock.json\n${lockDiff}` : diff,
    files,
    workspace: ws,
    bodyPath,
    patchPath,
  };
  emit('pr', `Pull request drafted on ${branch} (${files.length} files)`, { title: pr.title, branch, files });

  // 5. Hand over to the Warden.
  await adopt(root, keeperRecord, keeperSummary);
  emit('warden', `A Warden keeper now watches ${pkg.name}`);

  const result: ResurrectionResult = { ...base, status: 'proven', attempts, pr, finishedAt: new Date().toISOString() };
  emit('done', 'Resurrection complete', { status: result.status });
  return result;
}

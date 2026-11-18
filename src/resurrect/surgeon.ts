import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findSpecifiers, listSourceFiles } from '../core/imports.ts';
import { git } from './git.ts';
import type { GoldenGroup } from './prover.ts';
import type { OriginalPackage } from './tarball.ts';

export const safeName = (name: string) => name.replace(/^@/, '').replace(/\//g, '__');
const toPosix = (p: string) => p.split(path.sep).join('/');

const COPY_SKIP = new Set(['node_modules', '.git', '.graveyard']);

/**
 * Copies the project into a scratch git repository so the Surgeon never edits
 * the user's working tree. The copy gets a baseline commit and a fix branch.
 */
export async function prepareWorkspace(root: string, branch: string): Promise<string> {
  const ws = path.join(root, '.graveyard', 'workspaces', branch.replace(/[^a-zA-Z0-9._-]/g, '-'));
  await rm(ws, { recursive: true, force: true });
  await mkdir(ws, { recursive: true });
  for (const entry of await readdir(root)) {
    if (COPY_SKIP.has(entry)) continue;
    await cp(path.join(root, entry), path.join(ws, entry), { recursive: true });
  }
  await git(ws, ['init', '-q', '-b', 'main']);
  await appendFile(path.join(ws, '.git', 'info', 'exclude'), '\nnode_modules\n');
  await git(ws, ['add', '-A']);
  await git(ws, ['commit', '-q', '-m', 'baseline', '--allow-empty']);
  await git(ws, ['switch', '-q', '-c', branch]);
  return ws;
}

export interface RewriteResult {
  files: string[];
  sites: number;
  /** Imports of a sub-path such as "pkg/lib/x", which a shim cannot stand in for. */
  unsupported: string[];
}

/** Points every import of `pkg` at `targetRel` (a path from the project root). */
export async function rewriteImports(ws: string, pkg: string, targetRel: string): Promise<RewriteResult> {
  const result: RewriteResult = { files: [], sites: 0, unsupported: [] };
  const wsReal = await realpath(ws);
  for (const file of await listSourceFiles(ws)) {
    // Never write through a path that resolves outside the scratch copy.
    const real = await realpath(file);
    if (real !== wsReal && !real.startsWith(wsReal + path.sep)) continue;
    const code = await readFile(file, 'utf8');
    const hits = findSpecifiers(code).filter((h) => h.spec === pkg || h.spec.startsWith(`${pkg}/`));
    if (!hits.length) continue;
    const rel = toPosix(path.relative(ws, file));
    const bad = hits.filter((h) => h.spec !== pkg);
    if (bad.length) {
      result.unsupported.push(...bad.map((h) => `${rel}:${h.line} imports "${h.spec}"`));
      continue;
    }
    let spec = toPosix(path.relative(path.dirname(file), path.join(ws, targetRel)));
    if (!spec.startsWith('.')) spec = `./${spec}`;
    let out = code;
    for (const h of [...hits].reverse()) out = out.slice(0, h.start) + spec + out.slice(h.end);
    await writeFile(file, out);
    result.files.push(rel);
    result.sites += hits.length;
  }
  return result;
}

/**
 * Places that still load the package after the rewrite: any source file in the
 * copy (build output and tool folders included), plus package.json scripts that
 * call one of its executables. Any hit means the dependency cannot be removed.
 */
export async function findRemainingUses(ws: string, pkg: string, binNames: string[]): Promise<string[]> {
  const left: string[] = [];
  for (const file of await listSourceFiles(ws, { everywhere: true })) {
    const rel = toPosix(path.relative(ws, file));
    if (rel.startsWith('graveyard/')) continue;
    const code = await readFile(file, 'utf8');
    for (const h of findSpecifiers(code)) {
      if (h.spec === pkg || h.spec.startsWith(`${pkg}/`)) left.push(`${rel}:${h.line} still loads "${h.spec}"`);
    }
  }
  const pj = JSON.parse(await readFile(path.join(ws, 'package.json'), 'utf8'));
  for (const [script, cmd] of Object.entries<string>(pj.scripts ?? {})) {
    for (const bin of binNames) {
      if (new RegExp(`(^|[\\s;&|(])${bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s;&|)])`).test(cmd)) {
        left.push(`package.json script "${script}" runs its executable "${bin}"`);
      }
    }
  }
  return left;
}

function detectIndent(text: string): string {
  return text.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
}

/** Removes the dependency from package.json and, when nothing else needs it, from the lockfile. */
export async function removeDependency(ws: string, pkg: string, stillNeededBy: string[]): Promise<void> {
  const pjPath = path.join(ws, 'package.json');
  const pjText = await readFile(pjPath, 'utf8');
  const pj = JSON.parse(pjText);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (pj[field]?.[pkg] !== undefined) delete pj[field][pkg];
  }
  await writeFile(pjPath, `${JSON.stringify(pj, null, detectIndent(pjText))}\n`);

  const lockPath = path.join(ws, 'package-lock.json');
  if (!existsSync(lockPath)) return;
  const lockText = await readFile(lockPath, 'utf8');
  const lock = JSON.parse(lockText);
  const rootEntry = lock.packages?.[''];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (rootEntry?.[field]?.[pkg] !== undefined) delete rootEntry[field][pkg];
  }
  if (stillNeededBy.length === 0) {
    if (lock.packages) delete lock.packages[`node_modules/${pkg}`];
    if (lock.dependencies?.[pkg]) delete lock.dependencies[pkg];
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, detectIndent(lockText))}\n`);
}

export async function writeShim(ws: string, pkg: string, source: string): Promise<string> {
  const rel = `graveyard/shims/${safeName(pkg)}.cjs`;
  await mkdir(path.join(ws, 'graveyard', 'shims'), { recursive: true });
  await writeFile(path.join(ws, rel), source);
  return rel;
}

const VENDOR_FILE = /\.(c|m)?js$|\.json$/i;
const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\..*)?$/i;
const VENDOR_SKIP_DIR = /^(test|tests|__tests__|spec|example|examples|benchmark|perf|docs?|\.github)$/i;

/** Copies the package's runtime files and licence into graveyard/vendor/<name>. */
export async function vendorPackage(
  ws: string,
  pkg: string,
  version: string,
  original: OriginalPackage,
): Promise<{ dirRel: string; entryRel: string; files: string[]; licenseFile?: string }> {
  const dirRel = `graveyard/vendor/${safeName(pkg)}`;
  const dest = path.join(ws, dirRel);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const files: string[] = [];
  let licenseFile: string | undefined;

  async function walk(from: string, relDir: string) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !VENDOR_SKIP_DIR.test(entry.name)) await walk(path.join(from, entry.name), rel);
        continue;
      }
      const isLicense = !relDir && LICENSE_FILE.test(entry.name);
      const isTest = /(^|[./-])(test|spec)\.(c|m)?js$/i.test(entry.name);
      if (!isLicense && (!VENDOR_FILE.test(entry.name) || isTest)) continue;
      await mkdir(path.join(dest, relDir), { recursive: true });
      await cp(path.join(from, entry.name), path.join(dest, rel));
      files.push(rel);
      if (isLicense) licenseFile = rel;
    }
  }
  await walk(original.dir, '');

  await writeFile(
    path.join(dest, 'PROVENANCE.json'),
    `${JSON.stringify(
      {
        package: pkg,
        version,
        license: original.license ?? null,
        licenseFile: licenseFile ?? null,
        source: original.source,
        tarball: original.tarball ?? null,
        integrity: original.integrity ?? null,
        files,
        inlinedBy: 'Graveyard Shift (Surgeon, inline route)',
        note: 'Copied unchanged from the published package. Keep the licence file with the code.',
      },
      null,
      2,
    )}\n`,
  );
  files.push('PROVENANCE.json');
  return { dirRel, entryRel: `${dirRel}/${original.main}`, files, licenseFile };
}

/** Writes the recorded cases and a node:test file that replays them against the new code forever. */
export async function writeProofTest(
  ws: string,
  pkg: string,
  version: string,
  subjectRel: string,
  golden: GoldenGroup[],
  codecSource: string,
): Promise<{ testRel: string; dataRel: string; cases: number }> {
  const base = safeName(pkg);
  const dir = path.join(ws, 'graveyard', 'proofs');
  await mkdir(dir, { recursive: true });
  const dataRel = `graveyard/proofs/${base}.golden.json`;
  const testRel = `graveyard/proofs/${base}.proof.test.js`;
  const groups = golden.filter((g) => g.cases.length > 0);
  await writeFile(
    path.join(ws, dataRel),
    `${JSON.stringify({ package: pkg, version, recordedFrom: `${pkg}@${version}`, groups: groups.map((g) => ({ property: g.property, cases: g.cases })) }, null, 1)}\n`,
  );

  let subject = toPosix(path.relative(dir, path.join(ws, subjectRel)));
  if (!subject.startsWith('.')) subject = `./${subject}`;
  const codecBody = codecSource.replace(/^'use strict';\s*/, '').replace(/module\.exports\s*=.*$/m, '');
  const test = `'use strict';
// Proof replay for ${pkg}@${version}, written by Graveyard Shift.
// Each case was generated by fast-check and run against the original package
// before it was removed; the new code must keep giving the same answers.
const test = require('node:test');
const assert = require('node:assert');
const { isDeepStrictEqual } = require('node:util');
const subject = require(${JSON.stringify(subject)});
const recorded = require('./${base}.golden.json');

const calls = [
${groups.map((g) => `  ${g.call},`).join('\n')}
];

${codecBody.trim()}

function run(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: (err && err.constructor && err.constructor.name) || typeof err };
  }
}

recorded.groups.forEach((group, i) => {
  test(${JSON.stringify(`${pkg}: `)} + group.property, () => {
    for (const c of group.cases) {
      const args = decode(c.args);
      const got = run(() => calls[i](subject, args));
      const want = c.outcome.ok ? { ok: true, value: decode(c.outcome.value) } : c.outcome;
      assert.ok(
        got.ok === want.ok && (got.ok ? isDeepStrictEqual(got.value, want.value) : got.error === want.error),
        \`args \${JSON.stringify(c.args)}: expected \${JSON.stringify(c.outcome)}, got \${JSON.stringify(got.ok ? { ok: true } : got)}\`,
      );
    }
  });
});
`;
  await writeFile(path.join(ws, testRel), test);
  return { testRel, dataRel, cases: groups.reduce((n, g) => n + g.cases.length, 0) };
}

/** Lets the copied project run its own tests against the original install. */
export async function linkNodeModules(root: string, ws: string): Promise<boolean> {
  const from = path.join(root, 'node_modules');
  if (!existsSync(from) || existsSync(path.join(ws, 'node_modules'))) return false;
  await symlink(from, path.join(ws, 'node_modules'), 'dir');
  return true;
}

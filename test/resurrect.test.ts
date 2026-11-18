import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { scanProjectDir } from '../src/core/scanner.ts';
import type { ScanReport } from '../src/core/types.ts';
import { resurrect } from '../src/resurrect/resurrect.ts';
import { loadMemory } from '../src/warden/memory.ts';
import { patrol } from '../src/warden/warden.ts';

const EXAMPLE = path.resolve('examples/haunted-app');
const installed = existsSync(path.join(EXAMPLE, 'node_modules'));

describe.skipIf(!installed)('end to end on a copy of the haunted app (offline)', () => {
  let root: string;
  let report: ScanReport;

  beforeAll(async () => {
    root = path.join(await mkdtemp(path.join(tmpdir(), 'graveyard-e2e-')), 'haunted-app');
    await cp(EXAMPLE, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}.graveyard`) });
    report = await scanProjectDir(root);
  });

  it('ranks the zombies, with the ReDoS-flawed trim on top', () => {
    expect(report.totals.zombies).toBeGreaterThan(10);
    expect(report.packages[0].name).toBe('trim');
    expect(report.packages[0].signals.advisories.map((a) => a.aliases).flat()).toContain('CVE-2020-7753');
    expect(report.packages.find((p) => p.name === 'dayjs')!.score.zombie).toBe(false);
  });

  it('replaces left-pad: rejects padStart, proves the second candidate, keeps the app working', async () => {
    const events: string[] = [];
    const result = await resurrect(root, 'left-pad', { report, onEvent: (e) => events.push(e.message) });
    expect(result.status).toBe('proven');
    expect(result.attempts.map((a) => a.proof.passed)).toEqual([false, true]);
    expect(events.some((m) => m.startsWith('Rejected "padStart"'))).toBe(true);

    const ws = result.pr!.workspace;
    const format = await readFile(path.join(ws, 'src/format.js'), 'utf8');
    expect(format).toContain(`require('../graveyard/shims/left-pad.cjs')`);
    const pj = JSON.parse(await readFile(path.join(ws, 'package.json'), 'utf8'));
    expect(pj.dependencies['left-pad']).toBeUndefined();
    const lock = JSON.parse(await readFile(path.join(ws, 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/left-pad']).toBeUndefined();
    // The project's own output is unchanged.
    const run = (dir: string) => execFileSync(process.execPath, ['-e', `console.log(require('./src/index').printReceipt([{sku:'a',label:' x ',cents:5}]))`], { cwd: dir }).toString();
    expect(run(ws)).toBe(run(root));
    // The user's working tree is untouched.
    expect(await readFile(path.join(root, 'src/format.js'), 'utf8')).toContain(`require('left-pad')`);
  });

  it('inlines is-number with its licence and provenance', async () => {
    const result = await resurrect(root, 'is-number', { report, projectTests: false });
    expect(result.status).toBe('proven');
    const files = result.pr!.files.map((f) => f.path);
    expect(files).toContain('graveyard/vendor/is-number/LICENSE');
    expect(files).toContain('graveyard/vendor/is-number/PROVENANCE.json');
  });

  it('escalates request to a human instead of guessing', async () => {
    const result = await resurrect(root, 'request', { report });
    expect(result.status).toBe('escalated');
    expect(result.pr).toBeUndefined();
    expect(result.escalation).toMatch(/fetch/);
  });

  it('the Warden remembers adopted packages and never handles an advisory twice', async () => {
    const memory = await loadMemory(root);
    expect(memory.keepers.map((k) => k.package).sort()).toEqual(['is-number', 'left-pad']);
    const first = await patrol(root, { simulate: { package: 'is-number' }, now: new Date('2026-11-01T00:00:00Z') });
    expect(first.drafts).toHaveLength(1);
    expect(first.drafts[0].body).toMatch(/SIMULATED/);
    const again = await patrol(root, { now: new Date('2026-11-02T00:00:00Z') });
    expect(again.drafts).toHaveLength(0);
    const kept = again.memory.keepers.find((k) => k.package === 'is-number')!;
    expect(kept.decisions.filter((d) => d.kind === 'patch-drafted')).toHaveLength(1);
  });
});

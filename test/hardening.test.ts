// Regression tests for the issues found by the completion audit.
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSpecifiers, listSourceFiles } from '../src/core/imports.ts';
import { parseLockfile } from '../src/core/lockfile.ts';
import { scorePackage } from '../src/core/score.ts';
import type { ScannedPackage, Signals } from '../src/core/types.ts';
import { diagnose } from '../src/resurrect/coroner.ts';
import { findRemainingUses, rewriteImports } from '../src/resurrect/surgeon.ts';
import { patrol } from '../src/warden/warden.ts';
import { saveMemory } from '../src/warden/memory.ts';

async function tmp(name: string) {
  return mkdtemp(path.join(tmpdir(), `graveyard-${name}-`));
}

describe('import detection', () => {
  it('sees require.resolve and template-literal dynamic imports', () => {
    const code = "require.resolve('left-pad');\nconst m = await import(`left-pad`);\nimport(`x/${y}`);";
    expect(findSpecifiers(code).map((h) => h.spec)).toEqual(['left-pad', 'left-pad']);
  });

  it('searches nested build folders, but skips root build output unless asked', async () => {
    const root = await tmp('walk');
    await mkdir(path.join(root, 'src/build'), { recursive: true });
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'src/build/b.js'), "require('left-pad')");
    await writeFile(path.join(root, 'dist/out.js'), "require('left-pad')");
    const rel = (files: string[]) => files.map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(rel(await listSourceFiles(root))).toEqual(['src/build/b.js']);
    expect(rel(await listSourceFiles(root, { everywhere: true }))).toEqual(['dist/out.js', 'src/build/b.js']);
  });

  it('never rewrites through a symlink that points outside the scratch copy', async () => {
    const outside = await tmp('outside');
    const ws = await tmp('ws');
    await writeFile(path.join(outside, 'real.js'), "require('left-pad')");
    await symlink(path.join(outside, 'real.js'), path.join(ws, 'alias.js'));
    const res = await rewriteImports(ws, 'left-pad', 'graveyard/shims/left-pad.cjs');
    expect(res.files).toEqual([]);
  });

  it('finds uses the rewrite cannot redirect: build output and package.json executables', async () => {
    const ws = await tmp('remaining');
    await mkdir(path.join(ws, 'dist'), { recursive: true });
    await writeFile(path.join(ws, 'dist/x.js'), "require('tiny-cli')");
    await writeFile(path.join(ws, 'package.json'), JSON.stringify({ scripts: { shout: 'tiny hello && echo done', other: 'tinyx' } }));
    const left = await findRemainingUses(ws, 'tiny-cli', ['tiny']);
    expect(left).toHaveLength(2);
    expect(left.join('\n')).toMatch(/dist\/x\.js/);
    expect(left.join('\n')).toMatch(/script "shout"/);
  });
});

describe('lockfile edge cases', () => {
  const v3 = (packages: Record<string, unknown>) => JSON.stringify({ lockfileVersion: 3, packages });

  it('treats an npm alias as direct and remembers the alias (v3)', () => {
    const parsed = parseLockfile(v3({ '': { dependencies: { pad: 'npm:left-pad@1.3.0' } }, 'node_modules/pad': { name: 'left-pad', version: '1.3.0' } }));
    expect(parsed.packages[0]).toMatchObject({ name: 'left-pad', version: '1.3.0', alias: 'pad', direct: true });
  });

  it('parses a v1 alias into the real name and version', () => {
    const lock = JSON.stringify({ lockfileVersion: 1, dependencies: { pad: { version: 'npm:left-pad@1.3.0' } } });
    const parsed = parseLockfile(lock, JSON.stringify({ dependencies: { pad: 'npm:left-pad@1.3.0' } }));
    expect(parsed.packages[0]).toMatchObject({ name: 'left-pad', version: '1.3.0', alias: 'pad', direct: true });
  });

  it("counts a workspace's dependencies as direct", () => {
    const parsed = parseLockfile(
      v3({
        '': { workspaces: ['packages/*'] },
        'packages/web': { name: 'web', dependencies: { trim: '0.0.1' } },
        'node_modules/web': { resolved: 'packages/web', link: true },
        'node_modules/trim': { version: '0.0.1' },
      }),
    );
    expect(parsed.packages.find((p) => p.name === 'trim')!.direct).toBe(true);
  });

  it('skips entries whose name or version could escape a path or inject code', () => {
    const parsed = parseLockfile(
      v3({
        '': { dependencies: { ok: '1' } },
        'node_modules/ok': { version: '1.0.0' },
        'node_modules/bad': { version: '1.3.0/../../../../tmp/x' },
        'node_modules/evil': { name: "x');process.exit(1);//", version: '1.0.0' },
      }),
    );
    expect(parsed.packages.map((p) => p.name)).toEqual(['ok']);
    expect(parsed.skipped).toEqual(['node_modules/bad', 'node_modules/evil']);
  });
});

describe('Coroner refuses unsafe automation', () => {
  function pkg(over: Partial<ScannedPackage>): ScannedPackage {
    const signals: Signals = { deprecated: true, daysSinceLastPublish: 3000, repo: 'active', advisories: [], usageSites: 1, usageFiles: 1, direct: true, dependents: 0 };
    return {
      name: 'left-pad', version: '1.3.0', paths: ['node_modules/left-pad'], direct: true, dev: false, dependents: [], dependencies: [],
      facts: { latest: '1.3.0', lastPublish: '2018-04-09', license: 'MIT', unpackedSize: 4000, maintainers: 1 },
      signals, score: scorePackage(signals), importedBy: ['src/a.js'], ...over,
    };
  }

  it('escalates a direct dependency that no source file imports', () => {
    const d = diagnose(pkg({ importedBy: [] }), []);
    expect(d.automated).toBe(false);
    expect(d.rationale.at(-1)).toMatch(/No source file imports it/);
  });

  it('escalates an aliased install', () => {
    expect(diagnose(pkg({ alias: 'pad' }), []).automated).toBe(false);
  });
});

describe('Warden', () => {
  it('says the check was skipped, not "all quiet", when advisories cannot be fetched', async () => {
    const root = await tmp('warden');
    await saveMemory(root, {
      project: 'x',
      keepers: [{ package: 'zz-not-cached-pkg', version: '1.0.0', route: 'inline', adoptedAt: '2026-11-01T00:00:00Z', seenAdvisories: [], decisions: [] }],
    });
    const res = await patrol(root, { now: new Date('2026-11-02T00:00:00Z') });
    const last = res.memory.keepers[0].decisions.at(-1)!;
    expect(last.summary).toMatch(/skipped/);
    expect(res.events.map((e) => e.message).join('\n')).not.toMatch(/all quiet/);
  });
});

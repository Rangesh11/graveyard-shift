import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_ROOT } from '../core/cache.ts';
import type { ProofResult, PropertyResult } from '../core/types.ts';
import type { PropertySpec } from './recipes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'proof-runner.mjs');

export interface GoldenGroup {
  property: string;
  call: string;
  cases: Array<{ args: unknown; outcome: unknown }>;
}

export interface ProveOptions {
  /** Entry file of the original package. */
  oldPath: string;
  /** Entry file of the new code (shim or inlined copy). */
  newPath: string;
  properties: PropertySpec[];
  candidate: string;
  numRuns?: number;
  seed?: number;
  /** Recorded cases per property for the replay test; 0 to skip. */
  golden?: number;
  /** Extra directories the sandbox may read (the old package's own dependencies). */
  readDirs?: string[];
  timeoutMs?: number;
}

export interface ProveOutput {
  result: ProofResult;
  golden: GoldenGroup[];
}

function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function nodeModulesRoot(file: string): string {
  const idx = file.lastIndexOf(`${path.sep}node_modules${path.sep}`);
  return idx === -1 ? path.dirname(file) : file.slice(0, idx + '/node_modules'.length);
}

/**
 * Runs the property-based proof in a sandboxed child process: Node's permission
 * model lets the code read only the listed paths, and blocks file writes,
 * child processes, workers and native addons. The environment is emptied so
 * no secrets reach package code.
 */
export async function prove(opts: ProveOptions): Promise<ProveOutput> {
  // Real paths only: module loading stats every path component, and a symlink
  // such as macOS /var -> /private/var would otherwise need extra read access.
  const dir = realpathOr(await mkdtemp(path.join(tmpdir(), 'graveyard-proof-')));
  const oldPath = realpathOr(opts.oldPath);
  const newPath = realpathOr(opts.newPath);
  const configPath = path.join(dir, 'config.json');
  const seed = opts.seed ?? 20261031;
  await writeFile(
    configPath,
    JSON.stringify({
      oldPath,
      newPath,
      properties: opts.properties,
      numRuns: opts.numRuns ?? 500,
      seed,
      golden: opts.golden ?? 40,
    }),
  );

  const readable = [
    HERE,
    path.join(TOOL_ROOT, 'node_modules'),
    nodeModulesRoot(oldPath),
    path.dirname(newPath),
    dir,
    ...(opts.readDirs ?? []),
  ];
  const allowed = new Set(readable.map(realpathOr));
  const args = ['--permission', ...[...allowed].map((p) => `--allow-fs-read=${p}`), RUNNER, configPath];
  const started = Date.now();

  try {
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 120_000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    if (code !== 0 || !stdout) {
      const lines = stderr.trim().split('\n');
      const reason = (lines.find((l) => /^\s*(\w*Error|Error)( \[\w+\])?:/.test(l)) ?? lines.slice(-3).join(' ')).trim() || `exit code ${code}`;
      const failed: PropertyResult = { name: 'proof runner', runs: 0, passed: false, seed, error: reason };
      return {
        result: {
          passed: false,
          candidate: opts.candidate,
          properties: [failed],
          totalRuns: 0,
          goldenCases: 0,
          durationMs: Date.now() - started,
          sandboxed: true,
        },
        golden: [],
      };
    }

    const parsed = JSON.parse(stdout) as { properties: PropertyResult[]; golden: GoldenGroup[] };
    const properties = parsed.properties;
    return {
      result: {
        passed: properties.length > 0 && properties.every((p) => p.passed),
        candidate: opts.candidate,
        properties,
        totalRuns: properties.reduce((n, p) => n + p.runs, 0),
        goldenCases: parsed.golden.reduce((n, g) => n + g.cases.length, 0),
        durationMs: Date.now() - started,
        sandboxed: true,
      },
      golden: parsed.golden,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

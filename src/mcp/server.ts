// Graveyard Shift MCP server. Gives Kiro agents (Coroner, Surgeon, Warden) real
// data instead of guesses: registry facts, advisories, repo status and package
// diffs, plus the scanner, the Coroner and the proven fix pipeline.
//
// Logs go to stderr: stdout carries the MCP protocol.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { repoStatus } from '../core/github.ts';
import { advisoriesFor } from '../core/osv.ts';
import { factsFor, getPackageDoc } from '../core/registry.ts';
import { scanProjectDir } from '../core/scanner.ts';
import { daysBetween } from '../core/score.ts';
import { diagnose } from '../resurrect/coroner.ts';
import { findPackage, resurrect } from '../resurrect/resurrect.ts';
import { locateOriginal } from '../resurrect/tarball.ts';
import { loadMemory } from '../warden/memory.ts';
import { patrol } from '../warden/warden.ts';

const execFileP = promisify(execFile);

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const fail = (err: unknown) => ({ ...text(`Error: ${(err as Error).message}`), isError: true });

const server = new McpServer({ name: 'graveyard-shift', version: '0.1.0' });

server.registerTool(
  'npm_registry',
  {
    title: 'npm registry facts',
    description:
      'Registry facts for one npm package version: latest version, deprecation notices, publish dates, licence, repository, size, maintainers, and days since the last release.',
    inputSchema: { name: z.string().describe('Package name, e.g. "left-pad"'), version: z.string().optional().describe('Installed version; defaults to latest') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ name, version }) => {
    try {
      const doc = await getPackageDoc(name);
      const facts = factsFor(doc, version ?? doc.latest);
      return text({ name, version: version ?? doc.latest, ...facts, daysSinceLastPublish: daysBetween(facts.lastPublish), versions: Object.keys(doc.versions).length });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'osv_advisories',
  {
    title: 'Known advisories (OSV)',
    description: 'Known security advisories for npm package versions from the OSV database, with severity and the first fixed version when one exists.',
    inputSchema: { packages: z.array(z.object({ name: z.string(), version: z.string() })).min(1).max(200) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ packages }) => {
    try {
      const res = await advisoriesFor(packages);
      return text(Object.fromEntries(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'github_repo_status',
  {
    title: 'Source repository status',
    description: 'Whether a package\'s GitHub repository is active, archived or missing, and when it was last pushed. Accepts a repository URL or a package name.',
    inputSchema: { repository: z.string().optional(), package: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ repository, package: pkg }) => {
    try {
      let url = repository;
      if (!url && pkg) {
        const doc = await getPackageDoc(pkg);
        url = doc.versions[doc.latest]?.repositoryUrl;
      }
      if (!url) return fail(new Error('Give a repository URL or a package name with a repository field.'));
      return text({ repository: url, ...(await repoStatus(url)) });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'package_diff',
  {
    title: 'Diff two published versions',
    description:
      'Unified diff between two published versions of an npm package (downloaded from the registry and hash-checked). Use it to see what an upstream release or a fork changed before adopting it.',
    inputSchema: { name: z.string(), from: z.string(), to: z.string(), maxBytes: z.number().int().positive().max(400_000).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ name, from, to, maxBytes }) => {
    try {
      const a = await locateOriginal('/nonexistent', name, from, {});
      const b = await locateOriginal('/nonexistent', name, to, {});
      const res = await execFileP('git', ['diff', '--no-index', '--stat', '--patch', a.dir, b.dir], { maxBuffer: 16 * 1024 * 1024 }).catch(
        (e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }),
      );
      const out = res.stdout.split(a.dir).join(`${name}@${from}`).split(b.dir).join(`${name}@${to}`);
      const limit = maxBytes ?? 60_000;
      return text(out.length > limit ? `${out.slice(0, limit)}\n… truncated (${out.length} bytes)` : out || 'No differences.');
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'graveyard_scan',
  {
    title: 'Scan a project for zombie dependencies',
    description: 'Reads package-lock.json in a project directory, scores every package and returns the zombies ranked by risk.',
    inputSchema: { dir: z.string().describe('Project directory containing package-lock.json'), limit: z.number().int().positive().max(500).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ dir, limit }) => {
    try {
      const report = await scanProjectDir(path.resolve(dir));
      const zombies = report.packages
        .filter((p) => p.score.zombie)
        .slice(0, limit ?? 30)
        .map((p) => ({ name: p.name, version: p.version, direct: p.direct, risk: p.score.risk, status: p.score.status, reasons: p.score.reasons, advisories: p.signals.advisories.map((a) => `${a.id} (${a.severity})`), importedBy: p.importedBy }));
      return text({ project: report.project, totals: report.totals, warnings: report.warnings, zombies });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'graveyard_diagnose',
  {
    title: 'Coroner: pick the fix route',
    description: 'The Coroner\'s decision for one package: Inline, Replace or Adopt, whether it can be automated, and why.',
    inputSchema: { dir: z.string(), package: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ dir, package: name }) => {
    try {
      const report = await scanProjectDir(path.resolve(dir));
      const pkg = findPackage(report, name);
      if (!pkg) return fail(new Error(`"${name}" is not in the lockfile.`));
      return text(diagnose(pkg, report.packages));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'graveyard_resurrect',
  {
    title: 'Surgeon: fix, prove and draft the pull request',
    description:
      'Runs the automated fix for one zombie on a scratch branch under .graveyard/workspaces (the working tree is not touched), proves it with property-based tests against the original, and writes the pull-request body and patch. Returns the result, including rejected candidates and their counterexamples.',
    inputSchema: { dir: z.string(), package: z.string(), runs: z.number().int().positive().max(10_000).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ dir, package: name, runs }) => {
    try {
      const log: string[] = [];
      const result = await resurrect(path.resolve(dir), name, { numRuns: runs, onEvent: (e) => log.push(`${e.stage}: ${e.message}`) });
      const { pr, ...rest } = result;
      return text({ log, ...rest, pr: pr && { title: pr.title, branch: pr.branch, bodyPath: pr.bodyPath, patchPath: pr.patchPath, files: pr.files } });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'warden_patrol',
  {
    title: 'Warden: patrol kept packages',
    description: 'Checks every package the project has adopted for new advisories and upstream releases, records each decision in the keeper memory, and drafts patch pull requests when inlined code is affected.',
    inputSchema: { dir: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ dir }) => {
    try {
      const res = await patrol(path.resolve(dir));
      return text({ events: res.events.map((e) => e.message), drafts: res.drafts.map((d) => ({ title: d.title, bodyPath: d.bodyPath })), memory: res.memory });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  'warden_memory',
  {
    title: 'Warden: read keeper memory',
    description: 'What each keeper bot remembers: adopted packages, handled advisories and every past decision.',
    inputSchema: { dir: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ dir }) => text(await loadMemory(path.resolve(dir))),
);

await server.connect(new StdioServerTransport());
console.error('graveyard-shift MCP server ready on stdio');

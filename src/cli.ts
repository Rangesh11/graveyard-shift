import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanProjectDir } from './core/scanner.ts';
import type { ScanReport } from './core/types.ts';
import { diagnose } from './resurrect/coroner.ts';
import { findPackage, resurrect } from './resurrect/resurrect.ts';
import { loadMemory } from './warden/memory.ts';
import { patrol } from './warden/warden.ts';

const HELP = `Graveyard Shift: the night crew that keeps dead dependencies alive.

Usage:
  graveyard scan [dir] [--all] [--json]          Rank the dead packages in a project
  graveyard diagnose <package> [--dir d] [--json] Ask the Coroner for the safest fix route
  graveyard resurrect <package> [--dir d]         Fix it on a branch, prove it, draft the pull request
        [--runs n] [--no-project-tests] [--json]
        [--open-pr]                               Also push the branch and open a real GitHub pull request
  graveyard warden patrol [--dir d] [--simulate p] Let the keeper bots check for new advisories
        [--json]                                  Machine-readable result (used by the scheduled workflow)
  graveyard warden status [--dir d]               Show what each keeper remembers
  graveyard serve [--port 8787]                   Start the API and the graveyard map UI
  graveyard mcp                                   Start the MCP server on stdio

Environment: GITHUB_TOKEN (more repo checks), GRAVEYARD_OFFLINE=1 (cached data only).`;

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function printScan(report: ScanReport, all: boolean) {
  const t = report.totals;
  console.log(c.bold(`\n🪦  ${report.project}: ${t.zombies} of ${t.packages} packages are zombies (${t.directZombies} chosen directly, ${t.withAdvisories} with known flaws)\n`));
  const rows = report.packages.filter((p) => all || p.score.zombie).slice(0, all ? undefined : 25);
  for (const p of rows) {
    const risk = p.score.risk >= 70 ? c.red : p.score.risk >= 50 ? c.yellow : (s: string) => s;
    const flaws = p.signals.advisories.length ? c.red(` ⚠ ${p.signals.advisories.map((a) => a.id).join(', ')}`) : '';
    console.log(
      `${risk(String(p.score.risk).padStart(3))}  ${(p.direct ? '●' : c.dim('○'))} ${p.name.padEnd(24)} ${c.dim(p.version.padEnd(9))} ${p.score.status.padEnd(10)} ${c.dim(p.score.reasons.slice(0, 2).join('; '))}${flaws}`,
    );
  }
  if (!all && report.packages.filter((p) => p.score.zombie).length > 25) console.log(c.dim('  … more with --all'));
  for (const w of report.warnings) console.log(c.yellow(`\n! ${w}`));
  console.log(c.dim('\n● direct dependency  ○ transitive. Next: graveyard diagnose <package>'));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', short: 'd' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      runs: { type: 'string' },
      'no-project-tests': { type: 'boolean' },
      'open-pr': { type: 'boolean' },
      simulate: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, arg, arg2] = positionals;
  const dir = path.resolve(values.dir ?? (cmd === 'scan' && arg ? arg : '.'));

  switch (cmd) {
    case 'scan': {
      const report = await scanProjectDir(dir, { onProgress: values.json ? undefined : (m) => console.error(c.dim(`· ${m}`)) });
      if (values.json) console.log(JSON.stringify(report, null, 2));
      else printScan(report, Boolean(values.all));
      return;
    }
    case 'diagnose': {
      if (!arg) throw new Error('Name a package: graveyard diagnose <package>');
      const report = await scanProjectDir(dir);
      const pkg = findPackage(report, arg);
      if (!pkg) throw new Error(`"${arg}" is not in the lockfile.`);
      const d = diagnose(pkg, report.packages);
      if (values.json) return void console.log(JSON.stringify(d, null, 2));
      console.log(c.bold(`\nCoroner on ${pkg.name}@${pkg.version}: ${d.route.toUpperCase()} route, ${d.automated ? c.green('automated') : c.yellow('needs a human')}`));
      for (const r of d.rationale) console.log(`  - ${r}`);
      if (d.viaParent) console.log(`  → fix "${d.viaParent}" instead`);
      return;
    }
    case 'resurrect': {
      if (!arg) throw new Error('Name a package: graveyard resurrect <package>');
      const result = await resurrect(dir, arg, {
        numRuns: values.runs ? Number(values.runs) : undefined,
        projectTests: !values['no-project-tests'],
        onEvent: values.json ? undefined : (e) => console.log(`${c.dim(`[${(e.at / 1000).toFixed(1)}s]`)} ${e.stage.padEnd(8)} ${e.message}`),
      });
      if (values.json) return void console.log(JSON.stringify(result, null, 2));
      if (result.pr) {
        console.log(c.green(`\n✔ ${result.pr.title}`));
        console.log(`  branch   ${result.pr.branch}  (in ${path.relative(process.cwd(), result.pr.workspace)})`);
        console.log(`  PR body  ${path.relative(process.cwd(), result.pr.bodyPath)}`);
        console.log(`  patch    ${path.relative(process.cwd(), result.pr.patchPath)}  (git am < patch to apply)`);
        if (values['open-pr']) {
          const { openPullRequest } = await import('./resurrect/publish.ts');
          const url = await openPullRequest(dir, result.pr);
          console.log(c.green(`  opened   ${url}`));
        }
      } else {
        console.log(c.yellow(`\n${result.status.toUpperCase()}\n`) + (result.escalation ?? ''));
      }
      return;
    }
    case 'warden': {
      if (arg === 'patrol') {
        const res = await patrol(dir, { simulate: values.simulate ? { package: values.simulate } : undefined });
        if (values.json) {
          console.log(JSON.stringify({ changed: res.changed, events: res.events.map((e) => e.message), drafts: res.drafts.map((d) => ({ title: d.title, branch: d.branch, bodyPath: d.bodyPath, taskPath: d.patchPath })) }, null, 2));
          return;
        }
        for (const e of res.events) console.log(`warden  ${e.message}`);
        for (const d of res.drafts) console.log(c.yellow(`\n✎ ${d.title}\n  ${path.relative(process.cwd(), d.bodyPath)}`));
        return;
      }
      if (arg === 'status' || !arg) {
        const memory = await loadMemory(dir);
        if (!memory.keepers.length) return void console.log('No keepers yet.');
        for (const k of memory.keepers) {
          console.log(c.bold(`\n${k.package}@${k.version}  (${k.route}, since ${k.adoptedAt.slice(0, 10)})`));
          for (const d of k.decisions.slice(-6)) console.log(`  ${c.dim(d.at.slice(0, 16).replace('T', ' '))} ${d.kind.padEnd(13)} ${d.summary}`);
        }
        return;
      }
      throw new Error(`Unknown warden command "${arg ?? arg2}"`);
    }
    case 'serve': {
      const { startServer } = await import('./server/app.ts');
      await startServer(Number(values.port ?? process.env.PORT ?? 8787));
      return;
    }
    case 'mcp': {
      await import('./mcp/server.ts');
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(c.red(`✖ ${(err as Error).message}`));
  process.exit(1);
});

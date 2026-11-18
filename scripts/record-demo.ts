// Records a real run against examples/haunted-app for the static hosted demo:
// the scan, every Coroner verdict, each automated resurrection (with its live
// event log), the Warden memory and one simulated-advisory patrol. It also
// saves the registry/advisory/repo lookups to fixtures/cache so the project
// runs offline with GRAVEYARD_OFFLINE=1.
//
// Run with: npm run demo:record. Set GITHUB_TOKEN so repo checks are not rate limited.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { CACHE_DIR, FIXTURE_CACHE_DIR, keyFile, TOOL_ROOT } from '../src/core/cache.ts';
import { parseGitHubRepo } from '../src/core/github.ts';
import { scanProjectDir } from '../src/core/scanner.ts';
import type { ProgressEvent } from '../src/core/types.ts';
import { diagnose } from '../src/resurrect/coroner.ts';
import { resurrect } from '../src/resurrect/resurrect.ts';
import { safeName } from '../src/resurrect/surgeon.ts';
import { loadMemory } from '../src/warden/memory.ts';
import { patrol } from '../src/warden/warden.ts';

const ROOT = path.join(TOOL_ROOT, 'examples', 'haunted-app');
const OUT = path.join(TOOL_ROOT, 'web', 'public', 'demo');

const save = (file: string, data: unknown) => writeFile(path.join(OUT, file), `${JSON.stringify(data)}\n`);

await rm(path.join(ROOT, '.graveyard'), { recursive: true, force: true });
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

console.log(`cache: ${CACHE_DIR}`);
const report = await scanProjectDir(ROOT, { onProgress: (m) => console.log(`· ${m}`) });
await save('scan.json', report);

const diagnoses = Object.fromEntries(report.packages.filter((p) => p.score.zombie).map((p) => [p.name, diagnose(p, report.packages)]));
await save('diagnoses.json', diagnoses);

const targets = report.packages.filter((p) => p.direct && p.score.zombie);
for (const pkg of targets) {
  const events: ProgressEvent[] = [];
  const result = await resurrect(ROOT, pkg.name, { report, onEvent: (e) => events.push(e) });
  // Workspace paths are local to this machine; the demo does not need them.
  if (result.pr) result.pr = { ...result.pr, workspace: '', bodyPath: '', patchPath: '' };
  await save(`resurrect-${safeName(pkg.name)}.json`, { events, result });
  console.log(`${pkg.name}: ${result.status}`);
}

const keepers = (await loadMemory(ROOT)).keepers;
const inlined = keepers.find((k) => k.route === 'inline') ?? keepers[0];
const patrolled = await patrol(ROOT, { simulate: inlined ? { package: inlined.package } : undefined });
await save('patrol.json', { ...patrolled, drafts: patrolled.drafts.map((d) => ({ ...d, workspace: '', bodyPath: '', patchPath: '' })) });
await save('warden.json', patrolled.memory);
console.log(`patrol: ${patrolled.events.length} events, ${patrolled.drafts.length} drafts`);

// Leave the example clean for live runs.
await rm(path.join(ROOT, '.graveyard'), { recursive: true, force: true });

// Ship only the lookups the example needs, not everything in the local cache.
await rm(FIXTURE_CACHE_DIR, { recursive: true, force: true });
const wanted: Array<[string, string]> = [];
for (const p of report.packages) {
  wanted.push(['registry', p.name], ['osv-pkg', `${p.name}@${p.version}`]);
  for (const a of p.signals.advisories) wanted.push(['osv-vuln', a.id]);
  const repo = parseGitHubRepo(p.facts?.repositoryUrl);
  if (repo) wanted.push(['github', `${repo.owner}/${repo.repo}`.toLowerCase()]);
}
let copied = 0;
for (const [ns, key] of wanted) {
  const from = keyFile(CACHE_DIR, ns, key);
  if (!existsSync(from)) continue;
  const to = keyFile(FIXTURE_CACHE_DIR, ns, key);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
  copied++;
}
console.log(`offline cache: ${copied} entries`);
console.log(`demo snapshots → ${path.relative(TOOL_ROOT, OUT)}, offline cache → ${path.relative(TOOL_ROOT, FIXTURE_CACHE_DIR)}`);

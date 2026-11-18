import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isOffline, mapLimit } from './cache.ts';
import { repoStatus, type RepoStatus } from './github.ts';
import { scanUsage, type UsageIndex } from './imports.ts';
import { parseLockfile } from './lockfile.ts';
import { advisoriesFor } from './osv.ts';
import { factsFor, getPackageDoc, type PackageDoc } from './registry.ts';
import { DORMANT_DAYS, daysBetween, scorePackage } from './score.ts';
import type { Advisory, ScannedPackage, ScanReport, Signals } from './types.ts';

export interface ScanInput {
  lockfile: string;
  packageJson?: string;
  /** Project directory; when set, source files are scanned for import sites. */
  root?: string;
  now?: Date;
  onProgress?: (message: string) => void;
}

export async function scanProjectDir(root: string, opts: Omit<ScanInput, 'lockfile' | 'root'> = {}): Promise<ScanReport> {
  const lockfile = await readFile(path.join(root, 'package-lock.json'), 'utf8').catch(() => {
    throw new Error(`No package-lock.json in ${root}. Run "npm install" there first.`);
  });
  const packageJson = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => undefined);
  return scan({ ...opts, lockfile, packageJson, root });
}

export async function scan(input: ScanInput): Promise<ScanReport> {
  const now = input.now ?? new Date();
  const progress = input.onProgress ?? (() => {});
  const warnings: string[] = [];
  const parsed = parseLockfile(input.lockfile, input.packageJson);
  progress(`Read ${parsed.packages.length} locked packages`);

  let usage: UsageIndex | undefined;
  if (input.root) {
    usage = await scanUsage(input.root);
    progress(`Scanned ${usage.filesScanned} source files for imports`);
  }

  const names = [...new Set(parsed.packages.map((p) => p.name))];
  const docs = new Map<string, PackageDoc>();
  const docErrors = new Map<string, string>();
  await mapLimit(names, 8, async (name) => {
    try {
      docs.set(name, await getPackageDoc(name));
    } catch (err) {
      docErrors.set(name, (err as Error).message);
    }
  });
  progress(`Fetched registry data for ${docs.size} of ${names.length} packages`);
  if (docErrors.size) warnings.push(`Registry lookup failed for ${docErrors.size} package(s); their scores use partial data.`);

  let advisories = new Map<string, Advisory[]>();
  try {
    advisories = await advisoriesFor(parsed.packages.map((p) => ({ name: p.name, version: p.version })));
    progress('Checked the advisory database');
  } catch (err) {
    warnings.push(`Advisory lookup failed: ${(err as Error).message}`);
  }

  // GitHub allows 60 unauthenticated calls an hour, so only ask about packages
  // that are already suspicious or that the project chose directly.
  const repoByName = new Map<string, RepoStatus>();
  const repoCandidates = names.filter((name) => {
    const doc = docs.get(name);
    if (!doc) return false;
    const pkg = parsed.packages.find((p) => p.name === name)!;
    const facts = factsFor(doc, pkg.version);
    return pkg.direct || facts.deprecated || daysBetween(facts.lastPublish, now) >= 365;
  });
  await mapLimit(repoCandidates, 4, async (name) => {
    const doc = docs.get(name)!;
    repoByName.set(name, await repoStatus(doc.versions[doc.latest]?.repositoryUrl));
  });
  if ([...repoByName.values()].some((r) => r.state === 'unknown')) {
    warnings.push('Some repository checks were skipped (rate limit or non-GitHub host). Set GITHUB_TOKEN for a full check.');
  }

  const packages: ScannedPackage[] = parsed.packages.map((pkg) => {
    const doc = docs.get(pkg.name);
    const facts = doc ? factsFor(doc, pkg.version) : undefined;
    const perFile = usage?.byPackage.get(pkg.name);
    const importedBy = perFile ? [...perFile.keys()].sort() : [];
    const daysSinceLastPublish = facts ? daysBetween(facts.lastPublish, now) : 0;
    // A deprecated old version of a living package is a job for version bots,
    // not a zombie: only count deprecation when the package itself is dead.
    const packageDeprecated = Boolean(facts?.latestDeprecated) || (Boolean(facts?.deprecated) && daysSinceLastPublish >= DORMANT_DAYS);
    const signals: Signals = {
      deprecated: packageDeprecated,
      versionDeprecated: Boolean(facts?.deprecated) && !packageDeprecated,
      daysSinceLastPublish,
      repo: repoByName.get(pkg.name)?.state ?? 'unknown',
      advisories: advisories.get(`${pkg.name}@${pkg.version}`) ?? [],
      usageSites: perFile ? [...perFile.values()].reduce((a, b) => a + b, 0) : 0,
      usageFiles: importedBy.length,
      direct: pkg.direct,
      dependents: pkg.dependents.length,
    };
    return {
      ...pkg,
      facts,
      signals,
      score: scorePackage(signals),
      importedBy,
      error: docErrors.get(pkg.name),
    };
  });

  packages.sort((a, b) => Number(b.score.zombie) - Number(a.score.zombie) || b.score.risk - a.score.risk || a.name.localeCompare(b.name));

  const zombies = packages.filter((p) => p.score.zombie);
  return {
    project: parsed.name,
    scannedAt: now.toISOString(),
    lockfileVersion: parsed.lockfileVersion,
    totals: {
      packages: packages.length,
      direct: packages.filter((p) => p.direct).length,
      zombies: zombies.length,
      directZombies: zombies.filter((p) => p.direct).length,
      withAdvisories: packages.filter((p) => p.signals.advisories.length > 0).length,
    },
    packages,
    usageScanned: Boolean(usage),
    offline: isOffline(),
    warnings,
  };
}

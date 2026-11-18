import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as tar from 'tar';
import { CACHE_DIR, isOffline } from '../core/cache.ts';
import { getPackageDoc } from '../core/registry.ts';

const require = createRequire(import.meta.url);

export interface OriginalPackage {
  dir: string;
  entry: string;
  source: 'node_modules' | 'registry-tarball';
  tarball?: string;
  integrity?: string;
  license?: string;
  main: string;
  /** Executable names from the package's "bin" field. */
  bins: string[];
}

/** Checks a Subresource Integrity string (sha512-... or sha1-...) against bytes. */
export function verifyIntegrity(bytes: Buffer, integrity: string): boolean {
  return integrity.split(/\s+/).some((entry) => {
    const [algo, expected] = [entry.slice(0, entry.indexOf('-')), entry.slice(entry.indexOf('-') + 1)];
    if (!['sha512', 'sha384', 'sha256', 'sha1'].includes(algo)) return false;
    return createHash(algo).update(bytes).digest('base64') === expected;
  });
}

async function describe(given: string, source: OriginalPackage['source'], extra: Partial<OriginalPackage>): Promise<OriginalPackage> {
  // require.resolve returns real paths, so the directory must be real too or
  // the relative entry path breaks under symlinks (macOS /var, for example).
  const dir = realpathSync(given);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  const entry = require.resolve(dir);
  return {
    dir,
    entry,
    source,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type,
    main: path.relative(dir, entry).split(path.sep).join('/'),
    bins: typeof pkg.bin === 'string' ? [String(pkg.name).split('/').pop()!] : Object.keys(pkg.bin ?? {}),
    ...extra,
  };
}

/**
 * Finds the exact original code: the project's installed copy when its version
 * matches, otherwise the registry tarball, checked against the lockfile hash.
 */
export async function locateOriginal(
  root: string,
  name: string,
  version: string,
  lock: { integrity?: string; resolved?: string },
): Promise<OriginalPackage> {
  const installed = path.join(root, 'node_modules', name);
  if (existsSync(path.join(installed, 'package.json'))) {
    const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
    if (pkg.version === version) return describe(installed, 'node_modules', { integrity: lock.integrity, tarball: lock.resolved });
  }

  const tarballs = path.resolve(CACHE_DIR, 'tarballs');
  const dir = path.resolve(tarballs, `${name.replace('/', '+')}@${version}`);
  // Names and versions come from a lockfile; never let one point outside the cache.
  if (path.dirname(dir) !== tarballs) throw new Error(`Refusing unsafe package name or version: ${name}@${version}`);
  if (existsSync(path.join(dir, 'package.json'))) {
    return describe(dir, 'registry-tarball', { integrity: lock.integrity, tarball: lock.resolved });
  }
  if (isOffline()) throw new Error(`${name}@${version} is not installed and offline mode is on. Run npm install first.`);

  const doc = await getPackageDoc(name);
  const tarball = lock.resolved ?? doc.versions[version]?.tarball;
  const integrity = lock.integrity ?? doc.versions[version]?.integrity;
  if (!tarball) throw new Error(`No tarball URL for ${name}@${version}`);
  const res = await fetch(tarball, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${tarball}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!integrity) {
    throw new Error(`No integrity hash for ${name}@${version}; refusing to run code that cannot be verified.`);
  }
  if (!verifyIntegrity(bytes, integrity)) {
    throw new Error(`Integrity check failed for ${name}@${version}: the tarball does not match ${integrity.slice(0, 20)}…`);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const tgz = `${dir}.tgz`;
  await writeFile(tgz, bytes);
  await tar.x({ file: tgz, cwd: dir, strip: 1 });
  await rm(tgz, { force: true });
  return describe(dir, 'registry-tarball', { integrity, tarball });
}

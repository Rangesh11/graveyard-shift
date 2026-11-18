import type { LockedPackage } from './types.ts';

interface LockEntry {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface V1Entry {
  version: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  requires?: Record<string, string>;
  dependencies?: Record<string, V1Entry>;
}

export interface ParsedLockfile {
  name: string;
  lockfileVersion: number;
  packages: LockedPackage[];
  /** Entries with an invalid name or version, left out of the scan. */
  skipped: string[];
}

export class LockfileError extends Error {}

/** Package name from a lockfile path key like "node_modules/a/node_modules/@s/b". */
export function nameFromPath(key: string): string {
  const idx = key.lastIndexOf('node_modules/');
  return idx === -1 ? key : key.slice(idx + 'node_modules/'.length);
}

/** Node's resolution: look in each ancestor node_modules from the deepest up. */
export function resolveFrom(fromKey: string, dep: string, exists: (key: string) => boolean): string | undefined {
  let base = fromKey;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`;
    if (exists(candidate)) return candidate;
    if (!base) return undefined;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx === -1 ? '' : base.slice(0, idx);
  }
}

/** npm package names (legacy capitals allowed) and exact semver versions. */
export const NAME_RE = /^(?:@[a-zA-Z0-9][\w.~-]*\/)?[a-zA-Z0-9~][\w.~-]*$/;
export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** "npm:real-name@1.2.3", the version field of an aliased install in a v1 lockfile. */
function parseAliasVersion(v: string): { name: string; version: string } | undefined {
  const m = v.match(/^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/);
  return m ? { name: m[1], version: m[2] } : undefined;
}

function v1ToPackages(deps: Record<string, V1Entry>, prefix: string, out: Record<string, LockEntry>) {
  for (const [name, entry] of Object.entries(deps)) {
    const key = `${prefix}node_modules/${name}`;
    const alias = parseAliasVersion(entry.version ?? '');
    out[key] = {
      ...(alias ? { name: alias.name } : {}),
      version: alias ? alias.version : entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      dev: entry.dev,
      dependencies: entry.requires,
    };
    if (entry.dependencies) v1ToPackages(entry.dependencies, `${key}/`, out);
  }
}

/**
 * Parses an npm package-lock.json (lockfile versions 1, 2 and 3).
 * `packageJson` (optional) decides which packages are direct when the lockfile
 * root entry is missing, as in version 1 lockfiles.
 */
export function parseLockfile(lockText: string, packageJsonText?: string): ParsedLockfile {
  let lock: Record<string, unknown>;
  try {
    lock = JSON.parse(lockText);
  } catch (err) {
    throw new LockfileError(`The lockfile is not valid JSON: ${(err as Error).message}`);
  }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new LockfileError('The lockfile must be a JSON object.');
  }
  let pkgJson: LockEntry = {};
  if (packageJsonText) {
    try {
      pkgJson = JSON.parse(packageJsonText);
    } catch (err) {
      throw new LockfileError(`package.json is not valid JSON: ${(err as Error).message}`);
    }
  }

  const lockfileVersion = Number(lock.lockfileVersion ?? 1);
  let entries: Record<string, LockEntry>;
  if (lock.packages && typeof lock.packages === 'object') {
    entries = lock.packages as Record<string, LockEntry>;
  } else if (lock.dependencies && typeof lock.dependencies === 'object') {
    entries = {};
    v1ToPackages(lock.dependencies as Record<string, V1Entry>, '', entries);
  } else {
    throw new LockfileError('No "packages" or "dependencies" found. Is this an npm package-lock.json?');
  }

  const root: LockEntry = { ...(entries[''] ?? {}), ...pkgJson };
  const directProd = new Set(Object.keys({ ...root.dependencies, ...root.optionalDependencies, ...root.peerDependencies }));
  const directDev = new Set(Object.keys(root.devDependencies ?? {}));
  // npm workspaces: their own dependencies count as chosen by the project.
  for (const [key, e] of Object.entries(entries)) {
    if (key === '' || key.includes('node_modules/') || e.link) continue;
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies, ...e.peerDependencies })) directProd.add(dep);
    for (const dep of Object.keys(e.devDependencies ?? {})) directDev.add(dep);
  }

  const keys = Object.keys(entries).filter((k) => k.includes('node_modules/') && !entries[k].link);
  const keySet = new Set(keys);
  const byId = new Map<string, LockedPackage>();
  const idOfKey = new Map<string, string>();
  const skipped: string[] = [];

  for (const key of keys) {
    const e = entries[key];
    const installedAs = nameFromPath(key);
    const name = e.name ?? installedAs;
    const version = e.version ?? '0.0.0';
    // Names and versions end up in file paths and generated code: skip anything odd.
    if (!NAME_RE.test(name) || !NAME_RE.test(installedAs) || !VERSION_RE.test(version)) {
      skipped.push(key);
      continue;
    }
    const id = `${name}@${version}`;
    idOfKey.set(key, id);
    const topLevel = key === `node_modules/${installedAs}`;
    let pkg = byId.get(id);
    if (!pkg) {
      pkg = {
        name,
        version,
        paths: [],
        direct: false,
        dev: Boolean(e.dev),
        integrity: e.integrity,
        resolved: e.resolved,
        dependents: [],
        dependencies: Object.keys({ ...e.dependencies, ...e.optionalDependencies }),
        ...(installedAs !== name ? { alias: installedAs } : {}),
      };
      byId.set(id, pkg);
    } else if (!e.dev) {
      pkg.dev = false;
    }
    pkg.paths.push(key);
    // Direct-ness follows the name the project installed it under (an alias, if any).
    if (topLevel && (directProd.has(installedAs) || directDev.has(installedAs))) pkg.direct = true;
  }

  for (const key of keys) {
    const e = entries[key];
    const fromId = idOfKey.get(key);
    if (!fromId) continue;
    const fromName = byId.get(fromId)!.name;
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) {
      const target = resolveFrom(key, dep, (k) => keySet.has(k));
      const targetId = target && idOfKey.get(target);
      if (!targetId) continue;
      const pkg = byId.get(targetId)!;
      if (!pkg.dependents.includes(fromName)) pkg.dependents.push(fromName);
    }
  }

  return {
    name: String(root.name ?? lock.name ?? 'project'),
    lockfileVersion,
    skipped,
    packages: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
  };
}

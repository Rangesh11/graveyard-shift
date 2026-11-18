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

function v1ToPackages(deps: Record<string, V1Entry>, prefix: string, out: Record<string, LockEntry>) {
  for (const [name, entry] of Object.entries(deps)) {
    const key = `${prefix}node_modules/${name}`;
    out[key] = {
      version: entry.version,
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

  const keys = Object.keys(entries).filter((k) => k.includes('node_modules/') && !entries[k].link);
  const keySet = new Set(keys);
  const byId = new Map<string, LockedPackage>();
  const idOfKey = new Map<string, string>();

  for (const key of keys) {
    const e = entries[key];
    const name = e.name ?? nameFromPath(key);
    const version = e.version ?? '0.0.0';
    const id = `${name}@${version}`;
    idOfKey.set(key, id);
    const topLevel = key === `node_modules/${nameFromPath(key)}`;
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
      };
      byId.set(id, pkg);
    } else if (!e.dev) {
      pkg.dev = false;
    }
    pkg.paths.push(key);
    if (topLevel && (directProd.has(name) || directDev.has(name))) pkg.direct = true;
  }

  for (const key of keys) {
    const e = entries[key];
    const fromId = idOfKey.get(key)!;
    const fromName = byId.get(fromId)!.name;
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) {
      const target = resolveFrom(key, dep, (k) => keySet.has(k));
      if (!target) continue;
      const pkg = byId.get(idOfKey.get(target)!)!;
      if (!pkg.dependents.includes(fromName)) pkg.dependents.push(fromName);
    }
  }

  return {
    name: String(root.name ?? lock.name ?? 'project'),
    lockfileVersion,
    packages: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
  };
}

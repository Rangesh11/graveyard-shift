import { cached, fetchJson } from './cache.ts';
import type { RegistryFacts } from './types.ts';

const REGISTRY = process.env.GRAVEYARD_REGISTRY ?? 'https://registry.npmjs.org';
const TTL = 12 * 60 * 60 * 1000;

export interface VersionInfo {
  deprecated?: string;
  license?: string;
  repositoryUrl?: string;
  unpackedSize?: number;
  fileCount?: number;
  tarball?: string;
  integrity?: string;
  dependencies: string[];
  time?: string;
}

/** The trimmed registry document we keep in the cache. */
export interface PackageDoc {
  name: string;
  latest: string;
  modified?: string;
  maintainers: number;
  versions: Record<string, VersionInfo>;
}

interface RawVersion {
  deprecated?: string | boolean;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  repository?: string | { url?: string };
  dist?: { unpackedSize?: number; fileCount?: number; tarball?: string; integrity?: string; shasum?: string };
  dependencies?: Record<string, string>;
}

interface RawDoc {
  name: string;
  'dist-tags'?: { latest?: string };
  time?: Record<string, string>;
  maintainers?: unknown[];
  versions?: Record<string, RawVersion>;
}

function licenseOf(v: RawVersion): string | undefined {
  if (typeof v.license === 'string') return v.license;
  if (v.license && typeof v.license === 'object') return v.license.type;
  return v.licenses?.[0]?.type;
}

function repoOf(v: RawVersion): string | undefined {
  if (typeof v.repository === 'string') return v.repository;
  return v.repository?.url;
}

export function trimDoc(raw: RawDoc): PackageDoc {
  const versions: Record<string, VersionInfo> = {};
  for (const [ver, v] of Object.entries(raw.versions ?? {})) {
    versions[ver] = {
      deprecated: typeof v.deprecated === 'string' && v.deprecated ? v.deprecated : undefined,
      license: licenseOf(v),
      repositoryUrl: repoOf(v),
      unpackedSize: v.dist?.unpackedSize,
      fileCount: v.dist?.fileCount,
      tarball: v.dist?.tarball,
      integrity: v.dist?.integrity ?? (v.dist?.shasum ? `sha1-${Buffer.from(v.dist.shasum, 'hex').toString('base64')}` : undefined),
      dependencies: Object.keys(v.dependencies ?? {}),
      time: raw.time?.[ver],
    };
  }
  const latest = raw['dist-tags']?.latest ?? Object.keys(versions).at(-1) ?? '0.0.0';
  return {
    name: raw.name,
    latest,
    modified: raw.time?.modified,
    maintainers: Array.isArray(raw.maintainers) ? raw.maintainers.length : 0,
    versions,
  };
}

export function registryUrl(name: string): string {
  return `${REGISTRY}/${name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}`;
}

export async function getPackageDoc(name: string): Promise<PackageDoc> {
  return cached('registry', name, TTL, async () => trimDoc(await fetchJson<RawDoc>(registryUrl(name))));
}

export function factsFor(doc: PackageDoc, version: string): RegistryFacts {
  const installed = doc.versions[version];
  const latest = doc.versions[doc.latest];
  return {
    latest: doc.latest,
    deprecated: installed?.deprecated,
    latestDeprecated: latest?.deprecated,
    lastPublish: latest?.time ?? installed?.time ?? doc.modified ?? new Date(0).toISOString(),
    installedPublish: installed?.time,
    license: installed?.license ?? latest?.license,
    repositoryUrl: installed?.repositoryUrl ?? latest?.repositoryUrl,
    unpackedSize: installed?.unpackedSize,
    fileCount: installed?.fileCount,
    maintainers: doc.maintainers,
  };
}

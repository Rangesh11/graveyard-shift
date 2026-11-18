import { cached, fetchJson, isOffline, mapLimit, peek, store } from './cache.ts';
import type { Advisory, Severity } from './types.ts';

const OSV = process.env.GRAVEYARD_OSV ?? 'https://api.osv.dev';
const TTL = 6 * 60 * 60 * 1000;

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
  references?: Array<{ type: string; url: string }>;
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

function severityOf(v: OsvVuln): Severity {
  const s = v.database_specific?.severity?.toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'moderate' || s === 'low') return s;
  if (s === 'medium') return 'moderate';
  return 'unknown';
}

export function toAdvisory(v: OsvVuln, pkgName: string): Advisory {
  const fixed = v.affected
    ?.filter((a) => a.package?.name === pkgName)
    .flatMap((a) => a.ranges ?? [])
    .flatMap((r) => r.events ?? [])
    .map((e) => e.fixed)
    .find(Boolean);
  const ref = v.references?.find((r) => r.type === 'ADVISORY') ?? v.references?.[0];
  return {
    id: v.id,
    aliases: v.aliases ?? [],
    summary: v.summary ?? v.details?.slice(0, 160) ?? v.id,
    severity: severityOf(v),
    url: ref?.url ?? `https://osv.dev/vulnerability/${v.id}`,
    fixedIn: fixed,
  };
}

async function getVuln(id: string): Promise<OsvVuln> {
  return cached('osv-vuln', id, TTL * 4, () => fetchJson<OsvVuln>(`${OSV}/v1/vulns/${encodeURIComponent(id)}`));
}

/**
 * Known advisories for each name@version, via the OSV batch API. Results are
 * cached per package version, so later scans only ask about new versions.
 */
export async function advisoriesFor(pkgs: Array<{ name: string; version: string }>): Promise<Map<string, Advisory[]>> {
  const idsByKey = new Map<string, string[]>();
  const missing: Array<{ name: string; version: string }> = [];
  for (const p of pkgs) {
    const key = `${p.name}@${p.version}`;
    if (idsByKey.has(key)) continue;
    const hit = await peek<string[]>('osv-pkg', key, TTL);
    if (hit) idsByKey.set(key, hit);
    else missing.push(p);
  }

  if (missing.length && isOffline()) {
    throw new Error(`offline and no cached advisory data for ${missing.length} package version(s), e.g. ${missing[0].name}@${missing[0].version}`);
  }
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const res = await fetchJson<{ results: Array<{ vulns?: Array<{ id: string }> }> }>(`${OSV}/v1/querybatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }),
    });
    for (const [j, p] of chunk.entries()) {
      const ids = (res.results[j]?.vulns ?? []).map((v) => v.id);
      idsByKey.set(`${p.name}@${p.version}`, ids);
      await store('osv-pkg', `${p.name}@${p.version}`, ids);
    }
  }

  const out = new Map<string, Advisory[]>();
  await mapLimit([...idsByKey.entries()], 6, async ([key, ids]) => {
    const name = key.slice(0, key.lastIndexOf('@'));
    const vulns = await Promise.all(ids.map((id) => getVuln(id)));
    out.set(key, vulns.map((v) => toAdvisory(v, name)));
  });
  return out;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'moderate', 'low', 'unknown'];

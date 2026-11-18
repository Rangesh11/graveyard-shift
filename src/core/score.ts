import type { Score, Severity, Signals, Status } from './types.ts';

/** Two years without a release: the line the dormancy research uses. */
export const DORMANT_DAYS = 730;

const SEVERITY_POINTS: Record<Severity, number> = {
  critical: 35,
  high: 28,
  moderate: 18,
  low: 8,
  unknown: 12,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 0..1. Deprecated is fully dead; otherwise time since the last release, nudged by the repo state. */
export function deadness(s: Pick<Signals, 'deprecated' | 'daysSinceLastPublish' | 'repo'>): number {
  if (s.deprecated) return 1;
  const days = Math.max(0, s.daysSinceLastPublish);
  let d: number;
  if (days < 365) d = (days / 365) * 0.2;
  else if (days < DORMANT_DAYS) d = 0.2 + ((days - 365) / 365) * 0.4;
  else d = 0.6 + Math.min(0.3, ((days - DORMANT_DAYS) / (365 * 5)) * 0.3);
  if (s.repo === 'archived') d = Math.max(d, 0.9);
  if (s.repo === 'missing') d = Math.min(1, d + 0.1);
  return clamp(round1(d * 100) / 100, 0, 1);
}

export function statusOf(s: Pick<Signals, 'deprecated' | 'daysSinceLastPublish' | 'repo'>): Status {
  if (s.deprecated) return 'deprecated';
  if (s.repo === 'archived') return 'archived';
  if (s.daysSinceLastPublish >= DORMANT_DAYS) return 'dormant';
  return 'alive';
}

/**
 * Risk 0..100: how dead (up to 40), the worst known advisory plus a little per
 * extra one (up to 35), how much code touches it (up to 15), and whether the
 * project chose it directly (10).
 */
export function scorePackage(s: Signals): Score {
  const dead = deadness(s);
  const status = statusOf(s);
  const zombie = status !== 'alive';
  const reasons: string[] = [];

  if (s.deprecated) reasons.push('Deprecated by its author');
  if (s.versionDeprecated && !s.deprecated) reasons.push('Installed version is deprecated; a maintained release exists, so upgrade it');
  if (s.repo === 'archived') reasons.push('Source repository is archived');
  if (s.repo === 'missing') reasons.push('Source repository no longer exists');
  if (s.daysSinceLastPublish >= 365) {
    reasons.push(`No release for ${(s.daysSinceLastPublish / 365).toFixed(1)} years`);
  }

  let flaw = 0;
  if (s.advisories.length) {
    const worst = Math.max(...s.advisories.map((a) => SEVERITY_POINTS[a.severity]));
    flaw = Math.min(35, worst + (s.advisories.length - 1) * 3);
    reasons.push(`${s.advisories.length} known advisor${s.advisories.length === 1 ? 'y' : 'ies'}`);
  }

  // Import sites in the project plus packages that depend on it: both add exposure.
  const exposureBase = s.usageSites + s.dependents;
  const exposure = Math.min(15, Math.log2(1 + exposureBase) * 5);
  if (s.usageSites > 0) reasons.push(`Imported at ${s.usageSites} site${s.usageSites === 1 ? '' : 's'} in ${s.usageFiles} file${s.usageFiles === 1 ? '' : 's'}`);

  const direct = s.direct ? 10 : 0;
  const outdated = s.versionDeprecated && !s.deprecated ? 8 : 0;
  // A living package with a flaw still matters, but less than a dead one: someone will ship the fix.
  const flawWeight = zombie ? 1 : 0.5;
  const risk = clamp(Math.round(dead * 40 + flaw * flawWeight + exposure + direct + outdated), 0, 100);

  return { status, deadness: dead, risk, zombie, reasons };
}

export function daysBetween(fromIso: string, to: Date = new Date()): number {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((to.getTime() - t) / 86_400_000));
}

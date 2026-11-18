import type { Route, ScannedPackage, Severity, Status } from './types';

export function year(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getUTCFullYear());
}

export function shortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ago(days: number): string {
  if (!Number.isFinite(days) || days < 0) return 'unknown';
  if (days < 1) return 'today';
  if (days < 60) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  const years = days / 365.25;
  return `${years.toFixed(years < 10 ? 1 : 0)} years ago`;
}

export function seconds(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

export type RiskBand = 'high' | 'medium' | 'low';

export function riskBand(risk: number): RiskBand {
  if (risk >= 70) return 'high';
  if (risk >= 40) return 'medium';
  return 'low';
}

export const STATUS_LABEL: Record<Status, string> = {
  alive: 'Alive',
  dormant: 'Dormant',
  deprecated: 'Deprecated',
  archived: 'Archived',
};

export const ROUTE_LABEL: Record<Route, string> = {
  inline: 'Inline',
  replace: 'Replace',
  adopt: 'Adopt',
};

export const ROUTE_HINT: Record<Route, string> = {
  inline: 'Copy a tested version of the tiny package into the repo and drop the dependency.',
  replace: 'Switch to a maintained package or a built-in, and rewrite the call sites.',
  adopt: 'No safe alternative: fork it, patch known flaws, and keep the fork.',
};

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'moderate', 'low', 'unknown'];

export function worstSeverity(pkg: ScannedPackage): Severity | null {
  const list = pkg.signals.advisories;
  if (!list.length) return null;
  return [...list].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))[0].severity;
}

export function lastSeen(pkg: ScannedPackage): string {
  return year(pkg.facts?.lastPublish ?? pkg.facts?.installedPublish);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Packages can appear in several versions, so selection uses name@version. */
export const pkgKey = (p: { name: string; version: string }) => `${p.name}@${p.version}`;

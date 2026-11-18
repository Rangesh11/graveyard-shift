import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DORMANT_DAYS, deadness, scorePackage, statusOf } from '../src/core/score.ts';
import type { Advisory, Signals } from '../src/core/types.ts';

const advisory = fc.record<Advisory>({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  aliases: fc.constant([]),
  summary: fc.constant('x'),
  severity: fc.constantFrom('critical', 'high', 'moderate', 'low', 'unknown'),
});

const signals = fc.record<Signals>({
  deprecated: fc.boolean(),
  versionDeprecated: fc.boolean(),
  daysSinceLastPublish: fc.integer({ min: 0, max: 8000 }),
  repo: fc.constantFrom('active', 'archived', 'missing', 'unknown'),
  advisories: fc.array(advisory, { maxLength: 4 }),
  usageSites: fc.integer({ min: 0, max: 500 }),
  usageFiles: fc.integer({ min: 0, max: 100 }),
  direct: fc.boolean(),
  dependents: fc.integer({ min: 0, max: 200 }),
});

describe('zombie score (property-based)', () => {
  it('risk is always an integer from 0 to 100 and deadness is within 0..1', () => {
    fc.assert(
      fc.property(signals, (s) => {
        const score = scorePackage(s);
        expect(Number.isInteger(score.risk)).toBe(true);
        expect(score.risk).toBeGreaterThanOrEqual(0);
        expect(score.risk).toBeLessThanOrEqual(100);
        expect(score.deadness).toBeGreaterThanOrEqual(0);
        expect(score.deadness).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('a newly found advisory never lowers the risk', () => {
    fc.assert(
      fc.property(signals, advisory, (s, extra) => {
        const before = scorePackage(s).risk;
        const after = scorePackage({ ...s, advisories: [...s.advisories, extra] }).risk;
        expect(after).toBeGreaterThanOrEqual(before);
      }),
    );
  });

  it('more time without a release never lowers deadness or risk', () => {
    fc.assert(
      fc.property(signals, fc.integer({ min: 0, max: 3000 }), (s, more) => {
        const later = { ...s, daysSinceLastPublish: s.daysSinceLastPublish + more };
        expect(deadness(later)).toBeGreaterThanOrEqual(deadness(s));
        expect(scorePackage(later).risk).toBeGreaterThanOrEqual(scorePackage(s).risk);
      }),
    );
  });

  it('more import sites never lower the risk', () => {
    fc.assert(
      fc.property(signals, fc.integer({ min: 1, max: 300 }), (s, more) => {
        expect(scorePackage({ ...s, usageSites: s.usageSites + more, usageFiles: Math.max(1, s.usageFiles) }).risk).toBeGreaterThanOrEqual(
          scorePackage({ ...s, usageFiles: Math.max(1, s.usageFiles) }).risk,
        );
      }),
    );
  });

  it('deprecated and archived packages are always zombies; recent active ones never are', () => {
    fc.assert(
      fc.property(signals, (s) => {
        if (s.deprecated || s.repo === 'archived') expect(scorePackage(s).zombie).toBe(true);
        if (!s.deprecated && s.repo !== 'archived' && s.daysSinceLastPublish < DORMANT_DAYS) expect(statusOf(s)).toBe('alive');
      }),
    );
  });

  it('a deprecated old version of a living package is an upgrade, never a zombie', () => {
    fc.assert(
      fc.property(signals, (s) => {
        const living = { ...s, deprecated: false, versionDeprecated: true, repo: 'active' as const, daysSinceLastPublish: s.daysSinceLastPublish % DORMANT_DAYS };
        const score = scorePackage(living);
        expect(score.zombie).toBe(false);
        expect(score.reasons.some((r) => r.includes('upgrade'))).toBe(true);
      }),
    );
  });

  it('every non-zero contribution is explained by a reason', () => {
    fc.assert(
      fc.property(signals, (s) => {
        const score = scorePackage(s);
        if (s.deprecated) expect(score.reasons).toContain('Deprecated by its author');
        if (s.advisories.length) expect(score.reasons.some((r) => r.includes('known advisor'))).toBe(true);
      }),
    );
  });
});

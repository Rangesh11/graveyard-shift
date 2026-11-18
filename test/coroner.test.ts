import { describe, expect, it } from 'vitest';
import { scorePackage } from '../src/core/score.ts';
import type { ScannedPackage, Signals } from '../src/core/types.ts';
import { diagnose, licenseAllowsCopy } from '../src/resurrect/coroner.ts';

function pkg(name: string, over: Partial<ScannedPackage> = {}, sig: Partial<Signals> = {}): ScannedPackage {
  const signals: Signals = { deprecated: false, daysSinceLastPublish: 3000, repo: 'active', advisories: [], usageSites: 1, usageFiles: 1, direct: true, dependents: 0, ...sig };
  return {
    name, version: '1.0.0', paths: [`node_modules/${name}`], direct: signals.direct, dev: false, dependents: [], dependencies: [],
    facts: { latest: '1.0.0', lastPublish: '2016-01-01', license: 'MIT', unpackedSize: 4000, maintainers: 1 },
    signals, score: scorePackage(signals), importedBy: ['src/a.js'], ...over,
  };
}

describe('Coroner', () => {
  it('prefers a proven replacement recipe', () => {
    const d = diagnose(pkg('left-pad', { version: '1.3.0' }), []);
    expect(d).toMatchObject({ route: 'replace', automated: true, recipe: 'left-pad-native' });
  });

  it('inlines a small, dependency-free, permissively licensed package without a recipe', () => {
    expect(diagnose(pkg('tiny-thing'), [])).toMatchObject({ route: 'inline', automated: true, licenseOk: true });
  });

  it('never inlines code whose licence does not allow copying', () => {
    const d = diagnose(pkg('gpl-thing', { facts: { latest: '1.0.0', lastPublish: '2016-01-01', license: 'GPL-3.0', unpackedSize: 4000, maintainers: 1 } }), []);
    expect(d.route).toBe('adopt');
    expect(d.automated).toBe(false);
  });

  it('sends broad APIs like request to a human with the modern replacement', () => {
    const d = diagnose(pkg('request', { dependencies: ['a', 'b'] }), []);
    expect(d).toMatchObject({ route: 'replace', automated: false });
    expect(d.replacement).toMatch(/fetch/);
  });

  it('points a transitive zombie at the direct dependency that pulls it in', () => {
    const parent = pkg('request', { dependents: [] });
    const middle = pkg('har-validator', { direct: false, dependents: ['request'] }, { direct: false });
    const leaf = pkg('ajv-old', { direct: false, dependents: ['har-validator'] }, { direct: false });
    const d = diagnose(leaf, [parent, middle, leaf]);
    expect(d.viaParent).toBe('request');
    expect(d.automated).toBe(false);
  });

  it('reads SPDX OR expressions', () => {
    expect(licenseAllowsCopy('(MIT OR GPL-3.0)')).toBe(true);
    expect(licenseAllowsCopy('GPL-3.0')).toBe(false);
    expect(licenseAllowsCopy(undefined)).toBe(false);
  });
});

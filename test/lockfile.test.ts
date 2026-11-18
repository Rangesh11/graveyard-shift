import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LockfileError, nameFromPath, parseLockfile, resolveFrom } from '../src/core/lockfile.ts';

const example = readFileSync(new URL('../examples/haunted-app/package-lock.json', import.meta.url), 'utf8');

describe('lockfile parser', () => {
  it('reads the example lockfile (v3) with direct and transitive packages', () => {
    const parsed = parseLockfile(example);
    expect(parsed.lockfileVersion).toBe(3);
    expect(parsed.name).toBe('haunted-app');
    const leftPad = parsed.packages.find((p) => p.name === 'left-pad')!;
    expect(leftPad).toMatchObject({ version: '1.3.0', direct: true });
    expect(leftPad.integrity).toMatch(/^sha512-/);
    const uuid = parsed.packages.find((p) => p.name === 'uuid')!;
    expect(uuid.direct).toBe(false);
    expect(uuid.dependents).toContain('request');
  });

  it('reads a version 1 lockfile with nested dependencies', () => {
    const v1 = {
      name: 'old',
      lockfileVersion: 1,
      dependencies: {
        a: { version: '1.0.0', requires: { b: '^2.0.0' }, dependencies: { b: { version: '2.0.0' } } },
        b: { version: '1.0.0' },
      },
    };
    const parsed = parseLockfile(JSON.stringify(v1), JSON.stringify({ dependencies: { a: '1', b: '1' } }));
    expect(parsed.packages.map((p) => `${p.name}@${p.version}`)).toEqual(['a@1.0.0', 'b@1.0.0', 'b@2.0.0']);
    expect(parsed.packages.find((p) => p.version === '2.0.0')!.dependents).toEqual(['a']);
    expect(parsed.packages.find((p) => p.version === '2.0.0')!.direct).toBe(false);
  });

  it('gives a clear error for input that is not a lockfile', () => {
    expect(() => parseLockfile('{oops')).toThrow(LockfileError);
    expect(() => parseLockfile('[]')).toThrow(LockfileError);
    expect(() => parseLockfile('{"name":"x"}')).toThrow(/package-lock/);
  });

  const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
  const pkgName = fc.oneof(segment, fc.tuple(segment, segment).map(([s, n]) => `@${s}/${n}`));

  it('takes the package name from any nesting depth (property)', () => {
    fc.assert(
      fc.property(fc.array(pkgName, { maxLength: 4 }), pkgName, (parents, name) => {
        const key = [...parents, name].map((n) => `node_modules/${n}`).join('/');
        expect(nameFromPath(key)).toBe(name);
      }),
    );
  });

  it('resolves like Node: the nearest node_modules wins (property)', () => {
    fc.assert(
      fc.property(fc.array(pkgName, { minLength: 1, maxLength: 4 }), pkgName, fc.integer({ min: 0, max: 4 }), (chain, dep, at) => {
        const from = chain.map((n) => `node_modules/${n}`).join('/');
        const level = Math.min(at, chain.length);
        const base = chain.slice(0, level).map((n) => `node_modules/${n}`).join('/');
        const installed = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`;
        const keys = new Set([installed, `node_modules/${dep}`]);
        expect(resolveFrom(from, dep, (k) => keys.has(k))).toBe(installed);
      }),
    );
  });

  it('never loses or invents packages: every lockfile entry maps to exactly one result (property)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(pkgName, { minLength: 1, maxLength: 12 }), fc.array(fc.nat(3), { minLength: 12, maxLength: 12 }), (names, versions) => {
        const packages: Record<string, unknown> = { '': { name: 'root', dependencies: Object.fromEntries(names.map((n) => [n, '*'])) } };
        names.forEach((n, i) => (packages[`node_modules/${n}`] = { version: `${versions[i]}.0.0` }));
        const parsed = parseLockfile(JSON.stringify({ lockfileVersion: 3, packages }));
        expect(parsed.packages.length).toBe(names.length);
        expect(parsed.packages.every((p) => p.direct)).toBe(true);
      }),
    );
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findSpecifiers, packageNameOf } from '../src/core/imports.ts';

describe('import finder', () => {
  it('finds require, import, dynamic import and re-export specifiers', () => {
    const code = [
      `const a = require('left-pad');`,
      `import b from "trim";`,
      `import { c } from '@scope/pkg/sub';`,
      `import 'side-effect';`,
      `export * from 'reexported';`,
      `const d = await import('dyn');`,
      `const e = require("./local");`,
    ].join('\n');
    expect(findSpecifiers(code).map((h) => h.spec)).toEqual(['left-pad', 'trim', '@scope/pkg/sub', 'side-effect', 'reexported', 'dyn', './local']);
  });

  it('maps specifiers to package names and skips builtins and relative paths', () => {
    expect(packageNameOf('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageNameOf('lodash/fp')).toBe('lodash');
    expect(packageNameOf('fs')).toBeUndefined();
    expect(packageNameOf('node:path')).toBeUndefined();
    expect(packageNameOf('./x')).toBeUndefined();
  });

  it('reports offsets that point exactly at the specifier text (property)', () => {
    const spec = fc.stringMatching(/^[a-z@][a-z0-9./_-]{0,20}$/);
    const form = fc.constantFrom(
      (s: string) => `require('${s}')`,
      (s: string) => `import x from "${s}"`,
      (s: string) => `import('${s}')`,
      (s: string) => `export { y } from '${s}'`,
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(spec, form), { minLength: 1, maxLength: 6 }), (items) => {
        const code = items.map(([s, f]) => `${f(s)};`).join('\n// filler\n');
        const hits = findSpecifiers(code);
        expect(hits.map((h) => h.spec)).toEqual(items.map(([s]) => s));
        for (const h of hits) expect(code.slice(h.start, h.end)).toBe(h.spec);
      }),
    );
  });
});

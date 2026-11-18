import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { encode, decode } = require('../src/resurrect/codec.cjs');

describe('golden-case codec', () => {
  it('round-trips any generated value through JSON losslessly', () => {
    const value = fc.anything({ maxDepth: 3, withSparseArray: true, withNullPrototype: true, withBigInt: true });
    fc.assert(
      fc.property(value, (v) => {
        const back = decode(JSON.parse(JSON.stringify(encode(v))));
        expect(isDeepStrictEqual(back, v)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('keeps an own "__proto__" key as data instead of changing the prototype', () => {
    const v = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
    const back = decode(JSON.parse(JSON.stringify(encode(v))));
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(isDeepStrictEqual(back, v)).toBe(true);
  });

  it('refuses values it cannot store faithfully', () => {
    expect(() => encode(new Date())).toThrow(TypeError);
    expect(() => encode(() => 1)).toThrow(TypeError);
  });
});

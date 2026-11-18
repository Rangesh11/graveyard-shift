// Replacement recipes. Each recipe lists candidate shims in order, simplest
// first. The prover runs every candidate against the original package on
// generated inputs; the first candidate that agrees on all of them wins. A
// rejected candidate is kept in the pull request as evidence.
//
// `args` and `call` are JavaScript source evaluated inside the sandboxed proof
// runner with fast-check in scope as `fc`, so they must be self-contained.

export interface Candidate {
  id: string;
  description: string;
  /** CommonJS module source that exports the same API as the old package. */
  shim: string;
}

export interface PropertySpec {
  name: string;
  /** Source of a fast-check arbitrary producing the argument tuple (an array). */
  args: string;
  /** Source of `(m, args) => result`, where m is the loaded module. Defaults to calling m(...args). */
  call?: string;
  kind?: 'equivalence' | 'perf';
  /** For perf properties: source of the single input, and the time limit for the new code. */
  input?: string;
  maxMs?: number;
}

export interface Recipe {
  id: string;
  package: string;
  /** Major versions this recipe has been proven against. */
  majors: number[];
  replacement: string;
  summary: string;
  candidates: Candidate[];
  properties: PropertySpec[];
}

const header = (pkg: string, why: string) =>
  `'use strict';\n// Graveyard Shift replacement for the abandoned "${pkg}" package.\n// ${why}\n// Behaviour proven equal to the original with property-based tests; see graveyard/proofs/.\n`;

export const RECIPES: Recipe[] = [
  {
    id: 'left-pad-native',
    package: 'left-pad',
    majors: [0, 1],
    replacement: 'String.prototype.repeat',
    summary: 'Pad with built-in string methods instead of the deprecated left-pad.',
    candidates: [
      {
        id: 'padStart',
        description: 'String.prototype.padStart, as the deprecation notice suggests',
        shim:
          header('left-pad', 'Uses String.prototype.padStart.') +
          `module.exports = function leftPad(str, len, ch) {
  return String(str).padStart(len, ch === undefined || ch === null ? ' ' : String(ch));
};
`,
      },
      {
        id: 'repeat-exact',
        description: 'String.prototype.repeat, repeating the pad string once per missing character like the original',
        shim:
          header('left-pad', 'padStart truncates multi-character pads and pads with "false"/"null" text; the original repeats the pad and treats falsy pads as a space, so this does too.') +
          `module.exports = function leftPad(str, len, ch) {
  str = String(str);
  const missing = len - str.length;
  if (!(missing > 0)) return str;
  if (!ch && ch !== 0) ch = ' ';
  return String(ch).repeat(missing) + str;
};
`,
      },
    ],
    properties: [
      {
        name: 'pads like left-pad for any string, length and pad character',
        args: `fc.tuple(
          fc.oneof(fc.string({ maxLength: 8 }), fc.integer({ min: -999, max: 99999 })),
          fc.oneof(fc.integer({ min: -3, max: 24 }), fc.constant(undefined)),
          fc.oneof(fc.constant(undefined), fc.constant(null), fc.constant(''), fc.constant(0), fc.constant(false),
                   fc.integer({ min: 0, max: 9 }), fc.string({ minLength: 1, maxLength: 3 })))`,
      },
    ],
  },
  {
    id: 'trim-native',
    package: 'trim',
    majors: [0, 1],
    replacement: 'String.prototype.trim / trimStart / trimEnd',
    summary: 'Replace trim (ReDoS advisory CVE-2020-7753 in 0.0.1) with the built-in string methods.',
    candidates: [
      {
        id: 'native-trim',
        description: 'String.prototype.trim, trimStart and trimEnd',
        shim:
          header('trim', 'Built-in trimming runs in linear time, which removes the ReDoS in trim < 0.0.3.') +
          `function trim(str) {
  return str.trim();
}
module.exports = trim;
module.exports.left = function left(str) {
  return str.trimStart();
};
module.exports.right = function right(str) {
  return str.trimEnd();
};
`,
      },
    ],
    properties: [
      {
        name: 'trim() strips the same whitespace',
        args: `fc.tuple(fc.string({ maxLength: 24, unit: fc.constantFrom(' ', '\\t', '\\n', '\\r', '\\v', '\\f', '\\u00a0', '\\u1680', '\\u2000', '\\u2028', '\\u2029', '\\u3000', '\\ufeff', '\\u180e', '\\u200b', 'a', 'Z', '-') }))`,
      },
      {
        name: 'trim.left() matches',
        args: `fc.tuple(fc.string({ maxLength: 24, unit: fc.constantFrom(' ', '\\t', '\\n', '\\u00a0', '\\ufeff', '\\u2028', 'a', '-') }))`,
        call: `(m, args) => m.left(...args)`,
      },
      {
        name: 'trim.right() matches',
        args: `fc.tuple(fc.string({ maxLength: 24, unit: fc.constantFrom(' ', '\\t', '\\n', '\\u00a0', '\\ufeff', '\\u2028', 'a', '-') }))`,
        call: `(m, args) => m.right(...args)`,
      },
      {
        name: 'non-string input fails the same way',
        args: `fc.tuple(fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.array(fc.integer(), { maxLength: 2 })))`,
      },
      {
        name: 'no ReDoS: 20,000 spaces either side of a word',
        kind: 'perf',
        args: 'fc.constant([])',
        input: `' '.repeat(20000) + 'x' + ' '.repeat(20000) + 'y'`,
        maxMs: 25,
      },
    ],
  },
  {
    id: 'object-assign-native',
    package: 'object-assign',
    majors: [4],
    replacement: 'Object.assign',
    summary: 'object-assign is a ponyfill for Object.assign, which every supported Node.js version has.',
    candidates: [
      {
        id: 'object-assign',
        description: 'Object.assign',
        shim: header('object-assign', 'Object.assign is built in since Node.js 4.') + `module.exports = Object.assign;\n`,
      },
    ],
    properties: [
      {
        name: 'merges sources into the target like object-assign',
        args: `fc.tuple(fc.object({ maxDepth: 2 }), fc.array(fc.oneof(fc.object({ maxDepth: 2 }), fc.constant(null), fc.constant(undefined), fc.string({ maxLength: 3 })), { maxLength: 3 }))`,
        call: `(m, [target, sources]) => m(target, ...sources)`,
      },
      {
        name: 'rejects a null or undefined target the same way',
        args: `fc.tuple(fc.constantFrom(null, undefined), fc.object({ maxDepth: 1 }))`,
      },
    ],
  },
  {
    id: 'xtend-native',
    package: 'xtend',
    majors: [4],
    replacement: 'Object.assign({}, ...sources)',
    summary: 'xtend copies own enumerable keys into a new object; Object.assign does the same.',
    candidates: [
      {
        id: 'assign-into-new',
        description: 'Object.assign into a fresh object',
        shim:
          header('xtend', 'Object.assign into a new object; symbol keys are also copied, which xtend skipped.') +
          `module.exports = function extend(...sources) {
  return Object.assign({}, ...sources);
};
`,
      },
    ],
    properties: [
      {
        name: 'returns the same merged object for any sources',
        args: `fc.array(fc.oneof(fc.object({ maxDepth: 2 }), fc.constant(null), fc.constant(undefined), fc.string({ maxLength: 3 }), fc.array(fc.integer(), { maxLength: 3 })), { maxLength: 4 })`,
      },
    ],
  },
  {
    id: 'arr-flatten-native',
    package: 'arr-flatten',
    majors: [1],
    replacement: 'Array.prototype.flat (or a small loop)',
    summary: 'Flatten nested arrays without the unmaintained arr-flatten.',
    candidates: [
      {
        id: 'flat-infinity',
        description: 'Array.prototype.flat(Infinity)',
        shim: header('arr-flatten', 'Uses Array.prototype.flat.') + `module.exports = function flatten(arr) {\n  return arr.flat(Infinity);\n};\n`,
      },
      {
        id: 'loop-keep-holes',
        description: 'A modern loop that keeps holes as undefined, like the original',
        shim:
          header('arr-flatten', 'Array.prototype.flat drops holes in sparse arrays; the original turns them into undefined, so this loop does too.') +
          `module.exports = function flatten(arr) {
  const out = [];
  const walk = (list) => {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (Array.isArray(item)) walk(item);
      else out.push(item);
    }
  };
  walk(arr);
  return out;
};
`,
      },
    ],
    properties: [
      {
        name: 'flattens nested and sparse arrays the same way',
        args: `(() => {
          const t = fc.letrec((tie) => ({
            node: fc.oneof({ depthSize: 'small' }, tie('leaf'), tie('dense'), tie('sparse')),
            leaf: fc.oneof(fc.integer(), fc.string({ maxLength: 2 }), fc.constant(null), fc.constant(undefined)),
            dense: fc.array(tie('node'), { maxLength: 4 }),
            sparse: fc.sparseArray(tie('node'), { maxLength: 4 }),
          }));
          return fc.tuple(fc.oneof(t.dense, t.sparse));
        })()`,
      },
    ],
  },
  {
    id: 'repeat-string-native',
    package: 'repeat-string',
    majors: [1],
    replacement: 'String.prototype.repeat',
    summary: 'Repeat strings with the built-in method instead of the unmaintained repeat-string.',
    candidates: [
      {
        id: 'repeat',
        description: 'String.prototype.repeat',
        shim: header('repeat-string', 'Uses String.prototype.repeat.') + `module.exports = function repeat(str, num) {\n  return str.repeat(num);\n};\n`,
      },
      {
        id: 'repeat-guarded',
        description: 'String.prototype.repeat with the original type check and empty result for counts below 1',
        shim:
          header('repeat-string', 'String.prototype.repeat throws on negative counts; the original returns "", so this guards it.') +
          `module.exports = function repeat(str, num) {
  if (typeof str !== 'string') throw new TypeError('expected a string');
  return num > 0 ? str.repeat(num) : '';
};
`,
      },
    ],
    properties: [
      {
        name: 'repeats like repeat-string for any count',
        args: `fc.tuple(fc.oneof(fc.string({ maxLength: 4 }), fc.integer(), fc.constant(null)), fc.integer({ min: -4, max: 40 }))`,
      },
    ],
  },
];

/** Packages with a known modern replacement that needs a human to migrate. */
export const MANUAL_REPLACEMENTS: Record<string, string> = {
  request: 'the built-in fetch API (Node.js 18+) or undici',
  'request-promise': 'the built-in fetch API',
  'request-promise-native': 'the built-in fetch API',
  uuid: 'crypto.randomUUID() for v4 ids, or uuid 9+',
  'har-validator': 'nothing: it is only used by request; removing request removes it',
  querystring: 'URLSearchParams',
  mkdirp: 'fs.mkdir(path, { recursive: true })',
  rimraf: 'fs.rm(path, { recursive: true, force: true })',
  moment: 'Temporal, date-fns or dayjs',
  'node-uuid': 'crypto.randomUUID()',
  colors: 'node:util styleText or picocolors',
};

export function findRecipe(name: string, version: string): Recipe | undefined {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return RECIPES.find((r) => r.package === name && r.majors.includes(major));
}

/** Generic equivalence properties for an inlined copy, where no recipe knows the API. */
export function inlineProperties(): PropertySpec[] {
  return [
    {
      name: 'every exported function agrees on arbitrary values',
      args: `fc.array(fc.anything({ maxDepth: 2 }), { maxLength: 3 })`,
      call: '__each_export__',
    },
    {
      name: 'every exported function agrees on numbers and numeric strings',
      args: `fc.tuple(fc.oneof(fc.double(), fc.integer(), fc.double().map(String), fc.integer().map(String), fc.constantFrom('', ' ', '0x1f', '1e3', '  7  ', 'Infinity', 'NaN', '-0')))`,
      call: '__each_export__',
    },
  ];
}

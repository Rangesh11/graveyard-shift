# Design: Proof engine

## Components

| File | Role |
| --- | --- |
| `src/resurrect/prover.ts` | `prove(opts)`: writes a config, spawns the sandboxed runner, parses its JSON |
| `src/resurrect/proof-runner.mjs` | Plain ESM run by `node --permission`; loads both modules, runs fast-check, records golden cases |
| `src/resurrect/codec.cjs` | `encode` / `decode` for lossless JSON; required by the runner, inlined into replay tests |
| `src/resurrect/recipes.ts` | `PropertySpec` sources (`args`, `call`, `kind`, `input`, `maxMs`); `inlineProperties()` for vendored copies |
| `src/resurrect/surgeon.ts` | `writeProofTest`: golden JSON + `node:test` file |

The runner is plain JavaScript on purpose: no tsx loader inside the sandbox, fewer paths to allow.

## Data flow

```
prove({oldPath, newPath, properties, candidate, numRuns, seed, golden})
  realpath everything ─▶ tmp/config.json
  spawn node --permission --allow-fs-read=<5 real paths> proof-runner.mjs config.json   (env: {})
     for each property:
       perf?  time old/new on evaluate(input)
       else   fc.check(fc.property(arb, args => same(run(old), run(new))), {numRuns, seed})
              failed → counterexample {args, oldResult, newResult} via fc.stringify
              passed → fc.sample(arb, {numRuns: golden, seed}) → encode(args), encode(old outcome)
     stdout: {properties: PropertyResult[], golden: GoldenGroup[]}
  ◀─ ProofResult {passed, candidate, properties, totalRuns, goldenCases, durationMs, sandboxed}
```

`args` and `call` are JavaScript source strings evaluated with `new Function('fc', …)`. They come only from `recipes.ts` in this repository, never from user input or package data.

## Why real paths

Node's CommonJS loader calls `realpathSync`, which stats every path component. On macOS `tmpdir()` is under `/var`, a symlink to `/private/var`, so a sandbox that only allowed `/var/folders/...` was denied reading `/var` itself. `prove` resolves every path first; it never widens the allowlist. See `bugfix-symlinked-tmpdir`.

## Codec

Tagged JSON: `{$undef}`, `{$num: "NaN" | "Infinity" | "-Infinity" | "-0"}`, `{$big}`, `{$sparse: length, items: [[i, v]]}`, `{$obj: [[k, v]], nullProto?}`. Decoding uses `Object.defineProperty`, so a recorded own `"__proto__"` key stays data and cannot change a prototype. Objects with other prototypes (Date, Map, class instances) throw on encode and the case is skipped.

## Replay test file

`writeProofTest` writes a CommonJS file that requires the new module by relative path and the golden JSON, inlines `decode`, and declares the `call` functions as literal source (no `eval`). One `test()` per property group. It matches the default `node --test` file pattern, so the project's own test run picks it up.

## Properties per recipe

- left-pad: strings and integers, lengths −3..24 or undefined, pads including undefined, null, `''`, `0`, `false`, digits and 1–3 char strings.
- trim: whitespace-heavy strings over 18 code points (including NBSP, BOM, U+2028, U+180E, U+200B) for `trim`, `left`, `right`; non-string input; perf on 20,000 spaces either side of a word, 25 ms limit.
- object-assign: object targets with mixed sources (null, undefined, strings); null/undefined targets.
- xtend: up to 4 sources of objects, null, undefined, strings and arrays.
- arr-flatten: recursive dense and sparse arrays via `fc.letrec`.
- repeat-string: strings, integers or null with counts −4..40.
- inline: any values (`fc.anything`) and numeric-looking strings, for every exported function.

## Error handling

- Runner crash or permission denial → one failed `proof runner` property with the first `…Error:` line of stderr.
- Timeout → the child is killed; reported as a runner failure.
- A candidate with zero properties never passes.

## Testing strategy

- `test/prover.test.ts`: for every recipe, every candidate except the last fails with a counterexample and the last passes; a subtly wrong trim (ASCII-only whitespace) is rejected with a short counterexample; an "evil" module that tries to write a file and read a secret environment variable cannot do either.
- `test/codec.test.ts`: round-trip property over `fc.anything` with sparse arrays, null prototypes and bigint; `__proto__` stays data; unencodable values throw.
- `test/resurrect.test.ts`: replay files pass in a real workspace.

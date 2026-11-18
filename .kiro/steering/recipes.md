---
inclusion: fileMatch
fileMatchPattern: "src/resurrect/recipes.ts"
---

# Adding a replacement recipe

A recipe (`Recipe` in `src/resurrect/recipes.ts`) tells the Surgeon how to replace one dead package with built-in or maintained code. The prover decides whether a candidate is good enough; the recipe author only proposes.

## Steps

1. **Read the original source** in `examples/haunted-app/node_modules/<pkg>/` (or download the tarball). Note edge cases: falsy arguments, negative numbers, sparse arrays, non-string input, thrown errors, internal caches.
2. **Set `majors`** to the major versions whose source you read. `findRecipe` only matches those.
3. **List candidates simplest first.** Start with the naive replacement people would write by hand (often what the deprecation notice suggests, e.g. `padStart` for left-pad). Add a faithful candidate after it. Keeping the naive one is deliberate: when the proof rejects it, the counterexample in the PR shows reviewers why the faithful version is needed.
4. **Shims are CommonJS** and must export the same API as the original (default export plus any properties such as `trim.left`). Start each with the `header(pkg, why)` comment; its second line becomes the risk note in the PR.
5. **Write properties inside the documented API.** `args` is source for a fast-check arbitrary that yields an argument array; `call` is `(m, args) => …` when the default `m(...args)` is not right. Cover the edge cases from step 1. Do not generate inputs the original never supported (for example non-integer lengths for left-pad), and say so in `summary`.
6. **Perf properties** (`kind: 'perf'`, `input`, `maxMs`) check the new code on one large input, as the trim ReDoS property does.
7. **`args` and `call` run inside the sandbox** with only `fc` in scope: no imports, no closures over file variables.
8. **Run the prover tests:** `npx vitest run test/prover.test.ts`. The test asserts that every candidate except the last fails with a counterexample and the last one passes. If the naive candidate passes, either it is good enough (delete the later ones) or the properties miss a case.
9. If a package's API is too broad for a provable shim, add it to `MANUAL_REPLACEMENTS` instead; the Coroner then escalates it to a human with the hint.

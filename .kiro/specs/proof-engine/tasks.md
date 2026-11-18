# Tasks: Proof engine

- [x] 1. Property spec format for recipes (`PropertySpec` in `src/resurrect/recipes.ts`)
- [x] 2. Sandboxed runner with fast-check equivalence and counterexamples (`src/resurrect/proof-runner.mjs`)
- [x] 3. Spawn under `--permission` with real-path allowlist, empty env, timeout (`src/resurrect/prover.ts`)
- [x] 4. Perf properties (trim ReDoS: 20,000 spaces either side, 25 ms limit)
- [x] 5. `__each_export__` expansion for inlined packages (`inlineProperties`)
- [x] 6. Retry with the next candidate and live attempt events (`src/resurrect/resurrect.ts`)
- [x] 7. Lossless codec (`src/resurrect/codec.cjs`) with round-trip property test (`test/codec.test.ts`)
- [x] 8. Golden recording and `node:test` replay file (`writeProofTest` in `src/resurrect/surgeon.ts`)
- [x] 9. Prover tests incl. sandbox escape attempt (`test/prover.test.ts`)
- [x] 10. Fix macOS symlinked tmpdir in the sandbox allowlist (see `.kiro/specs/bugfix-symlinked-tmpdir/`)
- [x] 11. Proof table, attempts and replay result in the PR body (`src/resurrect/pr.ts`)
- [ ] 12. Count "N of M fixes proven" across three real public repositories for the write-up
- [ ] 13. Network restriction in the sandbox when Node's permission model supports it

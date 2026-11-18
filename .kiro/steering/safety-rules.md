---
inclusion: always
---

# Safety rules for every agent

These rules apply to the Coroner, the Surgeon and the Warden, and to any code change in this repo that touches the fix pipeline. If a rule cannot be met, stop and escalate to a human instead of working around it.

1. **Check the licence first.** Only copy code whose licence allows it (`licenseAllowsCopy` in `src/resurrect/coroner.ts`: MIT, ISC, BSD-2/3, 0BSD, Apache-2.0, WTFPL, Unlicense, CC0-1.0, BlueOak-1.0.0, Zlib, or an SPDX `OR` expression containing one). Inlined code keeps its licence file next to it.
2. **Keep the public API unchanged.** A replacement exports the same functions with the same arguments as the package it replaces. Callers' code changes only in the import path.
3. **Make the smallest possible diff.** Touch only the import sites of the package, `package.json`, `package-lock.json`, and files under `graveyard/`. No reformatting, no drive-by fixes.
4. **Record provenance.** Inlined code gets `PROVENANCE.json` (package, version, tarball URL, integrity hash, licence, files). Every PR body has a Provenance section. Registry tarballs are checked against the lockfile integrity hash before use (`verifyIntegrity` in `src/resurrect/tarball.ts`).
5. **Proof before pull request.** No PR draft unless every property in the proof passed. A rejected candidate stays in the PR as evidence, with its counterexample. If every candidate fails, the result is `failed` and a human gets the counterexamples.
6. **Human-reviewed pull requests only.** The tool drafts; people merge. Never push to a default branch.
7. **Sandbox, no secrets.** Package code under test runs in a child process with Node's `--permission` flag: read-only access to the listed paths, no file writes, no child processes, and an empty environment. The project's own `npm test` runs with only `PATH`, `HOME` and `CI`.
8. **Never publish automatically.** No `npm publish`, no pushing forks, no registry writes.
9. **Label simulated data.** Simulated advisories (demo only) carry `simulated: true`, an id starting with `SIMULATED-`, and the word "simulated" in every message, PR draft and task brief. Never present them as real.
10. **Do not overclaim.** The proof covers generated inputs inside the documented API, not every possible value. Say so in the risk note.

---
inclusion: always
---

# Product: Graveyard Shift

Graveyard Shift finds abandoned npm packages in a project, fixes each one by the safest route, proves the fix behaves like the original, and leaves a keeper bot watching the result.

## Who it is for

Teams that ship JavaScript or TypeScript with an npm lockfile and depend on packages nobody maintains anymore. When a flaw turns up in a dead package, nobody upstream ships a fix. Version bots (Dependabot, Renovate) cannot help because there is no newer release.

## What it does

1. **Scan** (`src/core/scanner.ts`): read `package-lock.json` (v1, v2 or v3), look up each package in the npm registry, OSV and GitHub, count import sites in the source, and give every package a zombie status and a risk score from 0 to 100.
2. **Diagnose** (the Coroner, `src/resurrect/coroner.ts`): pick one route per zombie.
3. **Fix** (the Surgeon, `src/resurrect/surgeon.ts` + `resurrect.ts`): make the change on a scratch git branch under `.graveyard/workspaces/`, never in the user's working tree.
4. **Prove** (`src/resurrect/prover.ts`, `proof-runner.mjs`): property-based tests (fast-check) run the old package and the new code on the same generated inputs in a sandboxed Node.js process. Only a fix that agrees on every input becomes a pull-request draft.
5. **Keep watch** (the Warden, `src/warden/`): a memory file per project records each adopted package and every decision; a patrol checks advisories and upstream releases.

## The three routes

| Route | When | Automated? |
| --- | --- | --- |
| Replace | A recipe in `src/resurrect/recipes.ts` covers the package and major version | Yes |
| Replace (manual) | A known modern replacement exists but the API is too broad (`MANUAL_REPLACEMENTS`, e.g. request → fetch) | No, escalated to a human |
| Inline | Small (≤ 32 KB), no runtime dependencies, permissive licence, no recipe | Yes |
| Adopt | Anything else: fork, patch known flaws, publish under your scope | No, escalated (automation is planned, not built) |

Transitive zombies are not fixed directly: the Coroner names the direct dependency that pulls them in (`viaParent`).

## Non-goals

- Publishing packages to a registry. Never automatic.
- Merging pull requests. A human always reviews.
- Ecosystems other than npm (a second ecosystem is planned, not built).
- Claiming equivalence beyond what was tested: proofs cover generated inputs inside the documented API.

## Planned, not built

- A Kiro Crew app and Kiro bots as the keeper runtime. Today the Warden runs from the CLI (`graveyard warden patrol`), the API, or the scheduled `.github/workflows/warden.yml`, which saves its memory in `graveyard/warden.json` through a pull request.
- Network isolation for the proof sandbox: Node 24's permission model limits files, processes and workers, not network.

Built since the first draft: `graveyard resurrect <pkg> --open-pr` opens a real GitHub pull request (`src/resurrect/publish.ts`), used for Rangesh11/haunted-app#3 and #2.
- Automated Adopt route (fork, patch, publish).

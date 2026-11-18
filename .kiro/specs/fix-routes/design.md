# Design: Fix routes

## Pipeline (`src/resurrect/resurrect.ts`)

```
resurrect(root, name)
  ├─ scan (or reuse report) → findPackage
  ├─ Coroner: diagnose(pkg, all)                 emit coroner
  │    └─ not automated → escalationReport        status: escalated
  ├─ locateOriginal (tarball.ts)                  emit surgeon
  ├─ prepareWorkspace → branch graveyard/<route>-<name>
  ├─ replace: for candidate of recipe.candidates
  │      writeShim → prove → keep first pass      emit surgeon/prover per attempt
  │  inline:  vendorPackage → prove(inlineProperties)
  │    └─ nothing passed → status: failed
  ├─ rewriteImports → sub-path imports? → escalated
  ├─ removeDependency
  ├─ writeProofTest + node --test (replay)        emit prover
  ├─ npm test in workspace (node_modules symlinked, env stripped)
  ├─ commit, diff, format-patch, renderPrBody     emit pr
  └─ adopt() into Warden memory                   emit warden, done
```

Every step emits a `ProgressEvent {stage, message, at, data}`. The API streams them over Server-Sent Events (`GET /api/resurrect?pkg=`), the CLI prints them, the MCP tool returns them as a log. Prover events carry `{ attempt: AttemptRecord }` so the UI can show a rejected candidate's counterexample as it happens.

## Coroner (`coroner.ts`)

Pure function `diagnose(pkg, all): Diagnosis`. Order of preference:

1. transitive → `viaParent` via `directAncestor` (BFS over `dependents`), not automated;
2. recipe (`findRecipe` by name and major) → Replace, automated;
3. small, dependency-free, permissive, no manual hint → Inline, automated;
4. manual hint → Replace, not automated;
5. otherwise → Adopt, not automated.

Replace beats Inline because it removes code instead of keeping it. `licenseAllowsCopy` splits SPDX `OR` expressions.

## Recipes (`recipes.ts`)

| Package | Majors | Candidates (in order) | Why the first fails |
| --- | --- | --- | --- |
| left-pad | 0, 1 | `padStart`, `repeat-exact` | padStart truncates multi-char pads and pads with `"false"` text |
| trim | 0, 1 | `native-trim` | (passes; also proves no ReDoS) |
| object-assign | 4 | `object-assign` (Object.assign) | (passes) |
| xtend | 4 | `assign-into-new` | (passes) |
| arr-flatten | 1 | `flat-infinity`, `loop-keep-holes` | `.flat()` drops holes |
| repeat-string | 1 | `repeat`, `repeat-guarded` | `.repeat(-1)` throws, original returns `""` |

`MANUAL_REPLACEMENTS` covers request, request-promise(-native), uuid, har-validator, querystring, mkdirp, rimraf, moment, node-uuid, colors.

## Surgeon (`surgeon.ts`)

- `prepareWorkspace`: `fs.cp` of each top-level entry except `node_modules`, `.git`, `.graveyard`; `git init -b main`; `node_modules` added to `.git/info/exclude`; baseline commit; branch.
- `rewriteImports`: uses `findSpecifiers` offsets, replaces from the end of the file backwards so earlier offsets stay valid; relative path computed per file with POSIX separators and a `./` prefix.
- `removeDependency`: JSON edit with detected indentation.
- `vendorPackage`: walks the package directory with skip rules; records `PROVENANCE.json`.
- `writeProofTest`: see `proof-engine`.
- `linkNodeModules`: symlinks the original `node_modules` into the workspace so `npm test` can run.

Git runs with a fixed author (`Graveyard Shift <surgeon@graveyard-shift.invalid>`) so the user's identity is never used. Subprocesses (`run` in `git.ts`) get only `PATH`, `HOME` and `CI=1`.

## Types

`Diagnosis`, `AttemptRecord`, `FileChange`, `PullRequestDraft`, `ResurrectionResult` (`status: 'proven' | 'escalated' | 'failed'`) in `src/core/types.ts`.

## Error handling

- Package not in the lockfile or alive → thrown error with a clear message (HTTP error event in SSE).
- Sub-path imports → `escalated` with the file and line of each.
- Every candidate rejected → `failed` with counterexamples; no PR.
- Replay or project tests failing → PR is still drafted but the risk note carries a ⚠️ "do not merge" line.
- The API refuses a second concurrent resurrection of the same package.

## Testing strategy

- `test/coroner.test.ts`: recipe preferred; inline for small permissive packages; GPL never inlined; request escalated with the fetch hint; transitive `viaParent` through two levels; SPDX `OR`.
- `test/resurrect.test.ts` (offline, on a temp copy of `examples/haunted-app`): left-pad rejects padStart then passes; shim import, package.json and lockfile edits; the app's receipt output is byte-identical before and after; the original working tree is untouched; is-number inlined with LICENSE and PROVENANCE.json; request escalated.

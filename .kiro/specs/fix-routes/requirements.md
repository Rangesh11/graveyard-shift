# Requirements: Fix routes (Coroner and Surgeon)

## Introduction

For each zombie the Coroner picks the safest route and the Surgeon carries it out on a scratch branch. Only automated routes produce a change; everything else is escalated to a human with the reasons. The proof that gates the change is specified in `proof-engine`.

## Requirement 1: Choose one route per zombie (Coroner)

**User story:** As a maintainer, I want the tool to choose the least risky fix and explain why, so that I can review the decision, not just the diff.

### Acceptance criteria

1. WHEN the package is not a direct dependency THE SYSTEM SHALL not fix it, SHALL set `automated: false`, and SHALL name the nearest direct dependency that pulls it in as `viaParent` (breadth-first over `dependents`).
2. WHEN a recipe in `src/resurrect/recipes.ts` matches the package name and installed major version THE SYSTEM SHALL choose the Replace route with `automated: true`, the recipe id and its replacement.
3. WHEN no recipe matches, the package is not in `MANUAL_REPLACEMENTS`, has no runtime dependencies, is at most 32 KB unpacked (or at most 12 files when size is unknown), and its licence allows copying THE SYSTEM SHALL choose the Inline route with `automated: true`.
4. WHEN the package is in `MANUAL_REPLACEMENTS` THE SYSTEM SHALL choose Replace with `automated: false` and the replacement hint (for example request → the built-in fetch API).
5. OTHERWISE THE SYSTEM SHALL choose Adopt with `automated: false` and explain why (dependencies, size, or a licence that needs a human check).
6. THE SYSTEM SHALL include the scanner's reasons plus the route reasoning in `rationale`, and SHALL report `licenseOk`.
7. WHEN asked to diagnose a living package THE SYSTEM SHALL refuse (HTTP 422 in the API) because version bots handle living packages.

## Requirement 2: Never touch the user's working tree

**User story:** As a developer, I want to run the Surgeon without risk to my checkout.

### Acceptance criteria

1. WHEN a fix starts THE SYSTEM SHALL copy the project (without `node_modules`, `.git` and `.graveyard`) to `.graveyard/workspaces/<branch>`, create a git repository there with a `baseline` commit on `main`, and switch to `graveyard/<route>-<name>`.
2. THE SYSTEM SHALL make every change inside that workspace only.
3. WHEN the fix is proven THE SYSTEM SHALL commit it on the branch with a message that states the proof size and the replay test path.

## Requirement 3: Find the exact original code

### Acceptance criteria

1. WHEN the project's `node_modules/<name>` has the locked version THE SYSTEM SHALL use it.
2. OTHERWISE THE SYSTEM SHALL download the registry tarball, verify it against the lockfile integrity hash (sha512/sha384/sha256/sha1), and extract it to the cache.
3. IF the integrity check fails THEN THE SYSTEM SHALL stop with an error naming the package.
4. IF offline mode is on and the package is not installed THEN THE SYSTEM SHALL stop and ask for `npm install`.

## Requirement 4: Replace route

### Acceptance criteria

1. THE SYSTEM SHALL write each recipe candidate in order to `graveyard/shims/<name>.cjs` and prove it before trying the next.
2. WHEN a candidate passes THE SYSTEM SHALL stop trying and keep that candidate.
3. IF no candidate passes THEN THE SYSTEM SHALL return status `failed` with every attempt and counterexample, and SHALL not open a pull request.

## Requirement 5: Inline route

### Acceptance criteria

1. THE SYSTEM SHALL copy the package's runtime `.js/.cjs/.mjs/.json` files and its top-level licence file into `graveyard/vendor/<name>/`, skipping tests, examples, docs, benchmarks and `node_modules`.
2. THE SYSTEM SHALL write `PROVENANCE.json` with package, version, licence, licence file, source, tarball, integrity and file list.
3. THE SYSTEM SHALL point imports at the vendored entry file (not the folder) so ESM imports work.

## Requirement 6: Rewire the project

### Acceptance criteria

1. WHEN the proof has passed THE SYSTEM SHALL rewrite every import of exactly `<name>` to a relative path to the new file, leaving all other code unchanged.
2. IF any file imports a sub-path such as `<name>/lib/x` THEN THE SYSTEM SHALL escalate instead of guessing.
3. THE SYSTEM SHALL remove the package from `dependencies`, `devDependencies` and `optionalDependencies` in `package.json`, keeping its indentation.
4. THE SYSTEM SHALL remove it from the lockfile root entry, and SHALL remove its `node_modules/<name>` entry only when no other package depends on it.

## Requirement 7: Pull-request draft

### Acceptance criteria

1. THE SYSTEM SHALL write a PR body (`src/resurrect/pr.ts`) with: why this package, the Coroner's verdict, what changed, the proof table, every attempt with counterexamples, the replay test result, project test result, risk note, provenance and a reviewer checklist.
2. THE SYSTEM SHALL save the body to `.graveyard/prs/<name>.md` and a `git format-patch` file to `.graveyard/prs/<name>.patch`.
3. THE SYSTEM SHALL return the diff (lockfile shown as a stat) and the list of added, modified and deleted files.
4. THE SYSTEM SHALL hand the package to the Warden (see `warden-keeper`).

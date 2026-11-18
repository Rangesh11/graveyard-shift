# Requirements: Zombie scanner

## Introduction

The scanner reads a project's npm lockfile and tells the team which installed packages are dead, how dead, and how much that matters to this project. It is the first step of Graveyard Shift and the data behind the graveyard map.

## Requirement 1: Read any npm lockfile

**User story:** As a developer, I want to point the tool at my project or paste my `package-lock.json`, so that I can see my dependencies without changing my setup.

### Acceptance criteria

1. WHEN a lockfile with a `packages` map (versions 2 and 3) is given THE SYSTEM SHALL list every installed package once per `name@version`, with all its install paths.
2. WHEN a version 1 lockfile with a nested `dependencies` tree is given THE SYSTEM SHALL convert it to the same install paths and treat `requires` as dependencies.
3. WHEN a package is listed in the root `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` and installed at the top level THE SYSTEM SHALL mark it as direct.
4. WHEN resolving which installed copy a dependency uses THE SYSTEM SHALL follow Node's rule: the nearest `node_modules` folder up the tree wins.
5. WHEN the input is not JSON, not an object, or has neither `packages` nor `dependencies` THE SYSTEM SHALL fail with a `LockfileError` whose message says what is wrong.
6. WHEN an entry is a workspace link (`link: true`) THE SYSTEM SHALL skip it.

## Requirement 2: Measure how dead each package is

**User story:** As a developer, I want real evidence for each verdict, so that I can trust the ranking.

### Acceptance criteria

1. WHEN scanning THE SYSTEM SHALL fetch registry facts for each unique package name: latest version, deprecation notice on the installed and latest versions, publish dates, licence, repository URL, unpacked size and file count.
2. WHEN scanning THE SYSTEM SHALL query OSV for known advisories for every `name@version` not already cached, in batches of at most 500, and record id, aliases, summary, severity, URL and the first fixed version.
3. WHEN a package is direct, deprecated, or has had no release for 365 days or more THE SYSTEM SHALL check its GitHub repository and record `active`, `archived` or `missing`.
4. IF the GitHub check is rate-limited or the host is not GitHub THEN THE SYSTEM SHALL record `unknown`, not count it in the score, and add a warning suggesting `GITHUB_TOKEN`.
5. IF a registry lookup fails THEN THE SYSTEM SHALL keep the package in the report with an `error` and score it from what is known.

## Requirement 3: Measure how much the project uses it

**User story:** As a reviewer, I want to know where a dead package is used, so that I can judge the blast radius.

### Acceptance criteria

1. WHEN a project directory is scanned THE SYSTEM SHALL find `require()`, static `import`, side-effect `import`, dynamic `import()` and `export … from` specifiers in `.js .cjs .mjs .jsx .ts .cts .mts .tsx` files.
2. WHEN counting usage THE SYSTEM SHALL skip `node_modules`, `.git`, `dist`, `build`, `coverage`, `.graveyard`, `graveyard`, hidden folders and `.d.ts` files.
3. WHEN a specifier is relative, absolute, a URL-like scheme or a Node builtin THE SYSTEM SHALL ignore it; a sub-path such as `@scope/pkg/x` counts toward `@scope/pkg`.
4. WHEN only a pasted lockfile is scanned THE SYSTEM SHALL set `usageScanned: false` and use the number of dependents as exposure.

## Requirement 4: Score and rank

**User story:** As a team lead, I want the riskiest zombies first, so that we fix what matters.

### Acceptance criteria

1. THE SYSTEM SHALL mark a package `deprecated` when its installed version is deprecated, `archived` when its repository is archived, `dormant` after 730 days without a release, and `alive` otherwise; any status other than `alive` is a zombie.
2. THE SYSTEM SHALL compute deadness from 0 to 1 and risk as an integer from 0 to 100 from deadness (up to 40), the worst advisory plus 3 per extra advisory (up to 35, halved for living packages), exposure `log2(1 + usageSites + dependents) × 5` (up to 15), and 10 for a direct dependency.
3. THE SYSTEM SHALL give a human-readable reason for every factor that contributes.
4. WHEN new evidence arrives (another advisory, more time without a release, more import sites) THE SYSTEM SHALL never lower the risk.
5. THE SYSTEM SHALL sort zombies first, then by risk, then by name.

## Requirement 5: Work offline and stay polite

**User story:** As a judge or a CI job, I want the scan to work without network access and without hammering public APIs.

### Acceptance criteria

1. THE SYSTEM SHALL cache registry (12 h), OSV advisory ids per package version (6 h), advisory details (24 h) and GitHub (24 h) responses on disk, so a later scan only asks OSV about versions it has not seen.
2. WHEN `GRAVEYARD_OFFLINE=1` THE SYSTEM SHALL never call the network and SHALL fall back to the shipped snapshot in `fixtures/cache`.
3. IF the network fails online THEN THE SYSTEM SHALL use a stale cache entry or the shipped snapshot before failing.
4. THE SYSTEM SHALL limit concurrency: 8 registry lookups, 6 advisory detail lookups, 4 GitHub lookups at a time.

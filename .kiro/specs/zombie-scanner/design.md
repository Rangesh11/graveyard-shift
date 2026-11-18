# Design: Zombie scanner

## Overview

```
package-lock.json ─▶ lockfile.ts ─▶ LockedPackage[]
project source    ─▶ imports.ts  ─▶ UsageIndex (package → file → sites)
                                     │
      registry.ts (npm) ─┐           │
      osv.ts (OSV)      ─┼─ cache.ts ┤
      github.ts (repos) ─┘           ▼
                         scanner.ts ─▶ Signals ─▶ score.ts ─▶ ScanReport
```

`scanner.ts` exposes `scan(input)` for a lockfile string (used by `POST /api/scan` for pasted lockfiles) and `scanProjectDir(root)` which also reads `package.json` and scans source usage. CLI, API, MCP and the resurrection pipeline all call these.

## Key types (`src/core/types.ts`)

- `LockedPackage`: `name`, `version`, `paths`, `direct`, `dev`, `integrity`, `resolved`, `dependents` (names of packages that depend on it), `dependencies`.
- `RegistryFacts`: `latest`, `deprecated`, `latestDeprecated`, `lastPublish`, `installedPublish`, `license`, `repositoryUrl`, `unpackedSize`, `fileCount`, `maintainers`.
- `Advisory`: `id`, `aliases`, `summary`, `severity`, `url`, `fixedIn`, `simulated?`.
- `Signals`: `deprecated`, `daysSinceLastPublish`, `repo`, `advisories`, `usageSites`, `usageFiles`, `direct`, `dependents`.
- `Score`: `status`, `deadness`, `risk`, `zombie`, `reasons`.
- `ScannedPackage` = `LockedPackage` + `facts`, `signals`, `score`, `importedBy`, `error?`.
- `ScanReport`: `project`, `scannedAt`, `lockfileVersion`, `totals`, sorted `packages`, `usageScanned`, `offline`, `warnings`.

`types.ts` has no Node imports because the web UI imports it.

## Lockfile parsing (`lockfile.ts`)

- v2/v3: iterate `packages` keys containing `node_modules/`; `nameFromPath` takes the segment after the last `node_modules/` (handles scopes and nesting); an entry's `name` field wins for aliases.
- v1: `v1ToPackages` flattens the nested tree into the same key shape.
- Dependents: for each entry and each declared dependency, `resolveFrom` walks from the entry's key up through ancestor `node_modules` folders until a key exists, exactly as Node resolves.
- Deduplication by `name@version`; a package is non-dev if any copy is non-dev.

## Usage (`imports.ts`)

One regex finds specifiers after `require(`, `import(`, `from` and bare `import `, and reports the offsets of the text inside the quotes. The Surgeon reuses those offsets to rewrite imports, so the finder must be exact (property-tested).

## Remote data

- `registry.ts` keeps a trimmed document per package name (per-version deprecation, licence, repository, size, tarball, integrity, dependencies, publish time). Scoped names are URL-encoded as `@scope%2fname`.
- `osv.ts` first checks the per-version cache (`peek('osv-pkg', name@version)`), sends only the missing versions to `/v1/querybatch`, stores each version's ids (`store`), then fetches `/v1/vulns/{id}` for details. Offline with uncached versions it throws, and the scanner records a warning. Severity comes from `database_specific.severity` (`medium` maps to `moderate`).
- `github.ts` parses the many repository URL shapes (`git+ssh://`, `github:`, `owner/repo`). 404 → `missing`; errors → `unknown` and not cached.

## Cache (`cache.ts`)

`cached(namespace, key, ttl, load)` (plus `peek` and `store` for per-item batching) stores `{storedAt, value}` JSON under `GRAVEYARD_CACHE` (default `~/.cache/graveyard-shift`). File names are a sanitised key plus a SHA-1 prefix. Offline mode reads the cache, then `fixtures/cache`. `scripts/record-demo.ts` fills `fixtures/cache` from a fresh cache directory.

## Scoring (`score.ts`)

Pure functions, no I/O:

- `deadness`: 1 if deprecated; otherwise piecewise linear in days (0–0.2 in year one, 0.2–0.6 in year two, 0.6–0.9 over the next five years); archived raises it to at least 0.9; missing repo adds 0.1. Continuous at the boundaries so it is monotone.
- `statusOf`: deprecated > archived > dormant (≥ 730 days) > alive.
- `scorePackage`: see requirement 4.2. Exposure uses `usageSites + dependents`.

## Error handling

- Bad lockfile input: `LockfileError` → HTTP 400 in the API, a red message in the CLI.
- Missing `package-lock.json` in a directory: clear message telling the user to run `npm install`.
- Partial remote failures never abort the scan; they become `warnings` or per-package `error`.

## Testing strategy

Property-based (fast-check, `test/score.test.ts`, `test/lockfile.test.ts`, `test/imports.test.ts`):

- risk is an integer in 0..100 and deadness in 0..1 for any signals;
- adding an advisory never lowers risk;
- more days without a release never lowers deadness or risk;
- more import sites never lower risk (this property found a real bug; see `bugfix-symlinked-tmpdir/bugfix.md`);
- deprecated or archived is always a zombie, recent and active never is;
- every contributing factor has a reason;
- `nameFromPath` returns the package name at any nesting depth, for scoped and unscoped names;
- `resolveFrom` picks the nearest `node_modules`;
- parsing never loses or invents packages;
- specifier offsets always point exactly at the specifier text.

Example-based: the real example lockfile (v3), a v1 lockfile, malformed input. `test/resurrect.test.ts` scans a copy of `examples/haunted-app` offline and expects `trim` (CVE-2020-7753) on top and `dayjs` alive.

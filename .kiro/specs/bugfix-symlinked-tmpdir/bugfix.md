# Bugfix: symlinked temp folders broke the inline route and the sandbox

Two real bugs found while writing tests, and how they were fixed. Both were caught by tests, not by users.

## Bug 1: inline route failed when the project lived under a symlink

### Symptom

`test/resurrect.test.ts` copies the haunted app to `os.tmpdir()` and resurrects it. Inlining `is-number` failed with:

```
Error: Cannot find module '/var/folders/…/private/var/folders/…/haunted-app/node_modules/is-number/index.js'
```

The same run inside the repository folder passed.

### Root cause

On macOS `os.tmpdir()` is under `/var`, which is a symlink to `/private/var`. In `src/resurrect/tarball.ts`, `describe(dir)` called `require.resolve(dir)`, which returns a real path (`/private/var/…/index.js`), while `dir` stayed `/var/…`. `main` was computed as `path.relative(dir, entry)`, giving `../../../…/private/var/…/index.js`. The vendored entry path built from it (`graveyard/vendor/is-number/<main>`) pointed outside the vendor folder.

### Fix

`describe()` now resolves the directory with `realpathSync` before calling `require.resolve`, so both sides are real paths and `main` is `index.js`.

## Bug 2: the proof sandbox denied reading `/var`

### Symptom

Under vitest every proof failed with `Error: Access to this API has been restricted. Use --allow-fs-read to manage permissions.` and `resource: '/var'`.

### Root cause

`prove()` allowed reads on the paths it was given. Node's CommonJS loader calls `realpathSync`, which stats every component of a module path, including the symlink `/var` itself, which was not on the allowlist.

### Fix

`src/resurrect/prover.ts` resolves the temp config folder, the old entry, the new entry and every allowed directory to real paths before spawning the runner. The allowlist stays narrow; `/var` is never allowed as a whole.

### Regression coverage

- `test/resurrect.test.ts` runs the full pipeline from a copy in `os.tmpdir()`.
- `test/prover.test.ts` writes candidate shims to `os.tmpdir()`.

## Bug 3 (found by a property test): more usage could lower the risk score

### Symptom

The property "more import sites never lower the risk" in `test/score.test.ts` was written while building the scorer and would fail for a package with many dependents and zero import sites.

### Root cause

`scorePackage` used `usageSites > 0 ? usageSites : dependents` as exposure. A package with 200 dependents and no direct imports scored higher than the same package once the project imported it in one place.

### Fix

Exposure is now `usageSites + dependents` in `src/core/score.ts`, so every extra use adds exposure. All six score properties pass.

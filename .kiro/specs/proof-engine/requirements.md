# Requirements: Proof engine

## Introduction

The proof is what separates a Graveyard Shift fix from a plain AI rewrite. Before any change becomes a pull request, generated inputs must give the same result from the original package and from the new code. The proof also leaves a replay test in the project so the behaviour stays guarded after the original package is gone.

## Requirement 1: Equivalence on generated inputs

**User story:** As a reviewer, I want evidence that the new code behaves like the old code, so that I can merge without re-deriving the package's edge cases.

### Acceptance criteria

1. WHEN proving a candidate THE SYSTEM SHALL generate argument tuples with fast-check from each property's arbitrary and call both the original module and the new module with independent deep copies (`structuredClone`) of the same arguments.
2. THE SYSTEM SHALL count two outcomes as equal WHEN both return values that are deep-strictly equal (`util.isDeepStrictEqual`, so prototypes, `-0`, `NaN` and holes matter) OR both throw an error of the same constructor name.
3. THE SYSTEM SHALL run 500 inputs per property by default, with a fixed seed (20261031) so every run is reproducible.
4. WHEN a property fails THE SYSTEM SHALL report the shrunk counterexample: the arguments, the original's result and the candidate's result.
5. WHEN a property's `call` is `__each_export__` THE SYSTEM SHALL check the default export (if it is a function) and every exported function property separately.
6. THE SYSTEM SHALL report a candidate as passed only when it has at least one property and every property passed.

## Requirement 2: Performance properties

**User story:** As a security reviewer, I want a fix for a ReDoS advisory to prove the new code is fast on the attack input.

### Acceptance criteria

1. WHEN a property has `kind: 'perf'` THE SYSTEM SHALL time the original and the new code once on the given input and pass only IF the outputs agree AND the new code finishes within `maxMs`.
2. THE SYSTEM SHALL report both timings in the property name (for trim: about 650 ms for the original against well under 1 ms for the replacement on 40,000 spaces).

## Requirement 3: Sandbox

**User story:** As a user, I want package code that runs during the proof to be unable to harm my machine or read my secrets.

### Acceptance criteria

1. THE SYSTEM SHALL run the proof in a separate Node.js process started with `--permission`.
2. THE SYSTEM SHALL allow file reads only for: the runner folder, the tool's `node_modules`, the original package's `node_modules` root, the new code's folder and the temporary config folder, all as real paths.
3. THE SYSTEM SHALL start the child with an empty environment.
4. THE SYSTEM SHALL kill the child after 120 seconds.
5. IF the child exits with an error THEN THE SYSTEM SHALL report a failed "proof runner" property with the first error line.

## Requirement 4: Retry with the next candidate

### Acceptance criteria

1. WHEN a candidate fails THE SYSTEM SHALL record it as an `AttemptRecord` with its proof and move on to the next candidate.
2. THE SYSTEM SHALL emit each attempt as it finishes so the UI can show "the proof caught it" live.

## Requirement 5: Replay test that stays in the project

**User story:** As a maintainer, I want the evidence to keep working after the original package is uninstalled.

### Acceptance criteria

1. WHEN a candidate passes THE SYSTEM SHALL record 40 inputs per property (sampled with the same seed) and the original's outcome for each.
2. THE SYSTEM SHALL store them losslessly (undefined, NaN, ±Infinity, -0, bigint, sparse arrays, null-prototype objects and own `__proto__` keys) in `graveyard/proofs/<name>.golden.json`, and SHALL leave out any value it cannot store faithfully.
3. THE SYSTEM SHALL write `graveyard/proofs/<name>.proof.test.js`, a dependency-free `node:test` file that replays every case against the new code.
4. THE SYSTEM SHALL run that file with `node --test` in the workspace and report the result in the pull request.

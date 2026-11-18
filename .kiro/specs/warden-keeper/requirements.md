# Requirements: Warden keeper

## Introduction

A fix is not the end of the job. Once a package is replaced or inlined, the project owns that code. The Warden is the standing keeper for each resurrected package: it watches for advisories and upstream releases, decides what each finding means for this project, and remembers every decision so it never acts twice.

Today the Warden runs from the CLI, the HTTP API, the MCP server or a scheduled job. Running each keeper as a Kiro bot inside a Kiro Crew app is planned, not built.

## Requirement 1: Adopt after a proven fix

**User story:** As a maintainer, I want every resurrected package to get a keeper automatically.

### Acceptance criteria

1. WHEN a resurrection is proven THE SYSTEM SHALL add or refresh a keeper record with package, version, route, adoption time, branch, last known upstream version, and the advisory ids the fix already resolved.
2. THE SYSTEM SHALL record an `adopted` decision that names the branch, the proof size and the winning candidate.
3. THE SYSTEM SHALL store all keepers for a project in `.graveyard/warden.json` inside that project.

## Requirement 2: Patrol

**User story:** As a maintainer, I want the keeper to check for new problems on a schedule, without noise.

### Acceptance criteria

1. WHEN a patrol runs THE SYSTEM SHALL query OSV for every kept `name@version` and the npm registry for the latest version.
2. WHEN the upstream latest version differs from the last one seen THE SYSTEM SHALL record a `release` decision ("upstream woke up") and update the last known version.
3. WHEN an advisory id is already in `seenAdvisories` THE SYSTEM SHALL ignore it.
4. WHEN a new advisory concerns a package on the Replace route THE SYSTEM SHALL record that the project is not affected, because the original code no longer runs.
5. WHEN a new advisory concerns a package on the Inline route THE SYSTEM SHALL draft a patch pull request and a Surgeon task brief, and record a `patch-drafted` decision.
6. WHEN a patrol finds nothing new for a keeper THE SYSTEM SHALL record a `patrol` decision ("all quiet") and update `lastPatrol`.
7. IF the advisory database is unreachable THEN THE SYSTEM SHALL say so and retry on the next patrol without marking anything as seen.
8. WHEN there are no keepers THE SYSTEM SHALL say how to get one.

## Requirement 3: Memory stays useful

### Acceptance criteria

1. THE SYSTEM SHALL keep the 50 most recent decisions per keeper.
2. THE SYSTEM SHALL never handle the same advisory id twice for a keeper.

## Requirement 4: Patch drafts

### Acceptance criteria

1. THE SYSTEM SHALL write the draft body to `.graveyard/prs/<name>-<advisory>.md` and the Surgeon task brief to `.graveyard/tasks/<name>-<advisory>.md`.
2. THE SYSTEM SHALL say in the plan whether upstream published a fixed version (re-inline it with the same proof) or not (the Surgeon writes the smallest patch, with a regression property that reproduces the advisory).
3. THE SYSTEM SHALL include the last five memory entries in the draft.

## Requirement 5: Simulated advisories for demos

**User story:** As a presenter, I want to show how a keeper reacts to a new advisory, without inventing real-looking data.

### Acceptance criteria

1. WHEN a patrol is asked to simulate an advisory for a kept package THE SYSTEM SHALL create one with an id starting `SIMULATED-`, `simulated: true`, and a summary starting "SIMULATED for the demo".
2. THE SYSTEM SHALL mark the resulting decisions `simulated`, put "simulated advisory" in every event message, and put a "This advisory is SIMULATED" warning at the top of any draft and task brief.

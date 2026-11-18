# Design: Warden keeper

## Components

- `src/warden/memory.ts`: `memoryPath`, `loadMemory`, `saveMemory`, `remember` (append + cap at 50), `adopt`.
- `src/warden/warden.ts`: `patrol(root, {simulate?, now?})`, `simulatedAdvisory`, `patchDraft` (internal).
- Callers: `resurrect()` calls `adopt()` after a proven fix; CLI `graveyard warden patrol|status`; API `GET /api/warden`, `POST /api/warden/patrol`; MCP `warden_patrol`, `warden_memory`.

## Types (`src/core/types.ts`)

- `WardenMemory { project, keepers: KeeperRecord[] }`
- `KeeperRecord { package, version, route, adoptedAt, branch?, seenAdvisories[], lastPatrol?, lastKnownUpstream?, decisions[] }`
- `WardenDecision { at, kind: 'adopted' | 'patrol' | 'advisory' | 'release' | 'patch-drafted' | 'escalated', summary, advisoryId?, simulated? }`

## Why the memory is a file in the project

It travels with the code, shows up in review, and needs no service. A future Kiro bot can read and write the same file, so moving the keeper into Kiro Crew does not change the data.

## Patrol decision table

| Finding | Replace route | Inline route |
| --- | --- | --- |
| New advisory | `advisory`: not affected, code replaced | `patch-drafted` + PR draft + task brief |
| Advisory already seen | ignored | ignored |
| Upstream released a new version | `release` | `release` |
| Nothing new | `patrol`: all quiet | `patrol`: all quiet |

Adopt-route keepers are planned with the Adopt route.

## Running on a schedule

Planned: one Kiro bot per keeper in a Kiro Crew app (separate repository, as the Crew prize requires). Fallback that works today: a scheduled job runs `graveyard warden patrol --dir <project>` and commits `.graveyard/warden.json`, or the Warden custom agent (`.kiro/agents/warden.json`) runs headless and calls the `warden_patrol` MCP tool.

## Error handling

- OSV failure: one event, no advisories marked seen, retried next patrol.
- Registry failure: upstream check skipped for that keeper.
- Missing memory file: empty memory named after the project folder.

## Testing strategy

`test/resurrect.test.ts`, on a temp copy of the haunted app, offline: after resurrecting left-pad and is-number the memory has both keepers; a patrol simulating an advisory for is-number drafts exactly one PR whose body says SIMULATED; a second patrol drafts nothing and the memory holds exactly one `patch-drafted` decision. The web UI's Keepers tab was checked by hand against a live server.

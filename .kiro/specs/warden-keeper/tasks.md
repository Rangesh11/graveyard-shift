# Tasks: Warden keeper

- [x] 1. Memory file and decision log with a 50-entry cap (`src/warden/memory.ts`)
- [x] 2. Adopt after every proven resurrection (`adopt` called from `src/resurrect/resurrect.ts`)
- [x] 3. Patrol: advisories, upstream releases, per-route decisions (`src/warden/warden.ts`)
- [x] 4. Patch PR drafts and Surgeon task briefs for inlined code
- [x] 5. Clearly labelled simulated advisories for demos
- [x] 6. CLI `graveyard warden patrol|status`, API `/api/warden`, `/api/warden/patrol`, MCP `warden_patrol`, `warden_memory`
- [x] 7. Keepers tab in the web UI (`web/src/components/KeepersView.tsx`)
- [x] 8. Test: never handles an advisory twice (`test/resurrect.test.ts`)
- [ ] 9. Kiro Crew app with one Kiro bot per keeper, in its own public repository (planned)
- [x] 10. Scheduled GitHub Action that patrols and saves the memory file through a pull request (`.github/workflows/warden.yml`); each fix PR adds its keeper to the committed `graveyard/warden.json` (`adoptCommitted` in `src/warden/memory.ts`); `warden patrol --json` reports `changed`
- [x] 10a. Report "advisory check skipped", not "all quiet", when the advisory database is unreachable
- [ ] 11. Surgeon agent picks up the `graveyard/tasks/` briefs the patrol PR commits, headless with `kiro-cli chat --no-interactive` (workflow written, not run: needs Kiro credentials)
- [ ] 12. Keepers for the Adopt route (with the Adopt route)

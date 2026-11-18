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
- [ ] 10. Scheduled GitHub Action that patrols and commits the memory file (planned)
- [ ] 11. Surgeon agent picks up `.graveyard/tasks/` briefs headless with `kiro-cli chat --no-interactive` (planned)
- [ ] 12. Keepers for the Adopt route (with the Adopt route)

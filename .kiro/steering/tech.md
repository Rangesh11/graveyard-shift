---
inclusion: always
---

# Tech

- **Runtime:** Node.js 22+ (developed on 24). ESM TypeScript run directly with `tsx`; there is no compile step for the backend.
- **Language:** TypeScript (strict), imports use explicit `.ts` extensions. Two plain-JS files run outside tsx on purpose: `src/resurrect/proof-runner.mjs` (sandboxed child process) and `src/resurrect/codec.cjs` (also inlined into generated proof tests).
- **Property-based testing:** fast-check, both for the product's proofs and for this repo's own tests.
- **Tests:** vitest (`vitest.config.ts` sets `GRAVEYARD_OFFLINE=1` so tests read `fixtures/cache` and never use the network).
- **MCP:** `@modelcontextprotocol/sdk` over stdio, schemas in zod (`src/mcp/server.ts`).
- **Web UI:** Vite + React 19, hand-written CSS, no UI library (`web/`).
- **HTTP API:** plain `node:http` with Server-Sent Events for live resurrections (`src/server/app.ts`).
- **Data sources:** npm registry, OSV (`api.osv.dev`), GitHub REST (set `GITHUB_TOKEN` for more than 60 calls an hour).

## Commands

```bash
npm install
npm run example:install        # installs the demo target's dead packages
npm test                       # vitest, offline
npm run typecheck
npm run dev                    # API on :8787 + UI on :5173
npm start                      # build UI, serve everything on :8787
npm run mcp                    # MCP server on stdio
npm run demo:record            # re-record web/public/demo and fixtures/cache
./bin/graveyard.mjs scan examples/haunted-app
./bin/graveyard.mjs diagnose left-pad --dir examples/haunted-app
./bin/graveyard.mjs resurrect left-pad --dir examples/haunted-app
./bin/graveyard.mjs warden patrol --dir examples/haunted-app [--simulate is-number]
```

## Environment variables

| Variable | Effect |
| --- | --- |
| `GRAVEYARD_OFFLINE=1` | Use cached data only, falling back to `fixtures/cache` |
| `GRAVEYARD_CACHE` | Cache directory (default `~/.cache/graveyard-shift`) |
| `GITHUB_TOKEN` | Authenticated repo-status checks |
| `GRAVEYARD_PROJECT` | Project the API server works on (default `examples/haunted-app`) |
| `PORT` | API port (default 8787) |

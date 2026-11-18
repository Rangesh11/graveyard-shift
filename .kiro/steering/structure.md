---
inclusion: always
---

# Structure

```
src/
  core/            scanning: no file writes outside the cache
    types.ts         shared types (also imported by the web UI; no Node imports)
    cache.ts         disk cache, offline fixtures, fetchJson, mapLimit
    lockfile.ts      package-lock.json v1/v2/v3 parser, Node-style resolution
    imports.ts       finds require/import specifiers, usage index
    registry.ts      npm registry client (trimmed docs)
    osv.ts           OSV batch advisories
    github.ts        repo state: active / archived / missing / unknown
    score.ts         pure scoring: deadness, status, risk
    scanner.ts       orchestrates a scan into a ScanReport
  resurrect/       fixing
    recipes.ts       replacement recipes (candidates + properties), manual hints
    coroner.ts       route choice (pure)
    tarball.ts       finds the exact original code (node_modules or hash-checked tarball)
    surgeon.ts       workspace branch, shims, vendoring, import rewrite, proof test file
    prover.ts        spawns the sandboxed proof runner
    proof-runner.mjs fast-check equivalence + golden recording (runs under --permission)
    codec.cjs        lossless JSON for recorded cases
    pr.ts            PR title and body
    resurrect.ts     the pipeline: Coroner → Surgeon → prover → PR → Warden
    git.ts           git and subprocess helpers
    publish.ts       --open-pr: applies the patch in a temp worktree, pushes, gh pr create
  warden/
    memory.ts        keeper memory: committed graveyard/warden.json (merged fixes) + local .graveyard/warden.json (drafts)
    warden.ts        patrol, patch PR drafts, simulated advisories
  server/          HTTP API + static UI
  mcp/server.ts    MCP tools for Kiro agents
  cli.ts           `graveyard` CLI (bin/graveyard.mjs runs it through tsx)
web/               Vite + React graveyard map; public/demo holds recorded runs
examples/haunted-app/  demo target with real dead packages
fixtures/cache/    recorded registry/OSV/GitHub responses for offline runs
test/              vitest + fast-check
scripts/           dev runner, demo recorder
power/graveyard-shift/  the Kiro Power
.kiro/             specs, steering, hooks, agents, MCP settings
```

Generated at runtime inside a target project (git-ignored): `.graveyard/workspaces/<branch>/`, `.graveyard/prs/`, `.graveyard/tasks/`, `.graveyard/warden.json`. Code the Surgeon adds to a project lives under `graveyard/` (`shims/`, `vendor/`, `proofs/`); `imports.ts` skips that folder so it is never rewritten twice.

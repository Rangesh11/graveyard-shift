# 🪦 Graveyard Shift

**Dead code gets a night crew.** Graveyard Shift reads an npm lockfile, finds the packages nobody maintains, and fixes each one by the safest route it can prove. Every fix arrives as a pull request with property-based proof that the new code behaves like the old, and a keeper bot stays on watch afterwards.

Built for Kiroween 2026 (Resurrection category). MIT licensed.

- **Live demo:** https://rangesh11.github.io/graveyard-shift/ (replays a recorded real run; run it locally for live fixes)
- **Real pull requests it opened:** [left-pad replaced, with the rejected `padStart` candidate](https://github.com/Rangesh11/haunted-app/pull/1) · [trim@0.0.1 ReDoS (CVE-2020-7753) removed](https://github.com/Rangesh11/haunted-app/pull/2), in the demo target repo [Rangesh11/haunted-app](https://github.com/Rangesh11/haunted-app), where CI passes

## The problem

Most software depends on open-source packages that nobody maintains. When a flaw turns up in one, nobody ships the fix. Scanners tell you a package is dead but fix nothing, and version bots have no newer release to bump to. In a 2026 audit, 93% of commercial codebases contained components with no development in two years (Black Duck OSSRA 2026). Since September 11, 2026, EU law has required makers of digital products to send an early warning within 24 hours of a flaw being actively exploited.

## What it does

```
lockfile ─► 1. Scan ─► 2. Coroner ─┬─► 3a. Inline   (small, permissive licence: copy it in, drop the dependency)
                                   ├─► 3b. Replace  (a built-in or maintained alternative exists)
                                   └─► 3c. Adopt    (no alternative: a human forks it; escalated, not automated)
                                            │
                                   4. Prove ◄┘  fast-check: old and new code must agree on generated inputs
                                      │  ✗ rejected candidate → try the next one, or escalate with the counterexample
                                      ▼
                                   5. Pull request (diff, proof table, replay test, risk note, provenance)
                                      ▼
                                   6. Warden keeper (watches advisories and upstream releases, remembers decisions)
```

On the bundled `examples/haunted-app`, from a real run:

| Package | Why it's dead | Route | Proof |
| --- | --- | --- | --- |
| `trim@0.0.1` | deprecated, archived, ReDoS advisory GHSA-w5p7-h5w8-2hfq (CVE-2020-7753) | Replace → `String.prototype.trim` | 2,001 inputs agree; 20k-space input takes about 640 ms in the old code, under 0.1 ms in the new |
| `left-pad@1.3.0` | deprecated, archived repo | Replace | `padStart` **rejected**: `leftPad(0, 2, false)` gives `" 0"` but `padStart` gives `"f0"`. Second candidate proven on 500 inputs |
| `arr-flatten@1.1.0` | no release for 9 years | Replace | `.flat(Infinity)` **rejected**: `[[,]]` gives `[undefined]` vs `[]`. Hole-keeping loop proven |
| `repeat-string@1.6.1` | no release for 10 years | Replace | `.repeat()` **rejected**: `("", -1)` gives `""` vs a RangeError. Guarded version proven |
| `object-assign@4.1.1`, `xtend@4.0.2` | dormant ponyfills | Replace → `Object.assign` | 1,000 / 500 inputs agree |
| `is-number@7.0.0` | no release for 8 years, no built-in equivalent | Inline (MIT licence and provenance copied) | 1,000 inputs agree |
| `request@2.88.2` | deprecated, 20 dependencies | Escalated: migrate to `fetch` by hand | not automated: the API is too broad to rewrite safely |

Naive replacements, including the ones the deprecation notices suggest, failed for three of the seven packages. That is why every fix has to pass the proof before it becomes a pull request.

### On real projects

| Project | Packages | Zombies | Chosen directly |
| --- | ---: | ---: | ---: |
| mozilla/pdf.js | 822 | 232 (28%) | 6 |
| jitsi/jitsi-meet | 1,700 | 593 (35%) | 60 |
| bitwarden/clients | 2,640 | 755 (29%) | 39 |

These scans ran on November 18, 2026 without GitHub checks, so archived repos are undercounted. Method, caveats and a false positive these scans found (now fixed) are in [docs/REAL-WORLD.md](docs/REAL-WORLD.md).

## Quick start (3 steps)

Requires Node.js 22.13 or later (CI uses 24) and git.

```bash
npm install
```

```bash
npm run example:install
```

```bash
npm start
```

Open http://localhost:8787, click **Scan example project**, pick a tombstone and click **Resurrect**.

For development with hot reload, run `npm run dev` (UI on :5173, API on :8787). It works offline too: `GRAVEYARD_OFFLINE=1 npm start` uses the registry and advisory snapshot in `fixtures/cache/`.

## CLI

```bash
node bin/graveyard.mjs scan examples/haunted-app
```

```bash
node bin/graveyard.mjs resurrect left-pad --dir examples/haunted-app
```

| Command | What it does |
| --- | --- |
| `scan [dir] [--all] [--json]` | Rank the zombies in a project |
| `diagnose <pkg> [--dir d]` | The Coroner's route and reasons |
| `resurrect <pkg> [--dir d] [--runs n] [--open-pr]` | Fix on a scratch branch, prove, write the PR body and patch to `.graveyard/prs/`; `--open-pr` pushes the branch and opens a real GitHub PR (your checkout is not touched) |
| `warden patrol [--dir d] [--simulate pkg]` | Keeper bots check for new advisories and releases |
| `warden status [--dir d]` | What each keeper remembers |
| `serve [--port]` / `mcp` | Web UI and API / MCP server on stdio |

The Surgeon never edits your working tree. It copies the project into `.graveyard/workspaces/<branch>`, commits there, and writes a `git format-patch` file you can apply with `git am`.

## How the proof works

1. The original package code comes from your `node_modules` (version-checked) or from the registry tarball, which is hash-checked against the lockfile `integrity`.
2. Each recipe lists candidate replacements, simplest first. For each one, [fast-check](https://fast-check.dev) generates inputs within the documented API and runs them through both the old and the new code. Outputs must be deep-equal, or both must throw the same error type.
3. The proof runs in a child process under Node's permission model (`--permission`). It can only read the files it needs, cannot write files, start processes or load native addons, and gets an empty environment, so package code never sees your environment secrets. `test/prover.test.ts` checks this. The replay test runs under the same read-only sandbox. Two limits: Node 24's permission model does not block network access, and the project's own `npm test` runs normally (with `PATH` and `HOME` only), because it is your test suite.
4. A rejected candidate keeps its minimal counterexample, and both the PR and the UI show it.
5. The passing proof records 40–160 cases into `graveyard/proofs/<pkg>.golden.json`, plus a `node:test` file that replays them. The behaviour stays guarded after the original package is gone.
6. The project's own `npm test` runs on the branch, and the PR reports the result.

## Built with Kiro

| Kiro feature | Its job here | Where |
| --- | --- | --- |
| Specs | One spec per part (scanner, fix routes, proof engine, warden) plus a bugfix spec for a real bug | `.kiro/specs/` |
| Steering | Safety rules every agent follows: licence first, public API unchanged, smallest diff, provenance, proof before PR | `.kiro/steering/` |
| Hooks | Rescan on lockfile change, run the proofs when a recipe or shim is saved, rerun the score properties, guard `.kiro` from `.gitignore` | `.kiro/hooks/` |
| MCP | Custom server with `npm_registry`, `osv_advisories`, `github_repo_status`, `package_diff`, plus `graveyard_scan`, `graveyard_diagnose`, `graveyard_resurrect`, `warden_patrol`, `warden_memory` | `src/mcp/server.ts`, `.kiro/settings/mcp.json` |
| Custom agents | Coroner (read-only, picks the route), Surgeon (makes the fix), Warden (watches afterwards) | `.kiro/agents/` |
| Powers | MCP server, steering and usage guide packed as an installable Power | `power/graveyard-shift/` |
| Property-based testing | The product's proof engine, and the tests for the scanner itself (score monotonicity, lockfile resolution, codec round-trip) | `src/resurrect/`, `test/` |
| Headless CLI | Surgeon in a GitHub Action via `kiro-cli chat --no-interactive` (written, not yet run: needs a `KIRO_API_KEY` secret) | `.github/workflows/surgeon.yml` |

Tests found three real bugs during the build, one of them by a score property test. All three are documented in `.kiro/specs/bugfix-symlinked-tmpdir/bugfix.md`. A later independent audit found more, which are fixed and covered by `test/hardening.test.ts`.

How it was built: the code in this first version was written with an AI coding assistant (Claude Code) alongside the Kiro specs, steering and hooks in `.kiro/`. Work from here on happens in Kiro, so the hooks and agents run for real.

## Project layout

```
src/core/        lockfile parser, import scanner, registry/OSV/GitHub clients, cache, score, scanner
src/resurrect/   recipes, Coroner, Surgeon, sandboxed prover + runner, golden codec, PR writer, pipeline
src/warden/      keeper memory and patrol
src/server/      HTTP API (+ server-sent events for live runs) and static UI hosting
src/mcp/         MCP server
web/             graveyard map UI (React + Vite); web/public/demo holds a recorded run for static hosting
examples/        haunted-app, the demo target with real abandoned packages
fixtures/cache/  registry/advisory snapshot for offline runs and tests
```

## Hosted demo

Live at https://rangesh11.github.io/graveyard-shift/, deployed by `.github/workflows/pages.yml`. `npm run build` produces the same static site in `web/dist`. With no API behind it, the UI replays the real run recorded in `web/public/demo/` and labels it **Demo data, recorded run**. To refresh the recording, run `npm run demo:record`.

## Limits, honestly

- npm only. The Adopt route is diagnosed and escalated but not automated.
- Equivalence is proven on generated inputs within each package's documented API, not for every possible value. Each PR's risk note says what is covered.
- Six replacement recipes ship today (`left-pad`, `trim`, `object-assign`, `xtend`, `arr-flatten`, `repeat-string`). Any small, permissively licensed package with no runtime dependencies can take the Inline route.
- The keeper runs as a CLI patrol on a schedule (`.github/workflows/warden.yml`). Each fix PR adds its keeper to the committed `graveyard/warden.json`; when a patrol decides something, the workflow saves the memory and any patch draft through a pull request, so decisions persist and are never repeated. A Kiro Crew app with one bot per package is planned.
- Not supported yet: imports under an npm alias (escalated), and packages that are only used through executables, config files or types (escalated, never removed).
- Simulated advisories exist only for the demo and are labelled SIMULATED everywhere they appear.

## Compared with what exists

| Approach | Finds dead packages | Fixes them | Proof in the PR | Watches afterwards | Open source |
| --- | --- | --- | --- | --- | --- |
| Scanners (e.g. Socket alerts) | ✅ | ❌ | n/a | ✅ | varies |
| Version bots (Dependabot, Renovate) | ❌ | only when a newer release exists | ❌ | ✅ | ✅ |
| Paid end-of-life support (HeroDevs, including Evergreen, launched Nov 5, 2026) | ✅ | ✅, built by vendor engineers | not published | ✅ | ❌ |
| Graveyard Shift | ✅ | ✅ for recipes and small packages; others escalated | ✅ property tests + replay file | ✅ | ✅ |

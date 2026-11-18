---
name: graveyard-shift
displayName: Graveyard Shift
description: Find abandoned npm dependencies, fix them by the safest route with property-based proof, and keep watch for new advisories.
keywords:
  - dependencies
  - npm
  - abandoned
  - deprecated
  - unmaintained
  - supply chain
  - lockfile
  - advisories
  - property-based testing
---

# Graveyard Shift

Graveyard Shift gives your agent real data and a proven fix pipeline for dead npm packages: packages that are deprecated, archived or have had no release for two years or more.

- **Scan** a project's `package-lock.json` and rank the zombies by risk, using the npm registry, the OSV advisory database, GitHub repository status, and how often your source imports each package.
- **Diagnose** each zombie: Replace (a proven recipe swaps it for built-in code), Inline (copy a small permissively licensed package into the project with its licence and provenance), or escalate to a human (broad APIs such as `request`, or packages that would need a fork).
- **Resurrect** one package on a scratch git branch. Candidate replacements are tested against the original on generated inputs with fast-check, inside a Node.js permission sandbox. Only a candidate that agrees on every input is kept; rejected ones appear in the pull-request body with their counterexample. A replay test stays in your project.
- **Keep watch** with a Warden that remembers every decision in `.graveyard/warden.json` and drafts patch pull requests when an advisory hits inlined code.

Nothing is published and nothing is merged automatically. Your working tree is never edited: changes live on a branch under `.graveyard/workspaces/`, with the PR body and a patch file in `.graveyard/prs/`.

## Install

Install this Power in Kiro from https://github.com/Rangesh11/graveyard-shift (folder `power/graveyard-shift`). That is the only step: its `mcp.json` starts the server with `npx -y github:Rangesh11/graveyard-shift mcp`, which fetches the tool from GitHub on first use (about 30 seconds). Node.js 22.13 or later and git are required.

To work on the tool itself instead, clone https://github.com/Rangesh11/graveyard-shift, run `npm install`, and point `mcp.json` at `node <clone>/bin/graveyard.mjs mcp`.

Optional: set `GITHUB_TOKEN` for more than 60 repository checks an hour, or `GRAVEYARD_OFFLINE=1` to use cached data only.

## Tools

| Tool | What it does | Changes files? |
| --- | --- | --- |
| `npm_registry` | Latest version, deprecation notices, publish dates, licence, repository, size | No |
| `osv_advisories` | Known advisories for `name@version` pairs, with severity and fixed version | No |
| `github_repo_status` | Repository active, archived or missing; last push | No |
| `package_diff` | Unified diff between two published versions (hash-checked tarballs) | No (cache only) |
| `graveyard_scan` | Zombies in a project, ranked by risk, with reasons | No |
| `graveyard_diagnose` | The route for one package, whether it is automated, and why | No |
| `graveyard_resurrect` | Fix, prove and draft the pull request on a scratch branch | Only `.graveyard/` in the project |
| `warden_patrol` | Check kept packages for new advisories and releases; record decisions; draft patches | Only `.graveyard/` |
| `warden_memory` | Read every keeper's decision history | No |

## Example prompts

- "Scan this project for dead dependencies and tell me the top three by risk."
- "Why is `trim` ranked first? Check the advisory and the repository."
- "Resurrect `left-pad` and show me the counterexample for the candidate that was rejected."
- "Which zombies need a human, and what should we replace `request` with?"
- "Run a Warden patrol and tell me if anything changed since last time."
- "Upstream published a new version of a package we inlined. Diff it against our copy."

## Steering included

- `steering/safety-rules.md`: the rules every fix follows.
- `steering/usage.md`: how to use the tools in order.

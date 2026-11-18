---
inclusion: manual
---

# Using Graveyard Shift

1. **Scan first.** `graveyard_scan` with the project directory (the folder with `package-lock.json`). Zombies come back ranked by risk with reasons, advisories and the files that import them.
2. **Diagnose before fixing.** `graveyard_diagnose` returns the route and `automated`. If `automated` is false, explain the rationale to the user instead of fixing:
   - `viaParent` set: the package is transitive; fix that direct dependency instead.
   - Replace with a `replacement` hint: a human migrates the call sites.
   - Adopt: needs a fork; automation for this route is planned, not built.
3. **Resurrect one package at a time.** `graveyard_resurrect` returns the attempts, the winning candidate, the proof size, and paths to the PR body and patch in `.graveyard/prs/`. Apply the patch to a branch with `git am < <patch>` if the user wants it.
4. **Hand over to the Warden.** Proven fixes are kept automatically. `warden_patrol` checks for new advisories and releases; `warden_memory` shows every past decision.
5. **Check evidence when asked.** `npm_registry`, `osv_advisories`, `github_repo_status` and `package_diff` answer "why" questions with real data.

Supported packages for automatic Replace: left-pad, trim, object-assign, xtend, arr-flatten, repeat-string. Small, dependency-free, permissively licensed packages can be inlined. npm only.

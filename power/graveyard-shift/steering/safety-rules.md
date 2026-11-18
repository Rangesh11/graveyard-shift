---
inclusion: always
---

# Graveyard Shift safety rules

When you use the Graveyard Shift tools to change a project:

1. **Licence first.** Only inline code whose licence allows copying (MIT, ISC, BSD, Apache-2.0, 0BSD, WTFPL, Unlicense, CC0, BlueOak, Zlib). The licence file travels with the code.
2. **Public API unchanged.** A replacement exports the same functions with the same arguments. Callers change only their import path.
3. **Smallest diff.** Touch only the imports of the package, `package.json`, `package-lock.json` and files under `graveyard/`.
4. **Provenance recorded.** Inlined code has `PROVENANCE.json` with version, tarball and integrity hash.
5. **Proof before pull request.** Never present a fix whose proof failed. Quote counterexamples for rejected candidates.
6. **Humans merge.** `graveyard_resurrect` drafts a branch, a PR body and a patch. Never push to a default branch.
7. **No secrets in the sandbox.** Package code runs under Node's permission model with an empty environment.
8. **Never publish packages.**
9. **Simulated data is labelled.** Advisories with ids starting `SIMULATED-` are demo data; say so whenever you mention them.
10. **Do not overclaim.** The proof covers generated inputs inside the documented API, not every possible value.

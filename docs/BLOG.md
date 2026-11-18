---
title: "The proof caught the fix the deprecation notice recommended"
tags: kiro, npm, security, testing
---

*Written for Kiroween 2026, the Kiro hackathon.*

npm marks `left-pad` deprecated with one line of advice: use `String.prototype.padStart()`. So I asked my tool to do exactly that, and its own test rejected the change in three tries:

```
leftPad(0, 2, false)   // left-pad: " 0"
"0".padStart(2, false) // padStart: "f0"
```

left-pad treats a falsy pad as a space. `padStart` turns `false` into the string `"false"` and uses its first letter. Most code never passes `false` there. Some code does, and that is exactly the kind of change nobody notices until a receipt prints `f0`.

## The problem: nobody fixes dead code

I built **Graveyard Shift** for the Resurrection category. It goes after a problem every team has: their software depends on packages nobody maintains.

When I scanned three well-known open-source projects, between 28% and 35% of their installed packages had been deprecated or had not shipped a release in two years. Across the three, 105 of those were dependencies the projects had chosen directly.

Scanners flag these packages. Version bots can't help, because there is no newer release to bump to. If a flaw turns up, nobody ships the fix.

## Find, fix, prove, keep watch

Graveyard Shift works in five steps:

1. **Scan.** It reads the lockfile and scores every package from three sources: registry data (deprecation, last release), OSV advisories, and whether the source repo is archived. It also counts how much of your code imports the package.
2. **Choose a route (the Coroner).** For each zombie it picks the safest route:
   - replace it with a built-in or maintained alternative;
   - inline a small, permissively licensed package together with its licence;
   - or hand it to a human when it can't be automated safely (`request`, for example).
3. **Make the change (the Surgeon).** The change goes on a scratch branch: it rewrites imports and drops the dependency.
4. **Prove it.** fast-check generates hundreds of inputs and runs each through both the original package and the new code. They must agree. If a candidate fails, the next one is tried, and the counterexample goes into the pull request.
5. **Keep watch (the Warden).** A keeper bot checks for new advisories and upstream releases, and remembers every decision.

On the sample app, the proof rejected three naive replacements:

- `padStart` for left-pad;
- `.flat(Infinity)` for arr-flatten, which drops holes in sparse arrays;
- `.repeat()` for repeat-string, which throws on negative counts where the original returns `""`.

Each time, a second, faithful candidate passed. The `trim@0.0.1` replacement also comes with a timing check against its ReDoS flaw: 640 ms in the old regex, under 0.1 ms in the new code.

Two details I care about:

- **The proof runs sandboxed.** It uses Node's permission model: read-only access, no child processes and an empty environment, so dead package code never sees your secrets.
- **The proof stays in the repo.** The passing run records its cases into a small replay test, which keeps guarding the behaviour after the original package is gone.

## How Kiro shaped it

I worked spec-first. Each part (scanner, fix routes, proof engine, warden) has its own requirements, design and task files in `.kiro/specs`. When I hit a real bug, it got a bugfix spec instead of a quick patch. On macOS, `/var` is a symlink, which broke paths both inside the sandbox and on the inline route.

Steering files hold the safety rules every agent follows:

- check the licence first;
- keep the public API unchanged;
- make the smallest possible diff;
- record where the code came from;
- no pull request without a passing proof.

A hook reruns the proofs whenever a recipe or shim is saved. A custom MCP server gives the Coroner, Surgeon and Warden agents real data (registry facts, advisories, repo status, package diffs) instead of guesses. The MCP server, steering and a usage guide are packed into a Power.

My favourite part is that property-based testing is both the product and how I tested the product. The score's own property tests caught a bug where importing a package more often could *lower* its risk.

## Try it

The code is open source (MIT). To run it:

```bash
npm install && npm run example:install && npm start
```

Then open the graveyard map, click a tombstone and press Resurrect.

*Dead code gets a night crew.*

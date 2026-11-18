# Kiroween 2026 submission kit

Category: **Resurrection**. Deadline: December 4, 2:00 pm Pacific (December 5, 3:30 am India). Aim to submit by the evening of December 4, India time.

## Status

| Item | Status |
| --- | --- |
| Scanner, graveyard map, Inline and Replace routes, proof tests, PR output | Built and tested (`npm test`, 38 tests) |
| Keeper (Warden) with memory, scheduled patrol | Built as CLI + `.github/workflows/warden.yml` |
| MCP server, `.kiro` specs/steering/hooks/agents, Power | Written; validate hooks, agents and the Power inside Kiro |
| Hosted demo with sample data | `npm run build` → static `web/dist` replays a recorded real run |
| Adopt route automation, second ecosystem | Not built (stretch); Adopt is diagnosed and escalated |
| Kiro Crew app in a second public repo (Best Kiro CrewApp) | **Not built**: needs the Crew SDK, which launched after this code's reference material |
| Public GitHub repo with MIT licence shown in About | You: create the repo, push, set the licence |
| `.kiro` committed and not in `.gitignore` | Done (`.gitignore` does not list it) |
| Demo video under 3 minutes, public on YouTube | You |
| Blog post (Bonus Blog), Social Blitz post | Drafts in `docs/BLOG.md` and `docs/SOCIAL.md`; you publish them |
| Scan of three real public repos (Impact) | Done: `docs/REAL-WORLD.md` |
| 4,000 Kiro credits request (by Dec 1, 12:00 pm Pacific) | You |

Rules note: the rules ask for real Kiro use and may analyse the `/.kiro` folder. Keep building in Kiro from here (run the specs' remaining tasks, trigger the hooks, use the agents) so the history shows it. Disclose any code that existed before October 30, 2026.

## Devpost description (draft)

**Graveyard Shift: dead code gets a night crew.**

Most software depends on open-source packages nobody maintains, so when a flaw turns up, nobody ships the fix. Graveyard Shift reads a lockfile, finds the zombies, and fixes each one by the safest route: replace it with a built-in or maintained alternative, inline a small package with its licence, or escalate to a human when it cannot be automated safely.

Every fix must pass a proof before it becomes a pull request. fast-check generates inputs and runs them through the original package and the new code in a sandbox; they must agree. On our sample app the proof rejected three naive replacements, including `String.prototype.padStart`, which left-pad's own deprecation notice recommends. `leftPad(0, 2, false)` returns `" 0"`, but `padStart` returns `"f0"`. The passing proof is recorded as a replay test that stays in the repo. After the fix, a Warden keeper watches the package for new advisories and remembers every decision.

Built spec-first in Kiro: four feature specs and a bugfix spec, steering for the safety rules, hooks that rerun the proofs, a custom MCP server, Coroner/Surgeon/Warden agents, and a Power.

## Video script (aim for 2:50)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:20 | `node bin/graveyard.mjs scan examples/haunted-app`: "45 of 55 packages are zombies" | "Most codebases depend on code nobody maintains. Nothing fixes it." |
| 0:20–0:50 | UI: Scan example project. The graveyard draws, and trim carries the red flaw mark | "Graveyard Shift finds the zombies and ranks them by risk. This one has a known ReDoS flaw." |
| 0:50–1:50 | Click left-pad. Show the Coroner verdict, then Resurrect. Candidate 1 (padStart) is rejected with the counterexample, candidate 2 is proven, replay and project tests pass | "The Coroner picks the safest fix. The Surgeon tries what the deprecation notice suggests, and the proof catches it: false becomes the letter f. The second candidate agrees on 500 generated inputs." |
| 1:50–2:15 | PR card: description and diff. Keepers tab, then Simulate advisory on is-number: the patch PR is drafted and the memory updates | "Every fix is a pull request with its proof. A keeper bot stays on watch and remembers every decision." (The simulation is labelled on screen.) |
| 2:15–2:45 | Montage: `.kiro/specs`, steering safety rules, a hook firing on `recipes.ts`, the Power, the MCP tools list | "Built with Kiro: specs, hooks, steering, MCP, a Power, property tests, custom agents." |
| 2:45–2:50 | Repo URL | "Dead code gets a night crew." |

Before recording: run `npm start`, click **Reset**, and use generic words on screen ("package registry"), not brand logos.

## Ideas for proof numbers in the write-up

- From the sample app: 7 of 8 direct zombies fixed automatically, 1 escalated (`request`), and 3 naive candidates rejected by the proof.
- Real projects: 28–35% of installed packages are zombies in pdf.js, jitsi-meet and bitwarden/clients, 105 of them chosen directly (`docs/REAL-WORLD.md`). Rerun with `GITHUB_TOKEN` set before recording, to include archived repos.

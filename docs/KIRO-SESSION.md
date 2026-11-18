# Your Kiro session (about 30 minutes)

Do this in the Kiro IDE (already installed in Applications) with this folder open, signed in. Each step is real work the project still needs. Paste the prompt into Kiro's chat, review what Kiro does, and accept it.

## 1. Check Kiro sees the project (2 min)

- **Specs** panel: 5 specs (zombie-scanner, fix-routes, proof-engine, warden-keeper, bugfix-symlinked-tmpdir).
- **Hooks** panel: 5 hooks.
- **MCP**: server `graveyard-shift` connected. If it fails, run `npm install` in the terminal and retry.

## 2. Add a new replacement recipe (10 min): fires the proof hook

Paste into Kiro chat:

> Following .kiro/steering/recipes.md, add a replacement recipe to src/resurrect/recipes.ts for the abandoned npm package `array-uniq` (major 1 and 2) using `[...new Set(arr)]`. Put a naive candidate first and a faithful one second, with properties limited to the documented API. Then run `npx vitest run test/prover.test.ts` and fix anything that fails.

When Kiro saves `recipes.ts`, the **prove-recipes-on-save** hook should fire. Note what it reports.

## 3. Run a spec task (10 min)

Open `.kiro/specs/proof-engine/tasks.md` and start task 12 ("Count N of M fixes proven across three real public repositories"), or paste:

> Work on task 12 in .kiro/specs/proof-engine/tasks.md. Use the Graveyard Shift MCP tools to diagnose the direct zombies of a real public project, run `graveyard resurrect` on the automated ones in a scratch copy, and record proven / rejected / escalated counts in docs/REAL-WORLD.md. Tick the task when done.

## 4. Use an agent (5 min)

> Act as the Coroner agent (.kiro/agents/coroner.json): use the graveyard_scan and graveyard_diagnose MCP tools on examples/haunted-app and summarise the route for every direct zombie.

## 5. Commit and push (2 min)

Commit from Kiro's Source Control panel with a message that says what Kiro did, then push.

## 6. Make the write-ups true

Edit `docs/BLOG.md` and `docs/SOCIAL.md` so they describe what you actually did in steps 2–4 (for example, what the hook reported). Then record the video from the script in `docs/SUBMISSION.md`.

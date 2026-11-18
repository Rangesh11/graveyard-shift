import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { advisoriesFor } from '../core/osv.ts';
import { getPackageDoc } from '../core/registry.ts';
import type { Advisory, KeeperRecord, ProgressEvent, PullRequestDraft, WardenMemory } from '../core/types.ts';
import { safeName } from '../resurrect/surgeon.ts';
import { loadMemory, remember, saveMemory } from './memory.ts';

export interface PatrolOptions {
  /** Demo only: inject a clearly labelled fake advisory for one kept package. */
  simulate?: { package: string };
  now?: Date;
}

export interface PatrolResult {
  /** True when a decision worth keeping was made (advisory handled, release seen, patch drafted). */
  changed: boolean;
  events: ProgressEvent[];
  memory: WardenMemory;
  drafts: PullRequestDraft[];
}

export function simulatedAdvisory(pkg: string, now: Date): Advisory {
  return {
    id: `SIMULATED-${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`,
    aliases: [],
    summary: `SIMULATED for the demo: prototype pollution in ${pkg} via crafted input`,
    severity: 'high',
    simulated: true,
  };
}

function patchDraft(root: string, keeper: KeeperRecord, advisory: Advisory, upstreamFix?: string): PullRequestDraft {
  const branch = `graveyard/patch-${safeName(keeper.package)}-${advisory.id.toLowerCase()}`;
  const vendorDir = `graveyard/vendor/${safeName(keeper.package)}`;
  const title = `Patch inlined ${keeper.package}@${keeper.version} for ${advisory.id}`;
  const lines = [
    `## 🛡️ Warden patch: ${keeper.package} (${advisory.id})`,
    '',
    advisory.simulated ? '> ⚠️ **This advisory is SIMULATED for a demo. It is not real data.**' : '',
    '',
    `- **Advisory:** ${advisory.summary} (severity: ${advisory.severity})${advisory.url ? ` · [details](${advisory.url})` : ''}`,
    `- **Affected code:** the inlined copy in \`${vendorDir}/\`, adopted ${keeper.adoptedAt.slice(0, 10)} on \`${keeper.branch ?? 'main'}\`.`,
    '',
    '### Plan',
    upstreamFix
      ? `1. Upstream published a fixed version (${upstreamFix}). The Surgeon re-inlines it with the same proof: property tests against ${keeper.package}@${upstreamFix} plus the existing replay cases.`
      : '1. Upstream is dead, so no fixed release will come. The Surgeon agent writes the smallest patch to the inlined copy.',
    '2. Add a regression property that reproduces the advisory, then show it fails before and passes after the patch.',
    `3. Keep the existing replay test (\`graveyard/proofs/${safeName(keeper.package)}.proof.test.js\`) green, so behaviour for normal inputs does not change.`,
    '',
    '### Memory',
    ...keeper.decisions.slice(-5).map((d) => `- ${d.at.slice(0, 16).replace('T', ' ')} · ${d.kind}${d.simulated ? ' (simulated)' : ''}: ${d.summary}`),
    '',
    `_Drafted by the ${keeper.package} Warden. The Surgeon task brief is in \`.graveyard/tasks/\`; a human reviews the result._`,
  ];
  const body = lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
  return {
    title,
    branch,
    body,
    diff: '',
    files: [],
    workspace: root,
    bodyPath: path.join(root, '.graveyard', 'prs', `${safeName(keeper.package)}-${advisory.id.toLowerCase()}.md`),
    patchPath: path.join(root, '.graveyard', 'tasks', `${safeName(keeper.package)}-${advisory.id.toLowerCase()}.md`),
  };
}

/**
 * One patrol: for every kept package, check the advisory database and the
 * registry, decide what each new finding means for this project, and remember
 * the decision so the same advisory is never handled twice.
 */
export async function patrol(root: string, opts: PatrolOptions = {}): Promise<PatrolResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const events: ProgressEvent[] = [];
  const emit = (message: string, data?: unknown) =>
    events.push({ stage: 'warden', message, at: Date.now() - started, ...(data === undefined ? {} : { data }) });
  const memory = await loadMemory(root);
  const drafts: PullRequestDraft[] = [];
  let changed = false;

  if (!memory.keepers.length) {
    emit('No keepers yet. Resurrect a package first; its Warden starts watching after a proven fix.');
    return { changed: false, events, memory, drafts };
  }

  let real = new Map<string, Advisory[]>();
  let advisoriesChecked = true;
  try {
    real = await advisoriesFor(memory.keepers.map((k) => ({ name: k.package, version: k.version })));
  } catch (err) {
    advisoriesChecked = false;
    emit(`Advisory database unreachable: ${(err as Error).message}. Will retry next patrol.`);
  }

  for (const keeper of memory.keepers) {
    const found = [...(real.get(`${keeper.package}@${keeper.version}`) ?? [])];
    if (opts.simulate?.package === keeper.package) found.push(simulatedAdvisory(keeper.package, now));
    const fresh = found.filter((a) => !keeper.seenAdvisories.includes(a.id));

    let latest: string | undefined;
    try {
      latest = (await getPackageDoc(keeper.package)).latest;
    } catch {
      latest = undefined;
    }
    if (latest && keeper.lastKnownUpstream && latest !== keeper.lastKnownUpstream) {
      remember(keeper, { kind: 'release', summary: `Upstream woke up: ${keeper.package}@${latest} published (was ${keeper.lastKnownUpstream}). Review before switching back.` }, now);
      emit(`${keeper.package}: upstream released ${latest}`);
      changed = true;
      keeper.lastKnownUpstream = latest;
    }

    for (const advisory of fresh) {
      keeper.seenAdvisories.push(advisory.id);
      changed = true;
      if (keeper.route === 'replace') {
        remember(
          keeper,
          {
            kind: 'advisory',
            advisoryId: advisory.id,
            simulated: advisory.simulated,
            summary: `${advisory.id}: not affected. The project no longer runs ${keeper.package} code; it was replaced on ${keeper.branch}.`,
          },
          now,
        );
        emit(`${keeper.package}: ${advisory.simulated ? 'simulated advisory ' : ''}${advisory.id} does not affect the project (code replaced)`, advisory);
        continue;
      }
      const fixed = advisory.fixedIn && latest ? advisory.fixedIn : undefined;
      const draft = patchDraft(root, keeper, advisory, fixed);
      await mkdir(path.dirname(draft.bodyPath), { recursive: true });
      await mkdir(path.dirname(draft.patchPath), { recursive: true });
      await writeFile(draft.bodyPath, `# ${draft.title}\n\n${draft.body}\n`);
      await writeFile(
        draft.patchPath,
        [
          `# Surgeon task: patch ${keeper.package}@${keeper.version} for ${advisory.id}`,
          advisory.simulated ? '\nSIMULATED ADVISORY: demo only. Do not ship a change for it.\n' : '',
          `Advisory: ${advisory.summary}`,
          `Code: graveyard/vendor/${safeName(keeper.package)}/`,
          `Rules: follow .kiro/steering/safety-rules.md. Smallest diff, public API unchanged, keep the replay test green, add a property test that reproduces the advisory.`,
          `Branch: ${draft.branch}`,
        ].join('\n'),
      );
      drafts.push(draft);
      remember(
        keeper,
        {
          kind: 'patch-drafted',
          advisoryId: advisory.id,
          simulated: advisory.simulated,
          summary: `${advisory.id} affects the inlined copy. Drafted "${draft.title}" and queued a Surgeon task.`,
        },
        now,
      );
      emit(`${keeper.package}: ${advisory.simulated ? 'simulated advisory ' : ''}${advisory.id} affects the inlined copy; patch PR drafted`, { advisory, title: draft.title });
    }

    keeper.lastPatrol = now.toISOString();
    if (!advisoriesChecked && !fresh.length) {
      remember(keeper, { kind: 'patrol', summary: 'Advisory check skipped: the advisory database could not be reached. Nothing is known to be safe; retrying next patrol.' }, now);
      emit(`${keeper.package}: advisory check skipped (database unreachable)`);
    } else if (!fresh.length) {
      remember(keeper, { kind: 'patrol', summary: `All quiet: ${found.length} known advisories, all handled; upstream latest ${latest ?? 'unknown'}.` }, now);
      emit(`${keeper.package}: all quiet`);
    }
  }

  await saveMemory(root, memory);
  return { changed, events, memory, drafts };
}

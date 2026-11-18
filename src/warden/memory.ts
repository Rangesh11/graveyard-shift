import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KeeperRecord, WardenDecision, WardenMemory } from '../core/types.ts';

// Two homes for keeper memory:
// - graveyard/warden.json is committed. Each fix PR adds its keeper there, so after
//   merge the memory travels with the code and the scheduled patrol can read it.
// - .graveyard/warden.json is local and untracked. It holds keepers for fixes that
//   are only drafted, so the UI and CLI can show them before anything is merged.
export function committedMemoryPath(root: string): string {
  return path.join(root, 'graveyard', 'warden.json');
}

export function localMemoryPath(root: string): string {
  return path.join(root, '.graveyard', 'warden.json');
}

async function readFileMemory(file: string): Promise<WardenMemory | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as WardenMemory;
  } catch {
    return undefined;
  }
}

/** Committed keepers first; local keepers for drafted fixes fill in the rest. */
export async function loadMemory(root: string): Promise<WardenMemory> {
  const committed = await readFileMemory(committedMemoryPath(root));
  const local = await readFileMemory(localMemoryPath(root));
  const keepers: KeeperRecord[] = (committed?.keepers ?? []).map((k) => ({ ...k, committed: true }));
  for (const k of local?.keepers ?? []) {
    if (!keepers.some((c) => c.package === k.package)) keepers.push({ ...k, committed: false });
  }
  return { project: committed?.project ?? local?.project ?? path.basename(root), keepers };
}

/** The project's own name, from package.json, for memory created from scratch. */
async function projectName(root: string): Promise<string> {
  try {
    const name = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name;
    if (typeof name === 'string' && name) return name;
  } catch {
    // fall through
  }
  return path.basename(root);
}

async function writeMemoryFile(file: string, memory: WardenMemory): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const keepers = memory.keepers.map(({ committed: _drop, ...k }) => k);
  await writeFile(file, `${JSON.stringify({ project: memory.project, keepers }, null, 2)}\n`);
}

/** Writes each keeper back to the file it came from. */
export async function saveMemory(root: string, memory: WardenMemory): Promise<void> {
  const committed = memory.keepers.filter((k) => k.committed);
  const local = memory.keepers.filter((k) => !k.committed);
  if (committed.length || existsSync(committedMemoryPath(root))) {
    await writeMemoryFile(committedMemoryPath(root), { project: memory.project, keepers: committed });
  }
  if (local.length || existsSync(localMemoryPath(root))) {
    await writeMemoryFile(localMemoryPath(root), { project: memory.project, keepers: local });
  }
}

export function remember(record: KeeperRecord, decision: Omit<WardenDecision, 'at'>, at = new Date()): void {
  record.decisions.push({ at: at.toISOString(), ...decision });
  // Memory is for decisions, not logs: keep the most recent 50.
  if (record.decisions.length > 50) record.decisions.splice(0, record.decisions.length - 50);
}

type NewKeeper = Omit<KeeperRecord, 'decisions' | 'seenAdvisories' | 'committed'> & { seenAdvisories?: string[] };

function upsert(memory: WardenMemory, record: NewKeeper, summary: string, committed: boolean): KeeperRecord {
  let keeper = memory.keepers.find((k) => k.package === record.package);
  if (!keeper) {
    keeper = { ...record, seenAdvisories: record.seenAdvisories ?? [], decisions: [], committed };
    memory.keepers.push(keeper);
  } else {
    Object.assign(keeper, { ...record, seenAdvisories: [...new Set([...keeper.seenAdvisories, ...(record.seenAdvisories ?? [])])] });
  }
  remember(keeper, { kind: 'adopted', summary });
  return keeper;
}

/** Adds or refreshes a local keeper after a proven fix is drafted. Never touches committed files. */
export async function adopt(root: string, record: NewKeeper, summary: string): Promise<KeeperRecord> {
  const local = (await readFileMemory(localMemoryPath(root))) ?? { project: await projectName(root), keepers: [] };
  const keeper = upsert(local, record, summary, false);
  await writeMemoryFile(localMemoryPath(root), local);
  return keeper;
}

/** Adds the keeper to the committed memory of a fix branch, so merging the PR deploys it. */
export async function adoptCommitted(branchRoot: string, record: NewKeeper, summary: string): Promise<void> {
  const file = committedMemoryPath(branchRoot);
  const memory = (await readFileMemory(file)) ?? { project: await projectName(branchRoot), keepers: [] };
  upsert(memory, record, summary, true);
  await writeMemoryFile(file, memory);
}

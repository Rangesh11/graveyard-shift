import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KeeperRecord, WardenDecision, WardenMemory } from '../core/types.ts';

/** The keeper bots' memory lives in the project, so it travels with the code and shows up in review. */
export function memoryPath(root: string): string {
  return path.join(root, '.graveyard', 'warden.json');
}

export async function loadMemory(root: string): Promise<WardenMemory> {
  try {
    return JSON.parse(await readFile(memoryPath(root), 'utf8')) as WardenMemory;
  } catch {
    return { project: path.basename(root), keepers: [] };
  }
}

export async function saveMemory(root: string, memory: WardenMemory): Promise<void> {
  await mkdir(path.dirname(memoryPath(root)), { recursive: true });
  await writeFile(memoryPath(root), `${JSON.stringify(memory, null, 2)}\n`);
}

export function remember(record: KeeperRecord, decision: Omit<WardenDecision, 'at'>, at = new Date()): void {
  record.decisions.push({ at: at.toISOString(), ...decision });
  // Memory is for decisions, not logs: keep the most recent 50.
  if (record.decisions.length > 50) record.decisions.splice(0, record.decisions.length - 50);
}

/** Adds or refreshes a keeper after a proven fix. */
export async function adopt(root: string, record: Omit<KeeperRecord, 'decisions' | 'seenAdvisories'> & { seenAdvisories?: string[] }, summary: string): Promise<KeeperRecord> {
  const memory = await loadMemory(root);
  let keeper = memory.keepers.find((k) => k.package === record.package);
  if (!keeper) {
    keeper = { ...record, seenAdvisories: record.seenAdvisories ?? [], decisions: [] };
    memory.keepers.push(keeper);
  } else {
    Object.assign(keeper, { ...record, seenAdvisories: [...new Set([...keeper.seenAdvisories, ...(record.seenAdvisories ?? [])])] });
  }
  remember(keeper, { kind: 'adopted', summary });
  await saveMemory(root, memory);
  return keeper;
}

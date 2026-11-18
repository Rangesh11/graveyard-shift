import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';

export const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx']);
// "graveyard" holds code this tool wrote (shims, inlined copies, proofs); its
// own imports must not count as project usage or be rewritten again.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.graveyard', 'graveyard', '.next', 'out']);

/** A module specifier found in source, with the offsets of its text inside the quotes. */
export interface SpecifierHit {
  spec: string;
  start: number;
  end: number;
  line: number;
}

const SPECIFIER_RE = /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

export function findSpecifiers(code: string): SpecifierHit[] {
  const hits: SpecifierHit[] = [];
  for (const m of code.matchAll(SPECIFIER_RE)) {
    const quoteAt = m.index! + m[0].length - m[2].length - 2;
    const start = quoteAt + 1;
    hits.push({ spec: m[2], start, end: start + m[2].length, line: code.slice(0, start).split('\n').length });
  }
  return hits;
}

const BUILTINS = new Set(builtinModules);

/** The npm package a bare specifier points at, or undefined for relative paths and builtins. */
export function packageNameOf(spec: string): string | undefined {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.includes(':')) return undefined;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (BUILTINS.has(name)) return undefined;
  return name;
}

export async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(path.join(dir, entry.name));
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out.sort();
}

export interface UsageIndex {
  /** package name -> relative file path -> number of import sites */
  byPackage: Map<string, Map<string, number>>;
  filesScanned: number;
}

export async function scanUsage(root: string): Promise<UsageIndex> {
  const byPackage = new Map<string, Map<string, number>>();
  const files = await listSourceFiles(root);
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const hit of findSpecifiers(code)) {
      const name = packageNameOf(hit.spec);
      if (!name) continue;
      const perFile = byPackage.get(name) ?? new Map<string, number>();
      perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
      byPackage.set(name, perFile);
    }
  }
  return { byPackage, filesScanned: files.length };
}

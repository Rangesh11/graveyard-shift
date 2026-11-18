import type { Diagnosis, ScannedPackage } from '../core/types.ts';
import { findRecipe, MANUAL_REPLACEMENTS } from './recipes.ts';

/** Licences that allow copying the code into the project with its notice. */
export const PERMISSIVE_LICENSES = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'WTFPL', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Zlib',
]);

/** Inline only small packages: a reviewer must be able to read the whole copy. */
export const INLINE_MAX_BYTES = 32 * 1024;

export function licenseAllowsCopy(license: string | undefined): boolean {
  if (!license) return false;
  // SPDX "OR" expressions: any permissive option is enough.
  return license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/i)
    .some((l) => PERMISSIVE_LICENSES.has(l.trim()));
}

/** The direct dependency that pulls a transitive package in, nearest first. */
export function directAncestor(pkg: ScannedPackage, byName: Map<string, ScannedPackage>): string | undefined {
  const seen = new Set<string>([pkg.name]);
  let frontier = [...pkg.dependents];
  while (frontier.length) {
    const next: string[] = [];
    for (const name of frontier) {
      if (seen.has(name)) continue;
      seen.add(name);
      const p = byName.get(name);
      if (!p) continue;
      if (p.direct) return p.name;
      next.push(...p.dependents);
    }
    frontier = next;
  }
  return undefined;
}

/**
 * The Coroner: picks the safest fix route for one zombie.
 * Order of preference: a proven replacement recipe (removes the code), then
 * inlining a small permissively licensed package (keeps the exact code), then
 * adopting a fork (needs a human).
 */
export function diagnose(pkg: ScannedPackage, all: ScannedPackage[]): Diagnosis {
  const byName = new Map(all.map((p) => [p.name, p]));
  const license = pkg.facts?.license;
  const licenseOk = licenseAllowsCopy(license);
  const base = { package: pkg.name, version: pkg.version, licenseOk };
  const rationale: string[] = [...pkg.score.reasons];

  if (!pkg.direct) {
    const parent = directAncestor(pkg, byName);
    return {
      ...base,
      route: 'replace',
      automated: false,
      viaParent: parent,
      rationale: [
        ...rationale,
        parent
          ? `Transitive: the project does not import it. It arrives through "${parent}", so fixing "${parent}" removes it.`
          : 'Transitive, and no direct dependency was found that pulls it in.',
      ],
    };
  }

  if (pkg.alias) {
    return {
      ...base,
      route: 'replace',
      automated: false,
      rationale: [...rationale, `Installed under the alias "${pkg.alias}", so imports use that name. Automatic rewrites do not handle aliases yet; migrate it by hand.`],
    };
  }

  if (pkg.importedBy.length === 0) {
    return {
      ...base,
      route: 'replace',
      automated: false,
      rationale: [
        ...rationale,
        'No source file imports it. It may be used through an executable in package.json scripts, a config file or type definitions, which the Surgeon cannot redirect, so removing it automatically is unsafe.',
      ],
    };
  }

  const recipe = findRecipe(pkg.name, pkg.version);
  if (recipe) {
    return {
      ...base,
      route: 'replace',
      automated: true,
      recipe: recipe.id,
      replacement: recipe.replacement,
      rationale: [
        ...rationale,
        `A maintained replacement exists: ${recipe.replacement}. ${recipe.summary}`,
        `${recipe.candidates.length} candidate${recipe.candidates.length === 1 ? '' : 's'} will be proven against the original before any change is kept.`,
      ],
    };
  }

  const manual = MANUAL_REPLACEMENTS[pkg.name];
  const size = pkg.facts?.unpackedSize;
  const runtimeDeps = pkg.dependencies.length;
  const small = size === undefined ? (pkg.facts?.fileCount ?? 0) <= 12 : size <= INLINE_MAX_BYTES;

  if (!manual && runtimeDeps === 0 && small && licenseOk) {
    return {
      ...base,
      route: 'inline',
      automated: true,
      rationale: [
        ...rationale,
        `Small (${size ? `${(size / 1024).toFixed(1)} KB` : 'few files'}), no runtime dependencies and licensed ${license}: copy it into the project with its licence and drop the dependency.`,
        'No built-in or maintained replacement is known, so the exact code is kept.',
      ],
    };
  }

  if (manual) {
    return {
      ...base,
      route: 'replace',
      automated: false,
      replacement: manual,
      rationale: [
        ...rationale,
        `Replace with ${manual}. The API is too broad for an automatic, provable rewrite, so a human migrates the call sites.`,
      ],
    };
  }

  return {
    ...base,
    route: 'adopt',
    automated: false,
    rationale: [
      ...rationale,
      runtimeDeps > 0 ? `Has ${runtimeDeps} runtime dependencies, so it cannot be inlined.` : 'Too large to inline and review.',
      licenseOk ? 'Licence allows a fork: fork it, patch known flaws, publish under your scope.' : `Licence "${license ?? 'unknown'}" needs a human check before forking.`,
    ],
  };
}

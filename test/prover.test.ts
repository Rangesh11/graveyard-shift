import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prove } from '../src/resurrect/prover.ts';
import { RECIPES } from '../src/resurrect/recipes.ts';

const NM = path.resolve('examples/haunted-app/node_modules');
const installed = existsSync(NM);
const ENTRY: Record<string, string> = { xtend: 'immutable.js' };
const entryOf = (pkg: string) => path.join(NM, pkg, ENTRY[pkg] ?? 'index.js');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'graveyard-prover-test-'));
});

describe.skipIf(!installed)('proof engine (needs: npm run example:install)', () => {
  for (const recipe of RECIPES) {
    it(`${recipe.package}: only the final candidate is proven equal to the original`, async () => {
      for (const [i, candidate] of recipe.candidates.entries()) {
        const file = path.join(dir, `${recipe.id}-${candidate.id}.cjs`);
        await writeFile(file, candidate.shim);
        const { result } = await prove({ oldPath: entryOf(recipe.package), newPath: file, properties: recipe.properties, candidate: candidate.id, numRuns: 300, golden: 0 });
        const isLast = i === recipe.candidates.length - 1;
        expect(result.passed, `${candidate.id}: ${JSON.stringify(result.properties.filter((p) => !p.passed))}`).toBe(isLast);
        if (!isLast) expect(result.properties.some((p) => p.counterexample)).toBe(true);
      }
    });
  }

  it('rejects a subtly wrong replacement with a minimal counterexample', async () => {
    const file = path.join(dir, 'wrong-trim.cjs');
    // Looks right, but only strips ASCII whitespace.
    await writeFile(file, `module.exports = (s) => s.replace(/^[ \\t\\n\\r]+|[ \\t\\n\\r]+$/g, ''); module.exports.left = (s) => s.trimStart(); module.exports.right = (s) => s.trimEnd();`);
    const recipe = RECIPES.find((r) => r.package === 'trim')!;
    const { result } = await prove({ oldPath: entryOf('trim'), newPath: file, properties: recipe.properties.slice(0, 1), candidate: 'wrong', golden: 0 });
    expect(result.passed).toBe(false);
    expect(result.properties[0].counterexample?.args.length).toBeLessThan(12);
  });

  it('runs package code in a sandbox that cannot write files or read secrets', async () => {
    const target = path.join(dir, 'escaped.txt');
    const evil = path.join(dir, 'evil.cjs');
    await writeFile(
      evil,
      `const fs = require('node:fs');
       module.exports = function trim(s) {
         try { fs.writeFileSync(${JSON.stringify(target)}, 'pwned'); } catch {}
         if (process.env.GRAVEYARD_FAKE_SECRET) throw new Error('env leaked');
         return s.trim();
       };
       module.exports.left = (s) => s.trimStart(); module.exports.right = (s) => s.trimEnd();`,
    );
    const recipe = RECIPES.find((r) => r.package === 'trim')!;
    process.env.GRAVEYARD_FAKE_SECRET = 'should-not-leak';
    const { result } = await prove({ oldPath: entryOf('trim'), newPath: evil, properties: recipe.properties.slice(0, 1), candidate: 'evil', numRuns: 20, golden: 0 });
    expect(result.sandboxed).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(result.passed).toBe(true);
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PullRequestDraft } from '../core/types.ts';
import { git, run } from './git.ts';

/**
 * Opens a real pull request for a proven fix. The patch is applied in a
 * temporary git worktree on a new branch, so the user's checkout and working
 * tree are never touched; the branch is pushed and `gh pr create` opens the
 * PR with the generated body. Requires a GitHub remote and a signed-in gh CLI.
 */
export async function openPullRequest(projectRoot: string, draft: PullRequestDraft, opts: { base?: string; remote?: string } = {}): Promise<string> {
  const remote = opts.remote ?? 'origin';
  const repoRoot = (await git(projectRoot, ['rev-parse', '--show-toplevel'])).trim();
  const subdir = path.relative(repoRoot, path.resolve(projectRoot)).split(path.sep).join('/');
  const base = opts.base ?? (await git(repoRoot, ['symbolic-ref', '--short', 'HEAD'])).trim();

  const remoteUrl = (await git(repoRoot, ['remote', 'get-url', remote]).catch(() => '')).trim();
  if (!/github\.com/.test(remoteUrl)) throw new Error(`Remote "${remote}" is not a GitHub repository; cannot open a pull request.`);
  const branch = draft.branch;
  const exists = (await git(repoRoot, ['ls-remote', '--heads', remote, branch])).trim();
  if (exists) throw new Error(`Branch ${branch} already exists on ${remote}. Close or delete it first.`);

  await git(repoRoot, ['fetch', '-q', remote, base]);
  const wt = path.join(await mkdtemp(path.join(tmpdir(), 'graveyard-pr-')), 'wt');
  await git(repoRoot, ['worktree', 'add', '-q', '-b', branch, wt, `${remote}/${base}`]);
  try {
    const amArgs = ['am', '-q', '--3way'];
    if (subdir) amArgs.push(`--directory=${subdir}`);
    await git(wt, [...amArgs, draft.patchPath]);
    await git(wt, ['push', '-q', '-u', remote, branch]);
    const bodyFile = path.join(path.dirname(wt), 'body.md');
    await writeFile(bodyFile, draft.body);
    const tokens = Object.fromEntries(['GH_TOKEN', 'GITHUB_TOKEN'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const res = await run('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', draft.title, '--body-file', bodyFile], wt, 60_000, tokens);
    if (!res.ok) throw new Error(`gh pr create failed: ${res.output.trim()}`);
    return res.output.trim().split('\n').find((l) => l.startsWith('https://')) ?? res.output.trim();
  } finally {
    await git(repoRoot, ['worktree', 'remove', '--force', wt]).catch(() => {});
    // The branch lives on the remote now; do not leave a stray local branch.
    await git(repoRoot, ['branch', '-D', branch]).catch(() => {});
    await rm(path.dirname(wt), { recursive: true, force: true });
  }
}

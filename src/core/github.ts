import { cached, fetchJson } from './cache.ts';
import type { RepoState } from './types.ts';

const TTL = 24 * 60 * 60 * 1000;

/** owner/repo from the many shapes npm repository URLs take. */
export function parseGitHubRepo(url: string | undefined): { owner: string; repo: string } | undefined {
  if (!url) return undefined;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i) ?? url.match(/^github:([^/]+)\/([^/#]+)$/);
  if (m) return { owner: m[1], repo: m[2] };
  const short = url.match(/^([\w.-]+)\/([\w.-]+)$/);
  return short ? { owner: short[1], repo: short[2] } : undefined;
}

export interface RepoStatus {
  state: RepoState;
  pushedAt?: string;
  stars?: number;
  fullName?: string;
}

/**
 * Whether the source repo is archived, missing or active. Unauthenticated calls
 * are limited to 60 an hour, so set GITHUB_TOKEN for large scans; on a rate
 * limit the state is "unknown" and the score does not count it.
 */
export async function repoStatus(repositoryUrl: string | undefined): Promise<RepoStatus> {
  const parsed = parseGitHubRepo(repositoryUrl);
  if (!parsed) return { state: 'unknown' };
  const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  try {
    return await cached('github', key, TTL, async () => {
      const token = process.env.GITHUB_TOKEN;
      try {
        const r = await fetchJson<{ archived: boolean; pushed_at: string; stargazers_count: number; full_name: string }>(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
          token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
        );
        return {
          state: r.archived ? 'archived' : 'active',
          pushedAt: r.pushed_at,
          stars: r.stargazers_count,
          fullName: r.full_name,
        } satisfies RepoStatus;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return { state: 'missing' } satisfies RepoStatus;
        throw err;
      }
    });
  } catch {
    return { state: 'unknown' };
  }
}

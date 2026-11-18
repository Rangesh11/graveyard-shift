import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Graveyard Shift',
  GIT_AUTHOR_EMAIL: 'surgeon@graveyard-shift.invalid',
  GIT_COMMITTER_NAME: 'Graveyard Shift',
  GIT_COMMITTER_EMAIL: 'surgeon@graveyard-shift.invalid',
};

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    env: { ...process.env, ...AUTHOR, GIT_CONFIG_NOSYSTEM: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 90_000,
  env: NodeJS.ProcessEnv = {},
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, {
      cwd,
      timeout: timeoutMs,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1', ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message };
  }
}

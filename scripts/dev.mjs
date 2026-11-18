// Starts the API (port 8787) and the Vite dev server (port 5173) together.
import { spawn } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const procs = [
  // The API always uses 8787 in dev: the Vite proxy points there, whatever PORT says.
  spawn(npx, ['tsx', 'watch', 'src/server/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: '8787' } }),
  spawn(npx, ['vite', '--config', 'web/vite.config.ts'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) { stop(); process.exit(code); } });

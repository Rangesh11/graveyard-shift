import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { TOOL_ROOT } from '../core/cache.ts';
import { LockfileError } from '../core/lockfile.ts';
import { scan, scanProjectDir } from '../core/scanner.ts';
import type { ScanReport } from '../core/types.ts';
import { diagnose } from '../resurrect/coroner.ts';
import { findPackage, resurrect } from '../resurrect/resurrect.ts';
import { loadMemory } from '../warden/memory.ts';
import { patrol } from '../warden/warden.ts';

/** The demo project the UI scans and resurrects. Pasted lockfiles are scan-only. */
export const EXAMPLE_ROOT = process.env.GRAVEYARD_PROJECT ?? path.join(TOOL_ROOT, 'examples', 'haunted-app');
const WEB_DIST = path.join(TOOL_ROOT, 'web', 'dist');
const VERSION = '0.1.0';
const MAX_BODY = 5 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let exampleReport: ScanReport | undefined;
const busy = new Set<string>();

async function exampleScan(fresh = false): Promise<ScanReport> {
  if (!exampleReport || fresh) exampleReport = await scanProjectDir(EXAMPLE_ROOT);
  return exampleReport;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body is larger than 5 MB.');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Graveyard Shift API is running. Build the UI with "npm run build", or use "npm run dev" for the dev server.');
    return;
  }
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(WEB_DIST, safe);
  if (!file.startsWith(WEB_DIST)) throw new HttpError(403, 'Forbidden');
  const info = await stat(file).catch(() => undefined);
  if (!info || info.isDirectory()) file = path.join(WEB_DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(await readFile(file));
}

async function streamResurrection(req: IncomingMessage, res: ServerResponse, pkgName: string) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (busy.has(pkgName)) {
    write('error', { message: `${pkgName} is already being resurrected.` });
    return res.end();
  }
  busy.add(pkgName);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  try {
    const report = await exampleScan();
    const result = await resurrect(EXAMPLE_ROOT, pkgName, { report, onEvent: (e) => write('progress', e) });
    write('result', result);
  } catch (err) {
    write('error', { message: (err as Error).message });
  } finally {
    clearInterval(heartbeat);
    busy.delete(pkgName);
    res.end();
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/health':
      return send(res, 200, { ok: true, version: VERSION, project: path.basename(EXAMPLE_ROOT) });

    case 'GET /api/scan/example':
      return send(res, 200, await exampleScan(url.searchParams.get('fresh') === '1'));

    case 'POST /api/scan': {
      const body = (await readBody(req)) as { lockfile?: unknown; packageJson?: unknown };
      if (typeof body.lockfile !== 'string' || !body.lockfile.trim()) throw new HttpError(400, 'Paste the contents of a package-lock.json.');
      const packageJson = typeof body.packageJson === 'string' && body.packageJson.trim() ? body.packageJson : undefined;
      try {
        return send(res, 200, await scan({ lockfile: body.lockfile, packageJson }));
      } catch (err) {
        if (err instanceof LockfileError) throw new HttpError(400, err.message);
        throw err;
      }
    }

    case 'GET /api/diagnose': {
      const name = url.searchParams.get('pkg');
      if (!name) throw new HttpError(400, 'Missing ?pkg=');
      const report = await exampleScan();
      const pkg = findPackage(report, name);
      if (!pkg) throw new HttpError(404, `"${name}" is not in the example project.`);
      if (!pkg.score.zombie) throw new HttpError(422, `"${name}" is alive. Version bots handle living packages.`);
      return send(res, 200, diagnose(pkg, report.packages));
    }

    case 'GET /api/resurrect': {
      const name = url.searchParams.get('pkg');
      if (!name) throw new HttpError(400, 'Missing ?pkg=');
      return streamResurrection(req, res, name);
    }

    case 'GET /api/warden':
      return send(res, 200, await loadMemory(EXAMPLE_ROOT));

    case 'POST /api/warden/patrol': {
      const body = (await readBody(req)) as { simulate?: { package?: unknown } };
      const simulate = typeof body.simulate?.package === 'string' ? { package: body.simulate.package } : undefined;
      return send(res, 200, await patrol(EXAMPLE_ROOT, { simulate }));
    }

    case 'POST /api/reset':
      if (busy.size) throw new HttpError(409, 'A resurrection is running. Try again when it finishes.');
      await rm(path.join(EXAMPLE_ROOT, '.graveyard'), { recursive: true, force: true });
      exampleReport = undefined;
      return send(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/')) throw new HttpError(404, `No route ${route}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  return serveStatic(req, res, url.pathname);
}

export function startServer(port: number): Promise<void> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: (err as Error).message });
      else res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`🪦 Graveyard Shift on http://localhost:${port}  (project: ${path.relative(process.cwd(), EXAMPLE_ROOT) || '.'})`);
      resolve();
    });
  });
}

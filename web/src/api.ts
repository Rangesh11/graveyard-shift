// Data layer. Talks to the local Graveyard Shift server when it is running,
// and falls back to recorded snapshots in /demo/ for a static hosted build.
import type {
  Diagnosis,
  ProgressEvent,
  PullRequestDraft,
  ResurrectionResult,
  ScanReport,
  WardenMemory,
} from './types';

export type Mode = 'live' | 'demo';

export interface PatrolResponse {
  events: ProgressEvent[];
  memory: WardenMemory;
  drafts: PullRequestDraft[];
}

export interface DemoResurrection {
  events: ProgressEvent[];
  result: ResurrectionResult;
}

export interface ResurrectHandlers {
  onProgress: (event: ProgressEvent) => void;
  onResult: (result: ResurrectionResult) => void;
  onError: (message: string) => void;
}

/** Longest a recorded run takes to replay in demo mode. */
const DEMO_REPLAY_CAP_MS = 8000;

let modePromise: Promise<Mode> | null = null;

export function detectMode(): Promise<Mode> {
  if (!modePromise) {
    modePromise = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) return 'demo';
        const body = (await res.json()) as { ok?: boolean };
        return body.ok ? 'live' : 'demo';
      } catch {
        return 'demo';
      } finally {
        window.clearTimeout(timer);
      }
    })();
  }
  return modePromise;
}

function demoUrl(file: string): string {
  return `${import.meta.env.BASE_URL}demo/${file}`;
}

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Could not reach the Graveyard Shift server.');
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      throw new Error('The server sent a reply that is not JSON.');
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

async function getDemo<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(demoUrl(file), { cache: 'no-store' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    // Static hosts often answer missing files with index.html.
    if (type.includes('text/html')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function postJSON<T>(url: string, body: unknown): Promise<T> {
  return getJSON<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export async function scanExample(): Promise<ScanReport> {
  if ((await detectMode()) === 'live') return getJSON<ScanReport>('/api/scan/example');
  const report = await getDemo<ScanReport>('scan.json');
  if (!report) throw new Error('The recorded demo scan is missing from this build.');
  return report;
}

export async function scanLockfile(lockfile: string, packageJson?: string): Promise<ScanReport> {
  if ((await detectMode()) === 'demo') {
    throw new Error('Scanning your own lockfile needs the local server (npm start). This hosted demo only has the recorded example scan.');
  }
  return postJSON<ScanReport>('/api/scan', packageJson ? { lockfile, packageJson } : { lockfile });
}

export async function diagnose(pkg: string): Promise<Diagnosis | null> {
  if ((await detectMode()) === 'live') {
    return getJSON<Diagnosis>(`/api/diagnose?pkg=${encodeURIComponent(pkg)}`);
  }
  const all = await getDemo<Record<string, Diagnosis>>('diagnoses.json');
  if (all && all[pkg]) return all[pkg];
  const recorded = await getDemo<DemoResurrection>(`resurrect-${fileSafe(pkg)}.json`);
  return recorded?.result.diagnosis ?? null;
}

/** Starts a resurrection. Returns a function that cancels it. */
export function resurrect(pkg: string, handlers: ResurrectHandlers): () => void {
  let cancelled = false;
  let cleanup: () => void = () => {};

  detectMode().then((mode) => {
    if (cancelled) return;
    cleanup = mode === 'live' ? streamLive(pkg, handlers) : replayDemo(pkg, handlers);
  });

  return () => {
    cancelled = true;
    cleanup();
  };
}

function streamLive(pkg: string, handlers: ResurrectHandlers): () => void {
  const source = new EventSource(`/api/resurrect?pkg=${encodeURIComponent(pkg)}`);
  let finished = false;
  const finish = () => {
    finished = true;
    source.close();
  };

  source.addEventListener('progress', (e) => {
    const data = parse<ProgressEvent>((e as MessageEvent).data);
    if (data) handlers.onProgress(data);
  });
  source.addEventListener('result', (e) => {
    const data = parse<ResurrectionResult>((e as MessageEvent).data);
    finish();
    if (data) handlers.onResult(data);
    else handlers.onError('The server sent a result that could not be read.');
  });
  // The server's own "error" event carries data; the browser's connection
  // error has none.
  source.addEventListener('error', (e) => {
    if (finished) return;
    const raw = (e as MessageEvent).data;
    finish();
    if (typeof raw === 'string' && raw) {
      const data = parse<{ message?: string }>(raw);
      handlers.onError(data?.message ?? raw);
    } else {
      handlers.onError('Lost the connection to the server before the resurrection finished.');
    }
  });

  return finish;
}

function replayDemo(pkg: string, handlers: ResurrectHandlers): () => void {
  const timers: number[] = [];
  let stopped = false;

  getDemo<DemoResurrection>(`resurrect-${fileSafe(pkg)}.json`).then((recorded) => {
    if (stopped) return;
    if (!recorded) {
      handlers.onError(`This hosted demo has no recorded resurrection for ${pkg}. Run Graveyard Shift locally to resurrect it live.`);
      return;
    }
    const events = recorded.events ?? [];
    const last = events.length ? events[events.length - 1].at : 0;
    const scale = last > DEMO_REPLAY_CAP_MS ? DEMO_REPLAY_CAP_MS / last : 1;
    events.forEach((event) => {
      timers.push(window.setTimeout(() => handlers.onProgress(event), Math.round(event.at * scale)));
    });
    timers.push(window.setTimeout(() => handlers.onResult(recorded.result), Math.round(last * scale) + 400));
  });

  return () => {
    stopped = true;
    timers.forEach((t) => window.clearTimeout(t));
  };
}

export async function getWarden(): Promise<WardenMemory> {
  if ((await detectMode()) === 'live') return getJSON<WardenMemory>('/api/warden');
  return (await getDemo<WardenMemory>('warden.json')) ?? { project: 'haunted-app', keepers: [] };
}

export async function patrol(simulatePackage?: string, current?: WardenMemory): Promise<PatrolResponse> {
  if ((await detectMode()) === 'live') {
    return postJSON<PatrolResponse>('/api/warden/patrol', simulatePackage ? { simulate: { package: simulatePackage } } : {});
  }
  if (simulatePackage) {
    const recorded = await getDemo<PatrolResponse>('patrol.json');
    if (recorded) return recorded;
    throw new Error('This hosted demo has no recorded advisory simulation.');
  }
  const memory = current ?? (await getWarden());
  return {
    events: [
      {
        stage: 'warden',
        at: 0,
        message: `Demo patrol: ${memory.keepers.length} keeper${memory.keepers.length === 1 ? '' : 's'} checked against the recorded advisory feed. Nothing new.`,
      },
    ],
    memory,
    drafts: [],
  };
}

export async function reset(): Promise<void> {
  if ((await detectMode()) === 'live') await postJSON<{ ok: boolean }>('/api/reset', {});
}

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Scoped names like @scope/pkg become scope__pkg in demo file names. */
export function fileSafe(pkg: string): string {
  return pkg.replace(/^@/, '').replace(/\//g, '__');
}

// Shared types for Graveyard Shift. The web UI imports this file too, so keep it
// free of Node-only imports.

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown';

/** One installed package from a lockfile, deduplicated by name@version. */
export interface LockedPackage {
  name: string;
  version: string;
  /** Install paths inside node_modules, e.g. ["node_modules/request/node_modules/uuid"]. */
  paths: string[];
  /** Listed in the root package.json dependencies or devDependencies. */
  direct: boolean;
  dev: boolean;
  /** Lockfile integrity string (sha512-...), when present. */
  integrity?: string;
  resolved?: string;
  /** Names of locked packages that depend on this one. */
  dependents: string[];
  /** Runtime dependency names declared by this package. */
  dependencies: string[];
}

export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  url?: string;
  /** First version that is not affected, when the advisory names one. */
  fixedIn?: string;
  /** True when the advisory feed is a demo simulation, never real data. */
  simulated?: boolean;
}

export type RepoState = 'active' | 'archived' | 'missing' | 'unknown';

export interface RegistryFacts {
  latest: string;
  /** Deprecation message on the installed version, if any. */
  deprecated?: string;
  /** Deprecation message on the latest version, if any. */
  latestDeprecated?: string;
  lastPublish: string; // ISO date of the latest version
  installedPublish?: string; // ISO date of the installed version
  license?: string;
  repositoryUrl?: string;
  unpackedSize?: number;
  fileCount?: number;
  maintainers: number;
}

export interface Signals {
  deprecated: boolean;
  daysSinceLastPublish: number;
  repo: RepoState;
  advisories: Advisory[];
  /** Number of import/require sites in the scanned source. */
  usageSites: number;
  /** Number of source files that import it. */
  usageFiles: number;
  direct: boolean;
  dependents: number;
}

export type Status = 'alive' | 'dormant' | 'deprecated' | 'archived';

export interface Score {
  status: Status;
  /** 0..1, how dead the package is. */
  deadness: number;
  /** 0..100, how much the dead package endangers the project. */
  risk: number;
  /** Zombie = dead enough that nobody will ship a fix. */
  zombie: boolean;
  reasons: string[];
}

export interface ScannedPackage extends LockedPackage {
  facts?: RegistryFacts;
  signals: Signals;
  score: Score;
  /** Source files that import it, relative to the project root. */
  importedBy: string[];
  /** Set when a lookup failed; the score then uses what is known. */
  error?: string;
}

export interface ScanReport {
  project: string;
  scannedAt: string;
  lockfileVersion: number;
  totals: {
    packages: number;
    direct: number;
    zombies: number;
    directZombies: number;
    withAdvisories: number;
  };
  /** Sorted by risk, highest first. */
  packages: ScannedPackage[];
  /** True when source files were scanned for usage (not a pasted lockfile). */
  usageScanned: boolean;
  offline: boolean;
  warnings: string[];
}

// ---------- Resurrection ----------

export type Route = 'inline' | 'replace' | 'adopt';

export interface Diagnosis {
  package: string;
  version: string;
  route: Route;
  /** True when the Surgeon can make the fix without a human. */
  automated: boolean;
  /** For transitive zombies: the direct dependency whose fix removes it. */
  viaParent?: string;
  recipe?: string;
  replacement?: string;
  rationale: string[];
  licenseOk: boolean;
}

export interface ProofCounterexample {
  args: string;
  oldResult: string;
  newResult: string;
}

export interface PropertyResult {
  name: string;
  runs: number;
  passed: boolean;
  seed: number;
  counterexample?: ProofCounterexample;
  error?: string;
}

export interface ProofResult {
  passed: boolean;
  candidate: string;
  properties: PropertyResult[];
  totalRuns: number;
  goldenCases: number;
  durationMs: number;
  sandboxed: boolean;
}

export interface AttemptRecord {
  candidate: string;
  description: string;
  proof: ProofResult;
}

export interface FileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
}

export interface PullRequestDraft {
  title: string;
  branch: string;
  body: string;
  diff: string;
  files: FileChange[];
  workspace: string;
  bodyPath: string;
  patchPath: string;
  url?: string;
}

export interface ResurrectionResult {
  package: string;
  version: string;
  diagnosis: Diagnosis;
  status: 'proven' | 'escalated' | 'failed';
  attempts: AttemptRecord[];
  pr?: PullRequestDraft;
  escalation?: string;
  finishedAt: string;
}

export type Stage = 'coroner' | 'surgeon' | 'prover' | 'pr' | 'warden' | 'done' | 'error';

export interface ProgressEvent {
  stage: Stage;
  message: string;
  /** Milliseconds since the run started. */
  at: number;
  data?: unknown;
}

// ---------- Warden (keeper bot) ----------

export interface WardenDecision {
  at: string;
  kind: 'adopted' | 'patrol' | 'advisory' | 'release' | 'patch-drafted' | 'escalated';
  summary: string;
  advisoryId?: string;
  simulated?: boolean;
}

export interface KeeperRecord {
  package: string;
  version: string;
  route: Route;
  adoptedAt: string;
  branch?: string;
  /** Advisory ids already handled, so the Warden never acts twice. */
  seenAdvisories: string[];
  lastPatrol?: string;
  lastKnownUpstream?: string;
  decisions: WardenDecision[];
}

export interface WardenMemory {
  project: string;
  keepers: KeeperRecord[];
}

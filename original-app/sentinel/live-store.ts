/**
 * Persistent hand-off between the long-running Sentinel watcher, the Next.js
 * API, and the demo attack script. Contains file I/O only — no chain access.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Action, ActionRule } from "../packages/shared/hash";
import type { ViolationReport } from "./report-schema";

export type SentinelPhase =
  | "QUEUED"
  | "DECODING"
  | "SIMULATING"
  | "CLEAN"
  | "VIOLATION"
  | "HALTED"
  | "ERROR";

export interface SentinelSimulationSummary {
  success: boolean;
  reverted: boolean;
  revertReason?: string;
  staticViolations: string[];
  diffSummary: string;
  violationCount: number;
  categories: string[];
  traceSource?: string;
  callCount?: number;
  delegateCallCount?: number;
  tokenTransferCount?: number;
}

export interface SentinelEvent {
  id: string;
  at: string;
  phase: SentinelPhase;
  proposalId: string;
  govId: string | null;
  commitment: string;
  title: string;
  blockNumber: number | null;
  txHash: string | null;
  detail: string;
  reportHash?: string;
  haltTxHash?: string;
  haltBlockNumber?: number;
  report?: ViolationReport;
  simulation?: SentinelSimulationSummary;
}

export type SentinelResultStatus = "OBSERVED" | "CLEAN" | "HALTED" | "ERROR";

export interface SentinelResult {
  proposalId: string;
  govId: string | null;
  commitment: string;
  title: string;
  status: SentinelResultStatus;
  updatedAt: string;
  reason: string;
  reportHash?: string;
  haltTxHash?: string;
  haltBlockNumber?: number;
  report?: ViolationReport;
  simulation?: SentinelSimulationSummary;
}

export interface WatcherState {
  status: "running" | "stopped";
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  lastBlock: number | null;
  rpcUrl: string;
  executor: string;
  guardian: string;
  pollIntervalMs: number;
}

export interface LiveReports {
  version: 1;
  watcher: WatcherState | null;
  events: SentinelEvent[];
  results: Record<string, SentinelResult>;
}

export interface StoredAction {
  target: string;
  value: string;
  data: string;
}

export interface StoredRule {
  kind: number;
  target: string;
  selector: string;
  counterparty: string;
  maxAmount: string;
  codeHash: string;
  childCount: number;
}

export interface ExecutionBundle {
  commitment: string;
  proposalId: string;
  govId: string | null;
  title: string;
  version: string;
  versionHash: string;
  disclosureHash: string;
  createdAt: string;
  source: string;
  actions: StoredAction[];
  rules: StoredRule[];
  /** Optional human labels for addresses, so previews name subjects. */
  labels?: Record<string, string>;
}

export interface ExecutionBundleStore {
  version: 1;
  bundles: Record<string, ExecutionBundle>;
}

const MAX_EVENTS = 500;

export function repositoryRoot(): string {
  const override = process.env.AEGIS_REPO_ROOT;
  if (override) return path.resolve(override);

  const candidates = [process.cwd(), __dirname];
  for (const start of candidates) {
    let dir = path.resolve(start);
    for (let depth = 0; depth < 6; depth++) {
      if (
        fs.existsSync(path.join(dir, "hardhat.config.ts")) &&
        fs.existsSync(path.join(dir, "packages", "shared"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(
    "Could not locate the AegisDAO repository root (set AEGIS_REPO_ROOT if needed)"
  );
}

export function liveReportsFile(): string {
  return path.join(repositoryRoot(), "packages", "shared", "fixtures", "live-reports.json");
}

export function executionBundlesFile(): string {
  return path.join(
    repositoryRoot(),
    "packages",
    "shared",
    "fixtures",
    "execution-bundles.json"
  );
}

export function emptyLiveReports(): LiveReports {
  return { version: 1, watcher: null, events: [], results: {} };
}

export function readLiveReports(): LiveReports {
  const file = liveReportsFile();
  if (!fs.existsSync(file)) return emptyLiveReports();
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LiveReports>;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) {
        throw new Error(`Malformed live reports file: ${file}`);
      }
      return {
        version: 1,
        watcher: parsed.watcher ?? null,
        events: parsed.events,
        results: parsed.results ?? {},
      };
    } catch (error) {
      lastError = error;
      sleepSync(20 * (attempt + 1));
    }
  }
  throw lastError;
}

export function writeLiveReports(reports: LiveReports): void {
  const trimmed: LiveReports = {
    ...reports,
    events: reports.events.slice(-MAX_EVENTS),
  };
  writeJsonAtomic(liveReportsFile(), trimmed);
}

export function appendSentinelEvent(
  reports: LiveReports,
  event: SentinelEvent,
  result?: SentinelResult
): void {
  reports.events.push(event);
  if (result) {
    reports.results[result.commitment.toLowerCase()] = result;
  }
}

export function emptyExecutionBundles(): ExecutionBundleStore {
  return { version: 1, bundles: {} };
}

export function readExecutionBundles(): ExecutionBundleStore {
  const file = executionBundlesFile();
  if (!fs.existsSync(file)) return emptyExecutionBundles();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ExecutionBundleStore>;
  if (!parsed || parsed.version !== 1 || typeof parsed.bundles !== "object") {
    throw new Error(`Malformed execution bundle file: ${file}`);
  }
  return { version: 1, bundles: parsed.bundles ?? {} };
}

export function getExecutionBundle(commitment: string): ExecutionBundle | null {
  if (!commitment) return null;
  const store = readExecutionBundles();
  return store.bundles[commitment.toLowerCase()] ?? null;
}

export function upsertExecutionBundle(bundle: ExecutionBundle): void {
  const store = readExecutionBundles();
  store.bundles[bundle.commitment.toLowerCase()] = {
    ...bundle,
    commitment: bundle.commitment.toLowerCase(),
  };
  writeJsonAtomic(executionBundlesFile(), store);
}

export function bundleToActions(bundle: ExecutionBundle): Action[] {
  return bundle.actions.map((action) => ({
    target: action.target,
    value: BigInt(action.value),
    data: action.data,
  }));
}

export function bundleToRules(bundle: ExecutionBundle): ActionRule[] {
  return bundle.rules.map((rule) => ({
    kind: Number(rule.kind),
    target: rule.target,
    selector: rule.selector,
    counterparty: rule.counterparty,
    maxAmount: BigInt(rule.maxAmount),
    codeHash: rule.codeHash,
    childCount: Number(rule.childCount),
  }));
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(tmp, payload, "utf8");

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") && attempt < 5) {
        // Next.js polling may briefly hold the destination open on Windows.
        sleepSync(25 * (attempt + 1));
        continue;
      }
      // Fall back to an in-place write rather than losing a Sentinel event.
      fs.writeFileSync(file, payload, "utf8");
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Best effort.
      }
      return;
    }
  }
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Short retry backoff for Windows file replacement.
  }
}

import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const SCENARIO_COUNT = 11;

export interface ScorecardEntry {
  id: string;
  property: string;
  status: "PASS" | "FAIL" | "TEST_REQUIRED";
  testFile: string;
  durationMs: number;
}

export interface DecodedAction {
  target: string;
  targetLabel: string;
  function: string;
  args: Record<string, string>;
  humanText: string;
  nested: DecodedAction[];
}

export interface ViolationReport {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedAction[];
  submitted: DecodedAction[];
  violatedConstraint: { code: string; message: string };
  evidence: {
    commitment: string;
    calldataHash: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    traceRef: string | null;
  };
}

export interface ScenarioReport {
  scenarioId: number;
  scenarioName: string;
  property: string;
  outcome: "Success" | "Executor Revert" | "Sentinel Halt";
  violationReport: ViolationReport;
  rawEvidence: {
    commitment: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    trace: unknown;
  };
}

export interface ArenaRunResult {
  scenarioId: number;
  passed: boolean;
  status: "PASS" | "FAIL";
  durationMs: number;
  exitCode: number | null;
  testFile: string;
  scorecardEntry: ScorecardEntry | null;
  report: ScenarioReport | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Locate the Hardhat repo root. `next dev` runs with cwd = app/, so walk up
 * until hardhat.config.ts and packages/shared are both found.
 */
export function repoRoot(): string {
  const override = process.env.AEGIS_REPO_ROOT;
  if (override) return path.resolve(override);

  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    if (
      existsSync(path.join(dir, "hardhat.config.ts")) &&
      existsSync(path.join(dir, "packages", "shared"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate the AegisDAO repo root (set AEGIS_REPO_ROOT if needed)"
  );
}

export function scorecardFile(): string {
  return path.join(repoRoot(), "packages", "shared", "scorecard.json");
}

export function reportsFile(): string {
  return path.join(
    repoRoot(),
    "packages",
    "shared",
    "fixtures",
    "sentinel-reports.json"
  );
}

export function parseScenarioId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 && id < SCENARIO_COUNT ? id : null;
}

export function readScorecard(): ScorecardEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(scorecardFile(), "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("scorecard.json is not an array");
  }
  return parsed as ScorecardEntry[];
}

export function readReports(): ScenarioReport[] {
  const parsed: unknown = JSON.parse(readFileSync(reportsFile(), "utf8"));
  if (Array.isArray(parsed)) {
    return (parsed as ScenarioReport[]).sort((a, b) => a.scenarioId - b.scenarioId);
  }
  // Backward compatibility with the old keyed-object fixture shape.
  if (parsed && typeof parsed === "object") {
    return Object.values(parsed as Record<string, ScenarioReport>)
      .filter(
        (report) =>
          report && typeof report === "object" && typeof report.scenarioId === "number"
      )
      .sort((a, b) => a.scenarioId - b.scenarioId);
  }
  throw new Error("sentinel-reports.json has an unsupported shape");
}

export function findReport(id: number): ScenarioReport | null {
  return readReports().find((report) => report.scenarioId === id) ?? null;
}

function findTestFile(id: number): string {
  const dir = path.join(repoRoot(), "test", "redteam");
  const prefix = `scenario${id}-`;
  const file = readdirSync(dir).find(
    (name) => name.startsWith(prefix) && name.endsWith(".test.ts")
  );
  if (!file) throw new Error(`No Red-Team test file found for scenario ${id}`);
  return path.join("test", "redteam", file);
}

// Hardhat runs its own in-process network, so parallel runs would race on the
// scorecard file. Serialize arena executions within this server process.
let runQueue: Promise<unknown> = Promise.resolve();

export function runScenario(id: number): Promise<ArenaRunResult> {
  const run = runQueue.then(
    () => executeScenario(id),
    () => executeScenario(id)
  );
  runQueue = run.catch(() => undefined);
  return run;
}

async function executeScenario(id: number): Promise<ArenaRunResult> {
  const root = repoRoot();
  const relativeTestFile = findTestFile(id);
  const testFile = relativeTestFile.split(path.sep).join("/");
  const report = findReport(id);

  const hardhatCli = path.join(
    root,
    "node_modules",
    "hardhat",
    "internal",
    "cli",
    "bootstrap.js"
  );
  if (!existsSync(hardhatCli)) {
    throw new Error(`Hardhat CLI not found at ${hardhatCli}`);
  }

  const started = Date.now();
  const { stdout, stderr, exitCode, timedOut } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
  }>((resolve) => {
    execFile(
      process.execPath,
      [hardhatCli, "test", relativeTestFile],
      {
        cwd: root,
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      },
      (error, out, err) => {
        const timedOut = Boolean((error as { killed?: boolean })?.killed);
        const code = (error as { code?: number | string })?.code;
        resolve({
          stdout: String(out ?? ""),
          stderr: String(err ?? ""),
          exitCode: typeof code === "number" ? code : error ? 1 : 0,
          timedOut,
        });
      }
    );
  });
  const wallMs = Date.now() - started;

  const combined = `${stdout}\n${stderr}`;
  const passed = exitCode === 0 && /\b\d+ passing\b/.test(combined);
  const status: "PASS" | "FAIL" = passed ? "PASS" : "FAIL";
  const durationMs = parseSuiteDuration(combined) ?? wallMs;

  const scorecardEntry = updateScorecard(id, { status, durationMs, testFile });

  return {
    scenarioId: id,
    passed,
    status,
    durationMs,
    exitCode,
    testFile,
    scorecardEntry,
    report,
    stdout,
    stderr,
    error: timedOut ? "Hardhat test timed out after 180s" : undefined,
  };
}

function parseSuiteDuration(output: string): number | null {
  const match = output.match(/(\d+)\s+passing\s+\(([\d.]+)\s*(ms|s)\)/i);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  return match[3].toLowerCase() === "s" ? Math.round(value * 1000) : Math.round(value);
}

function updateScorecard(
  id: number,
  patch: { status: "PASS" | "FAIL"; durationMs: number; testFile: string }
): ScorecardEntry | null {
  const file = scorecardFile();
  const entries = readScorecard();
  const key = `S${id}`;
  const index = entries.findIndex((entry) => entry.id === key);
  const report = findReport(id);

  if (index === -1) {
    entries.push({
      id: key,
      property: report?.property ?? `Scenario ${id}`,
      status: patch.status,
      testFile: patch.testFile,
      durationMs: patch.durationMs,
    });
  } else {
    entries[index] = {
      ...entries[index],
      status: patch.status,
      durationMs: patch.durationMs,
      testFile: patch.testFile,
      property: entries[index].property || report?.property || `Scenario ${id}`,
    };
  }

  entries.sort(
    (a, b) => Number(a.id.replace(/^S/, "")) - Number(b.id.replace(/^S/, ""))
  );

  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n", "utf8");
  renameSync(tmp, file);

  return entries.find((entry) => entry.id === key) ?? null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

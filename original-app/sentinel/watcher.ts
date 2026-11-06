/**
 * AegisDAO Sentinel watcher.
 *
 * Polls ProposalQueued, validates the registered execution bundle against the
 * queued commitment, decodes calldata, runs the bytecode scan + sandboxed
 * simulation, writes a Violation Report, and — only on a violation — asks the
 * guardian key to halt. It never executes or edits a proposal.
 *
 * Run with: npm run sentinel:watch
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import hre, { ethers } from "hardhat";
import type {
  Contract,
  ContractRunner,
  EventLog,
  InterfaceAbi,
  Signer,
} from "ethers";
import {
  computeCommitmentWithActions,
  hashRules,
} from "../packages/shared/hash";
import { decodeAction } from "./decode";
import { buildViolationReport, hashViolationReport } from "./report";
import { simulateProposalExecution } from "./simulate";
import { haltProposal } from "./halt";
import {
  appendSentinelEvent,
  bundleToActions,
  bundleToRules,
  getExecutionBundle,
  liveReportsFile,
  readLiveReports,
  repositoryRoot,
  writeLiveReports,
  type ExecutionBundle,
  type LiveReports,
  type SentinelEvent,
  type SentinelPhase,
  type SentinelResult,
  type SentinelSimulationSummary,
} from "./live-store";

const SENTINEL_NETWORK =
  process.env.SENTINEL_NETWORK ??
  (hre.network.name === "sepolia" ? "sepolia" : "local");
const IS_SEPOLIA = SENTINEL_NETWORK === "sepolia";

const POLL_INTERVAL_MS = Number(
  process.env.SENTINEL_POLL_MS ?? (IS_SEPOLIA ? 12_000 : 1000)
);
const HEARTBEAT_MS = 4000;
const BUNDLE_WAIT_ATTEMPTS = 10;
const BUNDLE_WAIT_MS = 300;
const LOG_CHUNK_SIZE = Number(process.env.SENTINEL_LOG_CHUNK ?? 2000);
const ZERO_ADDRESS = ethers.ZeroAddress;

let watcherLock: string | null = null;

function acquireWatcherLock(): void {
  const file = path.join(
    repositoryRoot(),
    "packages",
    "shared",
    "fixtures",
    "sentinel-watcher.lock"
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        { encoding: "utf8", flag: "wx" }
      );
      watcherLock = file;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: number | null = null;
      try {
        owner = Number(JSON.parse(fs.readFileSync(file, "utf8")).pid) || null;
      } catch {
        // Corrupt or partially written lock: treat it as stale.
      }
      if (owner && processAlive(owner)) {
        throw new Error(
          `Another Sentinel watcher is already running (pid ${owner}). ` +
            `Stop it before starting a second instance.`
        );
      }
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error("Could not acquire the Sentinel watcher lock.");
}

function releaseWatcherLock(): void {
  if (!watcherLock) return;
  try {
    const contents = JSON.parse(fs.readFileSync(watcherLock, "utf8")) as { pid?: number };
    if (contents.pid === process.pid) fs.rmSync(watcherLock, { force: true });
  } catch {
    // Best effort.
  }
  watcherLock = null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface Contracts {
  executor: Contract;
  governor: Contract;
  monitored: {
    treasuryProxy: string;
    feeModule: string;
    executor: string;
    usdc: string;
    vulnerableProxy: string;
  };
  labels: Record<string, string>;
}

interface ManifestContract {
  address: string;
  abi: InterfaceAbi;
  blockNumber?: number;
}

interface Runtime {
  reports: LiveReports;
  contracts: Contracts;
  monitorAccounts: string[];
  simulator: Signer;
  guardian: Signer;
  haltExecutor: Contract;
  chainId: bigint;
  executorAddress: string;
  rpcUrl: string;
  deploymentBlock: number;
  network: string;
  lastBlock: number | null;
  lastHeartbeatWrite: number;
}

interface DeploymentManifest {
  network?: string;
  deploymentBlock?: number;
  contracts: Record<string, ManifestContract>;
}

function loadDeployment(): DeploymentManifest {
  const file = path.join(repositoryRoot(), "deployments", `${SENTINEL_NETWORK}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Deployment manifest not found at ${file}. Deploy to ${SENTINEL_NETWORK} first.`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentManifest;
  if (!manifest.contracts || !manifest.contracts.IntentLockExecutor) {
    throw new Error(`Invalid deployment manifest at ${file}`);
  }
  return manifest;
}

function contract(
  contracts: Record<string, ManifestContract>,
  name: string,
  runner: ContractRunner
): Contract {
  const entry = contracts[name];
  if (!entry?.address || !entry.abi) {
    throw new Error(`Contract ${name} missing from deployments/${SENTINEL_NETWORK}.json`);
  }
  return new ethers.Contract(entry.address, entry.abi, runner);
}

function normalizeKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

function configuredAddresses(): string[] {
  const addresses: string[] = [];
  const envAddressNames = [
    "PROPOSER_ADDRESS",
    "VOTER1_ADDRESS",
    "VOTER2_ADDRESS",
    "VOTER3_ADDRESS",
    "DEV_WALLET_ADDRESS",
    "CHALLENGER_ADDRESS",
  ];
  for (const name of envAddressNames) {
    const value = process.env[name];
    if (value && ethers.isAddress(value)) addresses.push(ethers.getAddress(value));
  }
  for (const keyName of ["PROPOSER_KEY", "VOTER1_KEY", "VOTER2_KEY", "GUARDIAN_KEY"]) {
    const key = process.env[keyName];
    if (!key) continue;
    try {
      addresses.push(new ethers.Wallet(normalizeKey(key)).address);
    } catch {
      // Ignore malformed keys here; signer construction reports them.
    }
  }
  return addresses;
}

function isRetryable(message: string): boolean {
  return /429|rate.?limit|timeout|timed out|SERVER_ERROR|could not coalesce|ECONNRESET|ETIMEDOUT|network error|502|503|504|header not found/i.test(
    message
  );
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 6
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (!isRetryable(message) || attempt === attempts - 1) throw error;
      const wait = Math.min(60_000, 2_000 * 2 ** attempt);
      console.warn(`[sentinel] ${label}: ${message} (retry in ${wait / 1000}s)`);
      await delay(wait);
    }
  }
  throw lastError;
}

function labelsFor(contracts: Record<string, ManifestContract>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [name, entry] of Object.entries(contracts)) {
    if (entry.address) labels[entry.address.toLowerCase()] = name;
  }
  return labels;
}

async function buildRuntime(): Promise<Runtime> {
  const deployment = loadDeployment();
  const contracts = deployment.contracts;
  const provider = ethers.provider;
  const signers = await ethers.getSigners();
  const simulator = signers[0];
  if (!simulator) throw new Error("No signer available for sandbox simulation");

  const executor = contract(contracts, "IntentLockExecutor", provider);
  const governor = contract(contracts, "IntentGovernor", provider);
  const guardianAddress = String(
    await withRetry("guardian", () => executor.guardian())
  );

  let guardian: Signer;
  let haltExecutor: Contract;

  if (IS_SEPOLIA) {
    // Reads (and simulation) run on the FORK=1 Hardhat node; the halt is sent
    // to Sepolia itself with the guardian key.
    const haltUrl =
      process.env.SENTINEL_HALT_RPC_URL ?? process.env.SEPOLIA_RPC_URL;
    if (!haltUrl) {
      throw new Error(
        "SEPOLIA_RPC_URL (or SENTINEL_HALT_RPC_URL) is required to halt on Sepolia."
      );
    }
    const guardianKey = process.env.GUARDIAN_KEY;
    if (!guardianKey) {
      throw new Error("GUARDIAN_KEY is required to halt on Sepolia.");
    }
    const haltNetwork = new ethers.JsonRpcProvider(haltUrl);
    const wallet = new ethers.Wallet(normalizeKey(guardianKey), haltNetwork);
    if (wallet.address.toLowerCase() !== guardianAddress.toLowerCase()) {
      throw new Error(
        `GUARDIAN_KEY resolves to ${wallet.address}, but executor.guardian() is ` +
          `${guardianAddress}. Halt transactions would revert.`
      );
    }
    guardian = wallet;
    haltExecutor = contract(contracts, "IntentLockExecutor", haltNetwork);
    if (process.env.FORK !== "1") {
      console.warn(
        "[sentinel] FORK=1 is not set. Simulation needs evm_snapshot; start the " +
          "watcher on the Sepolia fork (see docs/SEPOLIA.md) for live checks."
      );
    }
  } else {
    const localGuardian = signers.find(
      (signer) => signer.address.toLowerCase() === guardianAddress.toLowerCase()
    );
    if (!localGuardian) {
      throw new Error(
        `Guardian ${guardianAddress} is not one of the unlocked Hardhat signers. ` +
          `The watcher needs the guardian key to halt.`
      );
    }
    guardian = localGuardian;
    haltExecutor = executor;
  }

  const treasuryProxy = String(contracts.TreasuryProxy?.address ?? ZERO_ADDRESS);
  const feeModule = String(contracts.FeeModule?.address ?? ZERO_ADDRESS);
  const usdc = String(contracts.MockUSDC?.address ?? ZERO_ADDRESS);
  const vulnerableProxy = String(contracts.VulnerableProxy?.address ?? ZERO_ADDRESS);
  const executorAddress = await executor.getAddress();
  const network = await withRetry("getNetwork", () => provider.getNetwork());
  const rpcUrl =
    process.env.SENTINEL_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    (hre.network.name === "hardhat" ? "in-process hardhat" : "http://127.0.0.1:8545");
  const deploymentBlock =
    deployment.deploymentBlock ?? contracts.IntentLockExecutor?.blockNumber ?? 0;

  const monitorAccounts = [
    ...new Set([
      ...signers.map((signer) => signer.address),
      ...configuredAddresses(),
    ]),
  ];

  const reports = readLiveReports();
  reports.watcher = {
    status: "running",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    lastBlock: null,
    rpcUrl: IS_SEPOLIA ? `${rpcUrl} -> halt via Sepolia RPC` : rpcUrl,
    executor: executorAddress,
    guardian: guardianAddress,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
  writeLiveReports(reports);

  return {
    reports,
    contracts: {
      executor,
      governor,
      monitored: {
        treasuryProxy,
        feeModule,
        executor: executorAddress,
        usdc,
        vulnerableProxy,
      },
      labels: labelsFor(contracts),
    },
    monitorAccounts,
    simulator,
    guardian,
    haltExecutor,
    chainId: network.chainId,
    executorAddress,
    rpcUrl,
    deploymentBlock,
    network: SENTINEL_NETWORK,
    lastBlock: null,
    lastHeartbeatWrite: 0,
  };
}

function emit(
  runtime: Runtime,
  phase: SentinelPhase,
  input: {
    event: EventLog;
    proposalId: string;
    govId: string | null;
    commitment: string;
    title: string;
    detail: string;
    reportHash?: string;
    haltTxHash?: string;
    haltBlockNumber?: number;
    report?: SentinelEvent["report"];
    simulation?: SentinelSimulationSummary;
    resultStatus?: SentinelResult["status"];
  }
): void {
  const at = new Date().toISOString();
  const event: SentinelEvent = {
    id: randomUUID(),
    at,
    phase,
    proposalId: input.proposalId,
    govId: input.govId,
    commitment: input.commitment,
    title: input.title,
    blockNumber: input.event.blockNumber ?? null,
    txHash: input.event.transactionHash ?? null,
    detail: input.detail,
    reportHash: input.reportHash,
    haltTxHash: input.haltTxHash,
    haltBlockNumber: input.haltBlockNumber,
    report: input.report,
    simulation: input.simulation,
  };

  const resultStatus = input.resultStatus ?? runtime.reports.results[input.commitment.toLowerCase()]?.status ?? "OBSERVED";
  const result: SentinelResult = {
    proposalId: input.proposalId,
    govId: input.govId,
    commitment: input.commitment,
    title: input.title,
    status: resultStatus,
    updatedAt: at,
    reason: input.detail,
    reportHash: input.reportHash,
    haltTxHash: input.haltTxHash,
    haltBlockNumber: input.haltBlockNumber,
    report: input.report,
    simulation: input.simulation,
  };

  appendSentinelEvent(runtime.reports, event, result);
  writeLiveReports(runtime.reports);
  console.log(
    `[sentinel ${at.slice(11, 19)}] ${phase.padEnd(10)} proposal=${input.proposalId} ` +
      `commitment=${short(input.commitment)} ${input.detail}`
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findBundle(commitment: string): Promise<ExecutionBundle | null> {
  for (let attempt = 0; attempt < BUNDLE_WAIT_ATTEMPTS; attempt++) {
    const bundle = getExecutionBundle(commitment);
    if (bundle) return bundle;
    if (attempt < BUNDLE_WAIT_ATTEMPTS - 1) await delay(BUNDLE_WAIT_MS);
  }
  return null;
}

async function resolveGovId(governor: Contract, commitment: string): Promise<string | null> {
  try {
    const govId: bigint = await withRetry("commitmentToGovId", () =>
      governor.commitmentToGovId(commitment)
    );
    return govId > 0n ? govId.toString() : null;
  } catch {
    return null;
  }
}

async function processQueue(runtime: Runtime, event: EventLog): Promise<void> {
  const commitment = String(event.args.commitment);
  const proposalId = BigInt(event.args.proposalId).toString();

  const prior = runtime.reports.results[commitment.toLowerCase()];
  if (prior && (prior.status === "CLEAN" || prior.status === "HALTED")) {
    console.log(
      `[sentinel] replay of ${short(commitment)} ignored (already ${prior.status})`
    );
    return;
  }

  const govId = await resolveGovId(runtime.contracts.governor, commitment);
  const queued = await withRetry("getProposal", () =>
    runtime.contracts.executor.getProposal(commitment)
  );
  const bundle = await findBundle(commitment);
  const title = bundle?.title ?? `Proposal #${proposalId}`;

  emit(runtime, "QUEUED", {
    event,
    proposalId,
    govId,
    commitment,
    title,
    detail:
      `ProposalQueued observed at block ${event.blockNumber}. ` +
      `Guardian ${short(await runtime.guardian.getAddress())} armed in halt-only mode.`,
    resultStatus: "OBSERVED",
  });

  if (Number(queued.state) !== 1) {
    console.log(
      `[sentinel] ${short(commitment)} is in executor state ${Number(queued.state)}; nothing to do.`
    );
    return;
  }

  if (!bundle) {
    emit(runtime, "ERROR", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail:
        `No execution bundle registered for this commitment. The executor stores only hashes, ` +
        `so there is no calldata to decode.`,
      resultStatus: "ERROR",
    });
    return;
  }

  const actions = bundleToActions(bundle);
  const rules = bundleToRules(bundle);

  if (
    BigInt(bundle.proposalId) !== queued.proposalId ||
    BigInt(bundle.version) !== queued.version ||
    bundle.versionHash.toLowerCase() !== String(queued.versionHash).toLowerCase() ||
    bundle.disclosureHash.toLowerCase() !== String(queued.disclosureHash).toLowerCase()
  ) {
    emit(runtime, "ERROR", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail: "Execution bundle metadata does not match the queued proposal.",
      resultStatus: "ERROR",
    });
    return;
  }

  let computedCommitment = "";
  try {
    computedCommitment = computeCommitmentWithActions(
      runtime.chainId,
      runtime.executorAddress,
      queued.proposalId,
      queued.version,
      queued.versionHash,
      actions,
      hashRules(rules),
      queued.disclosureHash
    ).commitment;
  } catch (err) {
    emit(runtime, "ERROR", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail: `Could not hash the execution bundle: ${errorMessage(err)}`,
      resultStatus: "ERROR",
    });
    return;
  }

  if (computedCommitment.toLowerCase() !== commitment.toLowerCase()) {
    emit(runtime, "ERROR", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail:
        `Execution bundle hash ${short(computedCommitment)} does not match the queued ` +
        `commitment ${short(commitment)}. Refusing to simulate unverified calldata.`,
      resultStatus: "ERROR",
    });
    return;
  }

  const decoded = actions.map((action) => decodeAction(action, undefined, runtime.contracts.labels));
  emit(runtime, "DECODING", {
    event,
    proposalId,
    govId,
    commitment,
    title,
    detail:
      `Commitment verified. Decoded ${decoded.length} action(s): ` +
      decoded.map((action) => action.humanText).join(" | "),
    resultStatus: "OBSERVED",
  });

  emit(runtime, "SIMULATING", {
    event,
    proposalId,
    govId,
    commitment,
    title,
    detail:
      "Snapshot opened; executing the verified payload against committed rules, tracing effects, " +
      "then reverting the sandbox. The live proposal is not executed.",
    resultStatus: "OBSERVED",
  });

  try {
    const simulation = await simulateProposalExecution(
      runtime.contracts.executor,
      queued.proposalId,
      queued.version,
      queued.versionHash,
      queued.disclosureHash,
      actions,
      rules,
      runtime.contracts.monitored,
      runtime.monitorAccounts,
      { signer: runtime.simulator, warpToEta: true }
    );

    const report = buildViolationReport(simulation, {
      proposalId,
      scenarioId: `live-P${proposalId}`,
      proposalSaid: bundle.title,
      targetLabels: runtime.contracts.labels,
      layer: "sentinel",
      persist: false,
    });
    const reportHash = hashViolationReport(report);
    const summary = simulationSummary(simulation);

    if (!simulation.shouldHalt) {
      emit(runtime, "CLEAN", {
        event,
        proposalId,
        govId,
        commitment,
        title,
        detail:
          "Simulation passed every static, rule, state-diff, and trace invariant. " +
          "Sandbox reverted; no halt submitted.",
        reportHash,
        report,
        simulation: summary,
        resultStatus: "CLEAN",
      });
      return;
    }

    emit(runtime, "VIOLATION", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail: report.violatedConstraint.message,
      reportHash,
      report,
      simulation: summary,
      resultStatus: "OBSERVED",
    });

    console.log("");
    console.log("SENTINEL GUARDIAN HALT REQUESTED");
    console.log(`  Proposal:    #${proposalId}${govId ? ` (govId ${govId})` : ""}`);
    console.log(`  Commitment:  ${commitment}`);
    console.log(`  Report hash: ${reportHash}`);
    console.log(`  Violation:   ${report.violatedConstraint.code}`);
    console.log("  Authority:   halt-only. The Sentinel never executes or edits the proposal.");
    console.log("");

    const halt = await haltProposal(
      runtime.haltExecutor,
      runtime.guardian,
      commitment,
      report
    );
    const haltedState = Number(
      await withRetry("halted state", () =>
        runtime.contracts.executor.getState(commitment)
      )
    );

    emit(runtime, "HALTED", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail:
        `Guardian halt confirmed in block ${halt.blockNumber}; executor state ${haltedState} (Halted). ` +
        `Simulation detected the violation; the proposal was not executed.`,
      reportHash: halt.reportHash,
      haltTxHash: halt.txHash,
      haltBlockNumber: halt.blockNumber,
      report,
      simulation: summary,
      resultStatus: "HALTED",
    });
    console.log("");
  } catch (err) {
    emit(runtime, "ERROR", {
      event,
      proposalId,
      govId,
      commitment,
      title,
      detail: `Sentinel processing failed: ${errorMessage(err)}`,
      resultStatus: "ERROR",
    });
  }
}

function simulationSummary(simulation: {
  success: boolean;
  reverted: boolean;
  revertReason?: string;
  staticScans?: { violations: string[] }[];
  diffReport: {
    summary: string;
    violations: { category: string }[];
  };
  trace?: {
    source: string;
    calls: unknown[];
    delegateCalls: unknown[];
    tokenTransfers: unknown[];
  };
}): SentinelSimulationSummary {
  const staticViolations = (simulation.staticScans ?? []).flatMap(
    (scan) => scan.violations
  );
  return {
    success: simulation.success,
    reverted: simulation.reverted,
    revertReason: simulation.revertReason,
    staticViolations,
    diffSummary: simulation.diffReport.summary,
    violationCount:
      staticViolations.length + simulation.diffReport.violations.length,
    categories: [
      ...new Set(simulation.diffReport.violations.map((violation) => violation.category)),
    ],
    traceSource: simulation.trace?.source,
    callCount: simulation.trace?.calls.length,
    delegateCallCount: simulation.trace?.delegateCalls.length,
    tokenTransferCount: simulation.trace?.tokenTransfers.length,
  };
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { shortMessage?: string };
    return details.shortMessage ?? details.message;
  }
  return String(error);
}

async function heartbeat(runtime: Runtime, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - runtime.lastHeartbeatWrite < HEARTBEAT_MS) return;
  runtime.lastHeartbeatWrite = now;
  if (runtime.reports.watcher) {
    runtime.reports.watcher.lastHeartbeat = new Date().toISOString();
    runtime.reports.watcher.lastBlock = runtime.lastBlock;
  }
  writeLiveReports(runtime.reports);
}

function stop(runtime: Runtime): void {
  try {
    if (runtime.reports.watcher) {
      runtime.reports.watcher.status = "stopped";
      runtime.reports.watcher.lastHeartbeat = new Date().toISOString();
    }
    writeLiveReports(runtime.reports);
    console.log(`\nSentinel watcher stopped. Results: ${liveReportsFile()}`);
  } catch (err) {
    console.error(`Failed to persist watcher shutdown: ${errorMessage(err)}`);
  } finally {
    releaseWatcherLock();
  }
}

async function main(): Promise<void> {
  acquireWatcherLock();
  const runtime = await buildRuntime();
  const provider = ethers.provider;
  const fromBlockEnv = Number(process.env.SENTINEL_FROM_BLOCK);
  const currentBlock = await withRetry("getBlockNumber", () => provider.getBlockNumber());
  const defaultFrom = runtime.deploymentBlock > 0 ? runtime.deploymentBlock : currentBlock;
  let nextBlock =
    Number.isFinite(fromBlockEnv) && fromBlockEnv >= 0 ? fromBlockEnv : defaultFrom;

  runtime.lastBlock = currentBlock;
  await heartbeat(runtime, true);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[${signal}] Sentinel watcher shutting down.`);
    stop(runtime);
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  console.log("AEGIS SENTINEL WATCHER");
  console.log(`  Network:    ${runtime.network} (chain ${runtime.chainId})`);
  console.log(`  RPC:        ${runtime.rpcUrl}`);
  console.log(`  Executor:   ${runtime.executorAddress}`);
  console.log(`  Guardian:   ${await runtime.guardian.getAddress()} (halt-only)`);
  console.log(`  Watch from: block ${nextBlock} (deployment block ${runtime.deploymentBlock})`);
  console.log(`  Results:    ${liveReportsFile()}`);
  console.log("  Waiting for ProposalQueued events...\n");

  while (!stopping) {
    try {
      const latest = await withRetry("getBlockNumber", () => provider.getBlockNumber());

      while (nextBlock <= latest && !stopping) {
        const toBlock = Math.min(latest, nextBlock + LOG_CHUNK_SIZE - 1);
        const queuedEvents = await withRetry(
          `queryFilter ${nextBlock}-${toBlock}`,
          () =>
            runtime.contracts.executor.queryFilter(
              runtime.contracts.executor.filters.ProposalQueued(),
              nextBlock,
              toBlock
            )
        );
        // Advance only after a successful query; a failed chunk is retried by
        // withRetry without skipping events.
        nextBlock = toBlock + 1;

        for (const event of queuedEvents) {
          if (stopping) break;
          if ("args" in event) {
            await processQueue(runtime, event as EventLog);
          }
          await heartbeat(runtime, true);
        }
      }

      runtime.lastBlock = latest;
      await heartbeat(runtime);
    } catch (err) {
      console.error(`[sentinel] Watcher poll failed: ${errorMessage(err)}`);
      await delay(5_000);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  try {
    const reports = readLiveReports();
    if (reports.watcher) {
      reports.watcher.status = "stopped";
      writeLiveReports(reports);
    }
  } catch {
    // Best effort only.
  }
  releaseWatcherLock();
  process.exitCode = 1;
});

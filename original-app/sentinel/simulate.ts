import { ethers } from "ethers";
import {
  Action,
  ActionRule,
  computeCommitmentWithActions,
  hashRules,
} from "../packages/shared/hash";
import {
  captureStateSnapshot,
  computeStateDiff,
  DiffReport,
  MonitoredContracts,
} from "./diff";
import { BytecodeScanResult, scanBytecode } from "./scan";
import {
  getCallTrace,
  getTraceForCall,
  NormalizedTrace,
} from "./trace";

export interface SimulationResult {
  proposalId: bigint;
  commitment: string;
  commitmentMismatch: boolean;
  success: boolean;
  reverted: boolean;
  revertReason?: string;
  revertData?: string;
  txHash?: string;
  staticScan?: BytecodeScanResult;
  staticScans: BytecodeScanResult[];
  trace?: NormalizedTrace;
  diffReport: DiffReport;
  shouldHalt: boolean;
  haltReason?: string;
  actions: Action[];
  rules: ActionRule[];
}

export interface SimulationOptions {
  signer?: any;
  gasLimit?: bigint;
  blockTag?: string;
  /** Within the snapshot, advance EVM time to the queued proposal's ETA. */
  warpToEta?: boolean;
}

const DEFAULT_GAS_LIMIT = 8_000_000n;
const UPGRADE_TO_SELECTOR = "0x3659cfe6";
const UPGRADE_AND_CALL_SELECTOR = "0x4f1ef286";
const MULTICALL_SELECTOR = "0xac9650d8";

// ─────────────────────────────────────────────────────────────────────────────
// Shared EVM sandbox helpers. Used by the Sentinel simulation and by the
// Pre-vote Effect Preview, so the two never drift on snapshot semantics.
// ─────────────────────────────────────────────────────────────────────────────

/** Open an `evm_snapshot`. Returns the snapshot id, or undefined if unsupported. */
export async function takeSnapshot(provider: any): Promise<string | undefined> {
  try {
    return (await provider.send("evm_snapshot", [])) as string;
  } catch {
    return undefined;
  }
}

/** Restore an `evm_snapshot`. Best effort: a failed revert must not mask errors. */
export async function revertSnapshot(
  provider: any,
  snapshotId: string
): Promise<void> {
  try {
    await provider.send("evm_revert", [snapshotId]);
  } catch {
    // The caller already reports its own failure; a revert hiccup is secondary.
  }
}

/**
 * Impersonate an address and fund it so it can pay gas as `msg.sender`.
 * Both calls are node state (not EVM state), so they survive `evm_revert` and
 * must be undone explicitly with `stopImpersonatingAccount`.
 */
export async function impersonateAccount(
  provider: any,
  address: string,
  wei: bigint = ethers.parseEther("100")
): Promise<void> {
  await provider.send("hardhat_impersonateAccount", [address]);
  await provider.send("hardhat_setBalance", [address, ethers.toBeHex(wei)]);
}

export async function stopImpersonatingAccount(
  provider: any,
  address: string
): Promise<void> {
  try {
    await provider.send("hardhat_stopImpersonatingAccount", [address]);
  } catch {
    // Already stopped, or the node does not keep impersonations.
  }
}

interface ScanCandidate {
  address: string;
  expectedCodeHash?: string;
}

/**
 * Simulate proposal execution in a sandboxed EVM snapshot.
 *
 * 1. Statically scan new targets/implementations for dangerous opcodes
 * 2. Take an `evm_snapshot`
 * 3. Capture pre-execution state
 * 4. Execute the proposal via the real executor (explicit gas limit so the
 *    transaction is mined even when it reverts)
 * 5. Fetch the call trace (`callTracer`, or struct logs on Hardhat EDR)
 * 6. Capture post-execution state, compute the diff and verify invariants
 * 7. `evm_revert` to restore the exact pre-simulation state
 */
export async function simulateProposalExecution(
  executor: any,
  proposalId: bigint,
  version: bigint,
  versionHash: string,
  disclosureHash: string,
  actions: Action[],
  rules: ActionRule[],
  contractsToMonitor: MonitoredContracts,
  accountsToMonitor: string[],
  options: SimulationOptions = {}
): Promise<SimulationResult> {
  const provider =
    options.signer?.provider ??
    (ethers as any).provider ??
    (require("hardhat") as any).ethers?.provider;
  const executorAddress = await executor.getAddress();

  // ── Static scan of new code introduced by the proposal ──
  const monitored = new Set(
    Object.values(contractsToMonitor)
      .filter((v): v is string => typeof v === "string" && ethers.isAddress(v))
      .map((v) => v.toLowerCase())
  );

  const candidates = collectScanCandidates(actions, rules, monitored);
  const staticScans: BytecodeScanResult[] = [];
  for (const candidate of candidates) {
    staticScans.push(
      await scanBytecode(provider, candidate.address, candidate.expectedCodeHash)
    );
  }
  const staticScan = staticScans.find((scan) => scan.violations.length > 0);

  // ── Compute the commitment the supplied actions/rules would produce ──
  let commitment = "";
  try {
    const chainId = (await provider.getNetwork()).chainId;
    commitment = computeCommitmentWithActions(
      chainId,
      executorAddress,
      proposalId,
      version,
      versionHash,
      actions,
      hashRules(rules),
      disclosureHash
    ).commitment;
  } catch {}

  let commitmentMismatch = false;
  if (commitment) {
    try {
      const state = await executor.getState(commitment);
      // ProposalState.Queued === 1
      commitmentMismatch = Number(state) !== 1;
    } catch {}
  }

  const monitoredAccounts = uniqueAddresses([
    ...accountsToMonitor,
    executorAddress,
    contractsToMonitor.executor,
    contractsToMonitor.treasuryProxy,
    contractsToMonitor.vulnerableProxy,
    contractsToMonitor.feeModule,
  ]);

  const codeTargets = uniqueAddresses([
    ...actions.map((a) => a.target),
    ...rules.map((r) => r.target),
    ...rules
      .filter((r) => r.kind === 3 && !isZero(r.codeHash))
      .map((r) => r.counterparty),
    ...candidates.map((c) => c.address),
  ]);

  const gasLimit = options.gasLimit ?? DEFAULT_GAS_LIMIT;
  const callData = executor.interface.encodeFunctionData("execute", [
    proposalId,
    version,
    versionHash,
    disclosureHash,
    actions,
    rules,
  ]);

  let caller = ethers.ZeroAddress;
  try {
    if (options.signer) {
      caller = await options.signer.getAddress();
    } else if (executor.runner && typeof executor.runner.getAddress === "function") {
      caller = await executor.runner.getAddress();
    }
  } catch {}

  let snapshotId: string | undefined;
  let reverted = false;
  let revertReason: string | undefined;
  let revertData = "0x";
  let txHash: string | undefined;
  let trace: NormalizedTrace | undefined;

  try {
    snapshotId = await takeSnapshot(provider);

    if (options.warpToEta && commitment) {
      await warpSnapshotToEta(provider, executor, commitment);
    }

    const preSnapshot = await captureStateSnapshot(
      provider,
      contractsToMonitor,
      monitoredAccounts,
      codeTargets
    );

    const runner = options.signer ? executor.connect(options.signer) : executor;
    try {
      const tx = await runner.execute(
        proposalId,
        version,
        versionHash,
        disclosureHash,
        actions,
        rules,
        { gasLimit }
      );
      const hash = tx.hash as string;
      txHash = hash;
      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) {
        reverted = true;
        revertReason = "Transaction reverted on-chain";
      } else {
        try {
          trace = await getCallTrace(
            provider,
            hash,
            receipt.from ?? caller,
            executorAddress
          );
        } catch {}
      }
    } catch (err: any) {
      reverted = true;
      revertReason = errorMessage(err);
      revertData = extractRevertData(err);
      txHash = extractTxHash(err);
    }

    if (reverted && !trace) {
      try {
        trace = await getTraceForCall(
          provider,
          {
            from: caller,
            to: executorAddress,
            data: callData,
            gas: ethers.toQuantity(gasLimit),
          },
          options.blockTag ?? "latest"
        );
      } catch {}

      if (
        revertData === "0x" &&
        trace?.returnValue &&
        trace.returnValue.length >= 10
      ) {
        revertData = trace.returnValue;
      }
    }

    const postSnapshot = await captureStateSnapshot(
      provider,
      contractsToMonitor,
      monitoredAccounts,
      codeTargets
    );

    const diffReport = computeStateDiff(preSnapshot, postSnapshot, rules, {
      trace,
      contracts: contractsToMonitor,
    });

    const staticHalt = Boolean(staticScan && staticScan.violations.length > 0);
    const shouldHalt =
      staticHalt ||
      diffReport.hasViolations ||
      reverted ||
      commitmentMismatch;

    let haltReason = "";
    if (staticScan?.violations.length) {
      haltReason = `Static bytecode analysis detected: ${staticScan.violations.join("; ")}`;
    } else if (diffReport.hasViolations) {
      haltReason = diffReport.summary;
    } else if (commitmentMismatch) {
      haltReason =
        "Submitted actions/rules do not match a queued commitment (commitment mismatch)";
    } else if (reverted) {
      haltReason = `Execution reverted: ${revertReason}`;
    }

    return {
      proposalId,
      commitment,
      commitmentMismatch,
      success: !shouldHalt,
      reverted,
      revertReason,
      revertData,
      txHash,
      staticScan,
      staticScans,
      trace,
      diffReport,
      shouldHalt,
      haltReason: haltReason || undefined,
      actions,
      rules,
    };
  } finally {
    if (snapshotId) {
      await revertSnapshot(provider, snapshotId);
    }
  }
}

/**
 * Collect code that is newly introduced or not already an approved/monitored
 * contract. Existing monitored contracts (proxies, modules, tokens) are
 * expected to contain CALL/DELEGATECALL, so scanning them would be noise.
 */
function collectScanCandidates(
  actions: Action[],
  rules: ActionRule[],
  monitored: Set<string>
): ScanCandidate[] {
  const candidates = new Map<string, ScanCandidate>();
  const add = (address: string, expectedCodeHash?: string) => {
    if (!ethers.isAddress(address) || isZero(address)) return;
    const key = address.toLowerCase();
    const existing = candidates.get(key);
    if (!existing || (!existing.expectedCodeHash && expectedCodeHash)) {
      candidates.set(key, { address: ethers.getAddress(address), expectedCodeHash });
    }
  };

  const expectedFor = (target: string, address: string): string | undefined => {
    const rule = rules.find(
      (r) =>
        r.kind === 3 && // ActionKind.UPGRADE
        sameAddress(r.target, target) &&
        sameAddress(r.counterparty, address) &&
        !isZero(r.codeHash)
    );
    return rule?.codeHash;
  };

  const inspectCalldata = (target: string, data: string, depth: number) => {
    if (depth > 2 || typeof data !== "string" || !data.startsWith("0x")) return;
    const selector = data.slice(0, 10).toLowerCase();

    if (selector === UPGRADE_TO_SELECTOR || selector === UPGRADE_AND_CALL_SELECTOR) {
      if (data.length >= 74) {
        const impl = ethers.getAddress("0x" + data.slice(34, 74));
        add(impl, expectedFor(target, impl));
      }
      return;
    }

    if (selector === MULTICALL_SELECTOR && data.length > 10) {
      try {
        const [innerCalls] = ethers.AbiCoder.defaultAbiCoder().decode(
          ["bytes[]"],
          "0x" + data.slice(10)
        );
        for (const inner of innerCalls as string[]) {
          inspectCalldata(target, inner, depth + 1);
        }
      } catch {}
    }
  };

  for (const action of actions) {
    if (!monitored.has(action.target.toLowerCase())) {
      const matchingRule = rules.find((r) => sameAddress(r.target, action.target));
      add(
        action.target,
        matchingRule && !isZero(matchingRule.codeHash)
          ? matchingRule.codeHash
          : undefined
      );
    }
    inspectCalldata(action.target, action.data, 0);
  }

  return [...candidates.values()];
}

function errorMessage(err: any): string {
  return err?.shortMessage ?? err?.reason ?? err?.message ?? String(err);
}

/**
 * The watcher observes proposals immediately after queueing, while the real
 * timelock is still active. Advance time only inside the snapshot so the
 * simulation mirrors the timed execution without changing the live chain.
 */
async function warpSnapshotToEta(
  provider: any,
  executor: any,
  commitment: string
): Promise<void> {
  try {
    const [proposal, latestBlock] = await Promise.all([
      executor.getProposal(commitment),
      provider.getBlock("latest"),
    ]);
    const eta = BigInt(proposal.eta ?? 0);
    if (eta > 0n && latestBlock && BigInt(latestBlock.timestamp) < eta) {
      await provider.send("evm_setNextBlockTimestamp", [Number(eta + 1n)]);
    }
  } catch {
    // Best effort: execution still runs against the current sandbox clock.
  }
}

function extractRevertData(err: any): string {
  const candidates = [
    err?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.revert?.data,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
    if (candidate && typeof candidate === "object" && typeof candidate.data === "string") {
      return candidate.data;
    }
  }
  return "0x";
}

function extractTxHash(err: any): string | undefined {
  const hash = err?.transactionHash ?? err?.receipt?.hash ?? err?.txHash;
  return typeof hash === "string" ? hash : undefined;
}

function uniqueAddresses(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || !ethers.isAddress(value)) continue;
    const normalized = ethers.getAddress(value);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function sameAddress(a: string, b: string): boolean {
  if (!ethers.isAddress(a) || !ethers.isAddress(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function isZero(value: string): boolean {
  return !value || /^0x0{40}$/i.test(value) || /^0x0{64}$/i.test(value);
}

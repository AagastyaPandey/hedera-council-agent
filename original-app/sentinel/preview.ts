/**
 * sentinel/preview.ts
 *
 * Pre-vote Effect Preview.
 *
 * Before anyone votes, simulate the EXACT committed calldata in a sandboxed
 * snapshot and report the state changes it would cause, compared with the
 * stated intent (the committed ActionRules rendered in plain English).
 *
 * Deterministic code only — no LLM output. Reuses:
 *   - sentinel/simulate.ts  for snapshot / revert / impersonation helpers
 *   - sentinel/decode.ts    for action and rule decoding
 *   - sentinel/diff.ts      for the EIP-1967 slot constants
 *   - sentinel/scan.ts      for extcodehash + bytecode scanning
 *   - sentinel/trace.ts     for callTracer findings
 *   - sentinel/report.ts    for canonical JSON hashing and the error catalog
 *   - sentinel/live-store.ts for the committed calldata (demo-state bundles)
 *
 * The snapshot is ALWAYS reverted, including on error, so the preview never
 * changes chain state.
 */

import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Action,
  ActionRule,
  ActionKind,
  computeCommitmentWithActions,
  hashActions,
  hashRules,
} from "../packages/shared/hash";
import type {
  DecodedRevert,
  EffectEntry,
  EffectPreview,
  EffectSeverity,
} from "../packages/shared/schemas/effect-preview";
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
} from "./diff";
import {
  decodeAction,
  decodeRule,
  deploymentName,
  getDecoderRegistry,
  labelFor,
} from "./decode";
import {
  bundleToActions,
  bundleToRules,
  getExecutionBundle,
  repositoryRoot,
  type ExecutionBundle,
} from "./live-store";
import { withSnapshotLock } from "./mutex";
import { decodeRevertSelector, stableStringify } from "./report";
import { getExtcodehash, scanBytecode } from "./scan";
import { getCallTrace, type NormalizedTrace } from "./trace";
import {
  impersonateAccount,
  revertSnapshot,
  stopImpersonatingAccount,
  takeSnapshot,
} from "./simulate";

const PREVIEW_GAS_LIMIT = 8_000_000n;
const MAX_TRACE_CALLS = 200;

export interface PreviewOptions {
  provider?: any;
  /** Overrides for tests / callers that already hold contract instances. */
  governor?: any;
  executor?: any;
  /** Overrides the live-store lookup. Must still hash to the committed hashes. */
  bundle?: ExecutionBundle;
  labels?: Record<string, string>;
  noCache?: boolean;
  skipLock?: boolean;
  lockTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider / manifest resolution
// ─────────────────────────────────────────────────────────────────────────────

async function defaultProvider(): Promise<any> {
  const hardhat = tryRequireHardhat();
  if (hardhat?.ethers?.provider) return hardhat.ethers.provider;
  const url =
    process.env.RPC_URL ??
    process.env.SENTINEL_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(url);
}

function tryRequireHardhat(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("hardhat");
  } catch {
    return null;
  }
}

interface Manifest {
  network?: string;
  chainId?: number;
  contracts: Record<string, { address: string; abi: any[] }>;
}

export function loadPreviewManifest(chainId?: number): Manifest | null {
  const dir = path.join(repositoryRoot(), "deployments");
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(dir, name));
  } catch {
    return null;
  }

  // The connected chain decides which manifest describes the committed hashes;
  // NEXT_PUBLIC_CHAIN_ID / SENTINEL_NETWORK only break ties.
  const preferred = path.join(dir, `${deploymentName()}.json`);
  files.sort((a, b) => {
    if (a === preferred) return -1;
    if (b === preferred) return 1;
    return a.localeCompare(b);
  });

  let fallback: Manifest | null = null;
  for (const file of files) {
    let parsed: Manifest;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    } catch {
      continue;
    }
    if (chainId !== undefined && parsed.chainId === chainId) return parsed;
    if (file === preferred) fallback = parsed;
    else if (!fallback) fallback = parsed;
  }
  return chainId === undefined ? fallback : null;
}

function connectFromManifest(
  name: string,
  provider: any,
  manifest: Manifest | null
): any {
  const entry = manifest?.contracts?.[name];
  if (!entry?.address || !Array.isArray(entry.abi)) return null;
  return new ethers.Contract(entry.address, entry.abi, provider);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

const memoryCache = new Map<string, EffectPreview>();

function cacheFile(): string {
  return path.join(
    repositoryRoot(),
    "packages",
    "shared",
    "fixtures",
    "preview-cache.json"
  );
}

function readCache(key: string): EffectPreview | null {
  const memory = memoryCache.get(key);
  if (memory) return memory;
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      EffectPreview
    >;
    const entry = parsed[key];
    if (entry) memoryCache.set(key, entry);
    return entry ?? null;
  } catch {
    return null;
  }
}

function writeCache(key: string, preview: EffectPreview): void {
  memoryCache.set(key, preview);
  try {
    const file = cacheFile();
    let parsed: Record<string, EffectPreview> = {};
    if (fs.existsSync(file)) {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
        string,
        EffectPreview
      >;
    }
    parsed[key] = preview;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  } catch {
    // Cache persistence is best effort; the preview itself is deterministic.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watch list
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFER_SELECTOR = "0xa9059cbb";
const APPROVE_SELECTOR = "0x095ea7b3";
const UPGRADE_TO_SELECTOR = "0x3659cfe6";
const UPGRADE_AND_CALL_SELECTOR = "0x4f1ef286";
const TRANSFER_OWNERSHIP_SELECTOR = "0xf2fde38b";
const MULTICALL_SELECTOR = "0xac9650d8";

interface CalldataAddresses {
  all: string[];
  spenders: string[];
  implementations: string[];
  recipients: string[];
}

/** Addresses named inside calldata, using the decoder registry ABI when known. */
function addressesInCalldata(
  target: string,
  data: string,
  depth = 0
): CalldataAddresses {
  const result: CalldataAddresses = {
    all: [],
    spenders: [],
    implementations: [],
    recipients: [],
  };
  if (typeof data !== "string" || data.length < 10 || depth > 3) return result;
  const selector = data.slice(0, 10).toLowerCase();
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const add = (address: string) => {
    if (!ethers.isAddress(address)) return;
    result.all.push(ethers.getAddress(address));
  };

  try {
    if (selector === TRANSFER_SELECTOR || selector === APPROVE_SELECTOR) {
      const [addr] = coder.decode(
        ["address", "uint256"],
        "0x" + data.slice(10)
      );
      add(addr);
      if (selector === TRANSFER_SELECTOR) result.recipients.push(ethers.getAddress(addr));
      if (selector === APPROVE_SELECTOR) result.spenders.push(ethers.getAddress(addr));
      return result;
    }
    if (selector === UPGRADE_TO_SELECTOR) {
      const [addr] = coder.decode(["address"], "0x" + data.slice(10));
      add(addr);
      result.implementations.push(ethers.getAddress(addr));
      return result;
    }
    if (selector === TRANSFER_OWNERSHIP_SELECTOR) {
      const [addr] = coder.decode(["address"], "0x" + data.slice(10));
      add(addr);
      result.recipients.push(ethers.getAddress(addr));
      return result;
    }
    if (selector === UPGRADE_AND_CALL_SELECTOR) {
      const [addr, inner] = coder.decode(
        ["address", "bytes"],
        "0x" + data.slice(10)
      );
      add(addr);
      result.implementations.push(ethers.getAddress(addr));
      const nested = addressesInCalldata(target, inner as string, depth + 1);
      mergeCalldata(result, nested);
      return result;
    }
    if (selector === MULTICALL_SELECTOR) {
      const [calls] = coder.decode(["bytes[]"], "0x" + data.slice(10));
      for (const call of calls as string[]) {
        mergeCalldata(result, addressesInCalldata(target, call, depth + 1));
      }
      return result;
    }
  } catch {
    // Fall through to the ABI-driven path below.
  }

  // ABI-driven fallback: any address-typed argument of the decoded function.
  const registry = getDecoderRegistry();
  for (const iface of registryInterfaces(registry, target)) {
    let parsed: ethers.TransactionDescription | null = null;
    try {
      parsed = iface.parseTransaction({ data });
    } catch {
      continue;
    }
    if (!parsed) continue;
    parsed.fragment.inputs.forEach((input, index) => {
      if (input.type === "address") {
        const value = parsed!.args[index];
        if (typeof value === "string" && ethers.isAddress(value)) add(value);
      }
    });
    break;
  }
  return result;
}

function mergeCalldata(into: CalldataAddresses, from: CalldataAddresses): void {
  into.all.push(...from.all);
  into.spenders.push(...from.spenders);
  into.implementations.push(...from.implementations);
  into.recipients.push(...from.recipients);
}

function registryInterfaces(registry: any, address: string): ethers.Interface[] {
  const entry = registry?.byAddress?.get(String(address).toLowerCase());
  return entry?.iface ? [entry.iface] : [];
}

interface WatchList {
  contracts: string[];
  accounts: string[];
  tokens: string[];
  spenders: string[];
  implementations: string[];
}

async function buildWatchList(
  provider: any,
  manifest: Manifest | null,
  actions: Action[],
  executorAddress: string,
  decoded: CalldataAddresses
): Promise<WatchList> {
  const contracts = new Set<string>();
  const accounts = new Set<string>();
  const tokens = new Set<string>();
  const spenders = new Set<string>();
  const implementations = new Set<string>();

  for (const action of actions) {
    if (ethers.isAddress(action.target)) contracts.add(ethers.getAddress(action.target));
  }
  for (const address of decoded.all) accounts.add(address);
  for (const spender of decoded.spenders) spenders.add(spender);
  for (const impl of decoded.implementations) implementations.add(impl);

  if (executorAddress && ethers.isAddress(executorAddress)) {
    accounts.add(ethers.getAddress(executorAddress));
  }
  for (const name of [
    "TreasuryProxy",
    "FeeModule",
    "VulnerableProxy",
    "IntentLockExecutor",
    "MockUSDC",
    "GovernanceToken",
    "MaliciousImpl",
  ]) {
    const address = manifest?.contracts?.[name]?.address;
    if (!address || !ethers.isAddress(address)) continue;
    contracts.add(ethers.getAddress(address));
    accounts.add(ethers.getAddress(address));
    if (name === "MockUSDC" || name === "GovernanceToken") {
      tokens.add(ethers.getAddress(address));
    }
  }

  // Any watched contract that answers balanceOf is an ERC-20 we must track.
  for (const candidate of [...contracts, ...accounts]) {
    if (await isErc20(provider, candidate)) tokens.add(candidate);
  }

  return {
    contracts: [...contracts],
    accounts: [...accounts],
    tokens: [...tokens],
    spenders: [...spenders],
    implementations: [...implementations],
  };
}

async function isErc20(provider: any, address: string): Promise<boolean> {
  try {
    const token = new ethers.Contract(
      address,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    );
    const balance = await token.balanceOf(ethers.ZeroAddress);
    return typeof balance === "bigint";
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State capture
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewState {
  eth: Record<string, bigint>;
  token: Record<string, bigint>;
  allowance: Record<string, bigint>;
  owner: Record<string, string>;
  adminSlot: Record<string, string>;
  impl: Record<string, string>;
  beacon: Record<string, string>;
  codeHash: Record<string, string>;
}

function emptyState(): PreviewState {
  return {
    eth: {},
    token: {},
    allowance: {},
    owner: {},
    adminSlot: {},
    impl: {},
    beacon: {},
    codeHash: {},
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { shortMessage?: string };
    return details.shortMessage ?? details.message;
  }
  return String(error);
}

/**
 * Any read we cannot complete is recorded in `unobserved` — including a
 * contract that simply does not implement the function. It is never reported
 * as zero, because we did not observe it.
 */
async function readOptional(
  unobserved: Set<string>,
  phase: string,
  what: string,
  read: () => Promise<any>
): Promise<any> {
  try {
    return await read();
  } catch (error) {
    unobserved.add(`${phase}: could not read ${what}: ${errorMessage(error)}`);
    return null;
  }
}

function slotToAddress(slot: string): string {
  if (!slot || /^0x0+$/.test(slot)) return ethers.ZeroAddress;
  const raw = slot.length >= 42 ? slot.slice(-40) : slot.padStart(66, "0").slice(-40);
  return ethers.getAddress("0x" + raw);
}

async function captureState(
  provider: any,
  watch: WatchList,
  executorAddress: string,
  unobserved: Set<string>,
  phase: string
): Promise<PreviewState> {
  const state = emptyState();

  for (const account of watch.accounts) {
    const balance = await readOptional(
      unobserved,
      phase,
      `ETH balance of ${account}`,
      () => provider.getBalance(account)
    );
    if (balance !== null && balance !== undefined) {
      state.eth[account.toLowerCase()] = BigInt(balance as any);
    }
  }

  for (const contract of watch.contracts) {
    const key = contract.toLowerCase();

    const owner = await readOptional(
      unobserved,
      phase,
      `owner() on ${contract}`,
      async () => {
        const view = new ethers.Contract(
          contract,
          ["function owner() view returns (address)"],
          provider
        );
        return (await view.owner()) as string;
      }
    );
    if (owner) state.owner[key] = ethers.getAddress(owner);

    const slots: [string, string, keyof PreviewState][] = [
      [EIP1967_IMPLEMENTATION_SLOT, "implementation slot", "impl"],
      [EIP1967_ADMIN_SLOT, "admin slot", "adminSlot"],
      [EIP1967_BEACON_SLOT, "beacon slot", "beacon"],
    ];
    for (const [slot, label, bucket] of slots) {
      const raw = await readOptional(
        unobserved,
        phase,
        `${label} of ${contract}`,
        () => provider.getStorage(contract, slot)
      );
      if (typeof raw === "string") {
        (state[bucket] as Record<string, string>)[key] = ethers.getAddress(
          slotToAddress(raw)
        );
      }
    }

    const codeHash = await readOptional(
      unobserved,
      phase,
      `extcodehash of ${contract}`,
      () => getExtcodehash(provider, contract)
    );
    if (typeof codeHash === "string") state.codeHash[key] = codeHash.toLowerCase();
  }

  for (const token of watch.tokens) {
    const erc20 = new ethers.Contract(
      token,
      [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
      ],
      provider
    );
    for (const holder of watch.accounts) {
      const balance = await readOptional(
        unobserved,
        phase,
        `balanceOf(${holder}) on token ${token}`,
        () => erc20.balanceOf(holder)
      );
      if (balance !== null) {
        state.token[`${token.toLowerCase()}:${holder.toLowerCase()}`] = BigInt(balance);
      }
    }

    // Allowance for every spender the proposal touches, from the treasury-side
    // owners the executor can act for.
    const owners = new Set<string>([
      executorAddress.toLowerCase(),
      ...watch.contracts.map((value) => value.toLowerCase()),
    ]);
    for (const owner of owners) {
      for (const spender of watch.spenders) {
        const allowance = await readOptional(
          unobserved,
          phase,
          `allowance(${owner}, ${spender}) on token ${token}`,
          () => erc20.allowance(owner, spender)
        );
        if (allowance !== null) {
          state.allowance[
            `${token.toLowerCase()}:${owner}:${spender.toLowerCase()}`
          ] = BigInt(allowance);
        }
      }
    }
  }

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionOutcome {
  failedAtIndex: number | null;
  revertData: string;
  txs: { txHash: string; target: string; index: number }[];
}

async function executeActions(
  provider: any,
  executorAddress: string,
  actions: Action[]
): Promise<ExecutionOutcome> {
  const txs: ExecutionOutcome["txs"] = [];

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    const value = ethers.toBeHex(action.value ?? 0n);
    const call = {
      from: executorAddress,
      to: action.target,
      value,
      data: action.data,
    };

    // Preflight: eth_call surfaces the revert reason without mining.
    try {
      await provider.call({ ...call, gasLimit: ethers.toBeHex(PREVIEW_GAS_LIMIT) });
    } catch (error) {
      return { failedAtIndex: index, revertData: extractRevertData(error), txs };
    }

    // Apply for real inside the snapshot, as the executor, with a manual gas
    // limit so the transaction is mined even if it reverts.
    const txHash = (await provider.send("eth_sendTransaction", [
      {
        from: executorAddress,
        to: action.target,
        value,
        data: action.data,
        gas: ethers.toBeHex(PREVIEW_GAS_LIMIT),
      },
    ])) as string;

    const receipt = await waitForReceipt(provider, txHash);
    if (!receipt || receipt.status === 0) {
      return { failedAtIndex: index, revertData: "0x", txs };
    }
    txs.push({ txHash, target: action.target, index });
  }

  return { failedAtIndex: null, revertData: "0x", txs };
}

/**
 * Poll for a receipt over raw JSON-RPC. Hardhat's ethers provider wrapper does
 * not implement waitForTransaction, and this must work with a plain
 * JsonRpcProvider too.
 */
async function waitForReceipt(
  provider: any,
  txHash: string,
  timeoutMs = 30_000
): Promise<{ status: number } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      return { status: Number(receipt.status ?? 1) };
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the simulated transaction ${txHash}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function extractRevertData(error: unknown): string {
  const source = error as {
    data?: unknown;
    error?: { data?: unknown };
    info?: { error?: { data?: unknown } };
    revert?: { data?: unknown };
  };
  const candidates = [
    source?.data,
    source?.error?.data,
    source?.info?.error?.data,
    source?.revert?.data,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
    if (candidate && typeof candidate === "object" && typeof (candidate as { data?: string }).data === "string") {
      return (candidate as { data: string }).data;
    }
  }
  return "0x";
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace findings
// ─────────────────────────────────────────────────────────────────────────────

async function collectTraceFindings(
  provider: any,
  executorAddress: string,
  outcome: ExecutionOutcome,
  watch: WatchList,
  unobserved: Set<string>
): Promise<string[]> {
  const findings = new Set<string>();
  const watched = new Set([
    ...watch.contracts.map((value) => value.toLowerCase()),
    ...watch.accounts.map((value) => value.toLowerCase()),
    ...watch.tokens.map((value) => value.toLowerCase()),
  ]);

  let traceAvailable = false;
  for (const tx of outcome.txs) {
    let trace: NormalizedTrace | undefined;
    try {
      trace = await getCallTrace(provider, tx.txHash, executorAddress, tx.target);
    } catch {
      trace = undefined;
    }
    if (!trace) continue;
    traceAvailable = true;

    for (const call of trace.calls.slice(0, MAX_TRACE_CALLS)) {
      if (call.type === "DELEGATECALL" || call.type === "CALLCODE") {
        findings.add(
          `${call.type}: ${call.codeTarget ?? call.to} executes in the context of ${call.to}`
        );
      } else if (call.type === "CREATE" || call.type === "CREATE2") {
        findings.add(`${call.type}: contract deployed by ${call.from}`);
      } else if (call.type === "CALL" && !watched.has(call.to.toLowerCase())) {
        findings.add(`CALL outside the watch list: ${call.to}`);
      }
    }
  }

  if (!traceAvailable) {
    unobserved.add(
      "after: no call trace available for the simulated transactions (the node rejected debug_traceTransaction)"
    );
  }

  // callTracer does not report SELFDESTRUCT frames, so scan the bytecode of any
  // implementation the calldata would install.
  for (const implementation of watch.implementations) {
    try {
      const scan = await scanBytecode(provider, implementation);
      for (const violation of scan.violations) {
        findings.add(`static scan of ${implementation}: ${violation}`);
      }
    } catch (error) {
      unobserved.add(
        `after: could not scan implementation ${implementation}: ${errorMessage(error)}`
      );
    }
  }

  return [...findings].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect classification
// ─────────────────────────────────────────────────────────────────────────────

interface EffectContext {
  labels: Record<string, string>;
  registry: any;
  rules: ActionRule[];
  actions: Action[];
  executorAddress: string;
}

function nameFor(context: EffectContext, address: string): string {
  return labelFor(address, context.registry, context.labels);
}

function ruleIndexFor(
  context: EffectContext,
  predicate: (rule: ActionRule) => boolean
): number | null {
  const index = context.rules.findIndex(predicate);
  return index === -1 ? null : index;
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (!ethers.isAddress(a) || !ethers.isAddress(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function kindOf(rule: ActionRule): number {
  return Number(rule.kind);
}

function signed(value: bigint): string {
  return value > 0n ? `+${value.toString()}` : value.toString();
}

function classify(
  before: PreviewState,
  after: PreviewState,
  context: EffectContext
): EffectEntry[] {
  const effects: EffectEntry[] = [];

  const push = (
    effect: Omit<EffectEntry, "severity"> & { severity: EffectSeverity }
  ) => effects.push(effect);

  // ── Token balances ──
  const tokenKeys = new Set([...Object.keys(before.token), ...Object.keys(after.token)]);
  for (const key of [...tokenKeys].sort()) {
    const beforeValue = before.token[key] ?? 0n;
    const afterValue = after.token[key] ?? 0n;
    if (beforeValue === afterValue) continue;
    const [token, holder] = key.split(":");
    const delta = afterValue - beforeValue;

    // Positive delta: a transfer rule naming this holder as counterparty.
    let matched =
      delta > 0n
        ? ruleIndexFor(
            context,
            (rule) =>
              kindOf(rule) === ActionKind.ERC20_TRANSFER &&
              sameAddress(rule.target, token) &&
              sameAddress(rule.counterparty, holder) &&
              rule.maxAmount >= delta
          )
        : // Negative delta: the outflow side of a committed transfer on this token.
          ruleIndexFor(
            context,
            (rule) =>
              kindOf(rule) === ActionKind.ERC20_TRANSFER &&
              sameAddress(rule.target, token) &&
              !sameAddress(rule.counterparty, holder) &&
              rule.maxAmount >= -delta
          );

    const severity: EffectSeverity = matched !== null ? "EXPECTED" : "UNEXPECTED";
    const holderName = nameFor(context, holder);
    const tokenName = nameFor(context, token);
    push({
      kind: "TOKEN_BALANCE",
      subject: holder,
      label: `${holderName} · ${tokenName}`,
      before: beforeValue.toString(),
      after: afterValue.toString(),
      delta: signed(delta),
      severity,
      matchedRuleIndex: matched,
      explanation:
        matched !== null
          ? `The simulated transfer moves ${Math.abs(Number(delta)).toString()} base units, within committed rule ${matched} (${decodeRule(context.rules[matched], context.registry, context.labels).humanText}).`
          : `${holderName} changes by ${signed(delta)} base units of ${tokenName} with no committed rule naming this move.`,
    });
  }

  // ── Allowances ──
  const allowanceKeys = new Set([
    ...Object.keys(before.allowance),
    ...Object.keys(after.allowance),
  ]);
  for (const key of [...allowanceKeys].sort()) {
    const beforeValue = before.allowance[key] ?? 0n;
    const afterValue = after.allowance[key] ?? 0n;
    if (beforeValue === afterValue) continue;
    const [token, owner, spender] = key.split(":");
    const delta = afterValue - beforeValue;
    const matched = ruleIndexFor(
      context,
      (rule) =>
        kindOf(rule) === ActionKind.ERC20_APPROVE &&
        sameAddress(rule.target, token) &&
        sameAddress(rule.counterparty, spender) &&
        afterValue <= rule.maxAmount
    );
    // An allowance above the committed ceiling is critical, not merely unexpected.
    const overCeiling =
      matched === null ||
      (matched !== null && afterValue > context.rules[matched].maxAmount);
    push({
      kind: "ALLOWANCE",
      subject: spender,
      label: `Allowance ${nameFor(context, owner)} → ${nameFor(context, spender)} · ${nameFor(context, token)}`,
      before: beforeValue.toString(),
      after: afterValue.toString(),
      delta: signed(delta),
      severity: overCeiling ? "CRITICAL" : "EXPECTED",
      matchedRuleIndex: matched,
      explanation: overCeiling
        ? `Allowance rises to ${afterValue.toString()} base units, above the committed ceiling for this spender.`
        : `Within the committed approve rule ${matched}.`,
    });
  }

  // ── Ownership / admin / implementation / code hash ──
  const contracts = new Set([
    ...Object.keys(before.adminSlot),
    ...Object.keys(after.adminSlot),
    ...Object.keys(before.owner),
    ...Object.keys(after.owner),
    ...Object.keys(before.impl),
    ...Object.keys(after.impl),
    ...Object.keys(before.beacon),
    ...Object.keys(after.beacon),
    ...Object.keys(before.codeHash),
    ...Object.keys(after.codeHash),
  ]);

  for (const contract of [...contracts].sort()) {
    const adminBefore = before.adminSlot[contract] ?? ethers.ZeroAddress;
    const adminAfter = after.adminSlot[contract] ?? ethers.ZeroAddress;
    const adminChanged = adminBefore.toLowerCase() !== adminAfter.toLowerCase();

    // The EIP-1967 admin slot is authoritative for proxies; owner() mirrors it.
    if (adminChanged) {
      const matched = ruleIndexFor(
        context,
        (rule) =>
          kindOf(rule) === ActionKind.OWNERSHIP_TRANSFER &&
          sameAddress(rule.target, contract) &&
          sameAddress(rule.counterparty, adminAfter)
      );
      push({
        kind: "ADMIN",
        subject: contract,
        label: `Owner/admin of ${nameFor(context, contract)}`,
        before: adminBefore,
        after: adminAfter,
        delta: null,
        severity: matched !== null ? "EXPECTED" : "CRITICAL",
        matchedRuleIndex: matched,
        explanation:
          matched !== null
            ? `Matches committed ownership rule ${matched}.`
            : `No committed rule transfers ownership or admin of ${nameFor(context, contract)}.`,
      });
    } else {
      const ownerBefore = before.owner[contract];
      const ownerAfter = after.owner[contract];
      if (
        ownerBefore &&
        ownerAfter &&
        ownerBefore.toLowerCase() !== ownerAfter.toLowerCase()
      ) {
        const matched = ruleIndexFor(
          context,
          (rule) =>
            kindOf(rule) === ActionKind.OWNERSHIP_TRANSFER &&
            sameAddress(rule.target, contract) &&
            sameAddress(rule.counterparty, ownerAfter)
        );
        push({
          kind: "OWNERSHIP",
          subject: contract,
          label: `Owner of ${nameFor(context, contract)}`,
          before: ownerBefore,
          after: ownerAfter,
          delta: null,
          severity: matched !== null ? "EXPECTED" : "CRITICAL",
          matchedRuleIndex: matched,
          explanation:
            matched !== null
              ? `Matches committed ownership rule ${matched}.`
              : `Ownership of ${nameFor(context, contract)} changes with no committed rule.`,
        });
      }
    }

    const implBefore = before.impl[contract];
    const implAfter = after.impl[contract];
    if (
      implBefore &&
      implAfter &&
      implBefore.toLowerCase() !== implAfter.toLowerCase()
    ) {
      const matched = ruleIndexFor(
        context,
        (rule) =>
          kindOf(rule) === ActionKind.UPGRADE &&
          sameAddress(rule.target, contract) &&
          sameAddress(rule.counterparty, implAfter)
      );
      push({
        kind: "IMPLEMENTATION",
        subject: contract,
        label: `Implementation of ${nameFor(context, contract)}`,
        before: implBefore,
        after: implAfter,
        delta: null,
        severity: matched !== null ? "EXPECTED" : "CRITICAL",
        matchedRuleIndex: matched,
        explanation:
          matched !== null
            ? `Matches committed upgrade rule ${matched}.`
            : `No committed rule permits upgrading ${nameFor(context, contract)}; the implementation slot changes anyway.`,
      });
    }

    const beaconBefore = before.beacon[contract];
    const beaconAfter = after.beacon[contract];
    if (
      beaconBefore &&
      beaconAfter &&
      beaconBefore.toLowerCase() !== beaconAfter.toLowerCase()
    ) {
      push({
        kind: "STORAGE",
        subject: contract,
        label: `EIP-1967 beacon of ${nameFor(context, contract)}`,
        before: beaconBefore,
        after: beaconAfter,
        delta: null,
        severity: "CRITICAL",
        matchedRuleIndex: null,
        explanation: "The EIP-1967 beacon slot changed; no rule authorises a beacon change.",
      });
    }

    const codeBefore = before.codeHash[contract];
    const codeAfter = after.codeHash[contract];
    if (
      codeBefore &&
      codeAfter &&
      codeBefore.toLowerCase() !== codeAfter.toLowerCase()
    ) {
      push({
        kind: "CODEHASH",
        subject: contract,
        label: `Code hash of ${nameFor(context, contract)}`,
        before: codeBefore,
        after: codeAfter,
        delta: null,
        severity: "CRITICAL",
        matchedRuleIndex: null,
        explanation: "The deployed code at this address changed during the simulated call.",
      });
    }
  }

  // ── ETH balances ──
  // Gas makes the caller's own balance uninformative, so only value transfers
  // that the calldata explains are classified.
  for (const action of context.actions) {
    if ((action.value ?? 0n) === 0n) continue;
    const subject = ethers.getAddress(action.target);
    const key = subject.toLowerCase();
    const beforeValue = before.eth[key];
    const afterValue = after.eth[key];
    if (beforeValue === undefined || afterValue === undefined) continue;
    if (beforeValue === afterValue) continue;
    const delta = afterValue - beforeValue;
    const explained = delta === action.value;
    push({
      kind: "ETH_BALANCE",
      subject,
      label: `ETH balance of ${nameFor(context, subject)}`,
      before: beforeValue.toString(),
      after: afterValue.toString(),
      delta: signed(delta),
      severity: explained ? "EXPECTED" : "UNEXPECTED",
      matchedRuleIndex: null,
      explanation: explained
        ? `Matches the committed action value of ${action.value.toString()} wei.`
        : `ETH changed by ${signed(delta)} wei, which the committed action value does not explain.`,
    });
  }

  return effects;
}

function traceEffects(findings: string[]): EffectEntry[] {
  return findings
    .filter((finding) => /DELEGATECALL|CALLCODE|SELFDESTRUCT|CREATE/i.test(finding))
    .map((finding) => ({
      kind: "CALL_TRACE" as const,
      subject: finding.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? "",
      label: "Execution trace finding",
      before: "—",
      after: finding,
      delta: null,
      severity: "CRITICAL" as const,
      matchedRuleIndex: null,
      explanation: finding,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Stated intent and hashing
// ─────────────────────────────────────────────────────────────────────────────

function statedSummaryFor(context: EffectContext): string {
  if (context.rules.length === 0) return "No committed rules were recorded for this proposal.";
  return context.rules
    .map((rule) => decodeRule(rule, context.registry, context.labels).humanText)
    .join("; ");
}

function mismatchLine(effect: EffectEntry): string {
  if (effect.kind === "CALL_TRACE") {
    return `Not in the stated intent: ${effect.after}`;
  }
  return `Not in the stated intent: ${effect.label} changes from ${effect.before} to ${effect.after}`;
}

export function computePreviewHash(preview: EffectPreview): string {
  const { simulatedAt: _simulatedAt, previewHash: _previewHash, ...rest } = preview;
  return ethers.keccak256(ethers.toUtf8Bytes(stableStringify(rest)));
}

function basePreview(input: {
  proposalId: string;
  network: string;
  chainId: number;
  blockNumber: number;
  status: EffectPreview["status"];
  reason?: string;
}): EffectPreview {
  return {
    proposalId: input.proposalId,
    network: input.network,
    chainId: input.chainId,
    blockNumber: input.blockNumber,
    simulatedAt: new Date().toISOString(),
    status: input.status,
    actions: [],
    effects: [],
    statedVsSimulated: { statedSummary: "", mismatchCount: 0, mismatches: [] },
    traceFindings: [],
    unobserved: [],
    previewHash: ethers.ZeroHash,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function finalize(preview: EffectPreview, unobserved?: Set<string>): EffectPreview {
  if (unobserved) preview.unobserved = [...unobserved];
  preview.unobserved = [...new Set(preview.unobserved)].sort();
  preview.previewHash = computePreviewHash(preview);
  return preview;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function previewProposal(
  proposalId: string | bigint | number,
  options: PreviewOptions = {}
): Promise<EffectPreview> {
  const pid = BigInt(proposalId);
  const pidString = pid.toString();
  const provider = options.provider ?? (await defaultProvider());
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const manifest = loadPreviewManifest(chainId);
  const networkName = manifest?.network ?? deploymentName();

  let blockNumber = 0;
  try {
    blockNumber = await provider.getBlockNumber();
  } catch {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason: "The RPC endpoint is not reachable, so no simulation was run.",
      })
    );
  }

  if (manifest?.chainId && manifest.chainId !== chainId) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `Connected chain ${chainId} does not match deployments/${deploymentName()}.json ` +
          `(chain ${manifest.chainId}); the committed hashes belong to another chain.`,
      })
    );
  }

  const cacheKey = `${pidString}:${blockNumber}`;
  if (!options.noCache && process.env.PREVIEW_NO_CACHE !== "1") {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const governor =
    options.governor ?? connectFromManifest("IntentGovernor", provider, manifest);
  const executor =
    options.executor ?? connectFromManifest("IntentLockExecutor", provider, manifest);

  if (!governor || !executor) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `No IntentGovernor/IntentLockExecutor for network "${networkName}". ` +
          `Deploy first, or pass contract instances explicitly.`,
      })
    );
  }

  let govProposal: any = null;
  try {
    const nextGovId: bigint = await governor.nextGovId();
    for (let govId = 1n; govId < nextGovId; govId++) {
      const candidate = await governor.getGovProposal(govId);
      if (BigInt(candidate.proposalId) === pid) {
        govProposal = candidate;
        break;
      }
    }
  } catch (error) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason: `Could not read governance proposals: ${errorMessage(error)}`,
      })
    );
  }

  if (!govProposal) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason: `Proposal ${pidString} has no committed governance proposal on this chain.`,
      })
    );
  }

  const commitment = String(govProposal.commitment);
  const bundle = options.bundle ?? getExecutionBundle(commitment);
  if (!bundle) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `No committed calldata is registered for commitment ${commitment}. ` +
          `The executor stores only hashes, so there is nothing to simulate.`,
      })
    );
  }

  const actions = bundleToActions(bundle);
  const rules = bundleToRules(bundle);

  const actionsHash = hashActions(actions);
  if (actionsHash.toLowerCase() !== String(govProposal.actionsHash).toLowerCase()) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `The supplied calldata hashes to ${actionsHash}, but the vote committed ` +
          `${String(govProposal.actionsHash)}. Refusing to simulate unverified calldata.`,
      })
    );
  }

  const intentHash = hashRules(rules);
  if (intentHash.toLowerCase() !== String(govProposal.intentHash).toLowerCase()) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `The supplied rules hash to ${intentHash}, but the vote committed ` +
          `${String(govProposal.intentHash)}. The stated intent cannot be rendered.`,
      })
    );
  }

  const executorAddress = String(await executor.getAddress());
  const recomputed = computeCommitmentWithActions(
    BigInt(chainId),
    executorAddress,
    pid,
    BigInt(govProposal.version),
    String(govProposal.versionHash),
    actions,
    intentHash,
    String(govProposal.disclosureHash)
  ).commitment;
  if (recomputed.toLowerCase() !== commitment.toLowerCase()) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason:
          `Recomputed commitment ${recomputed} does not match the committed ` +
          `${commitment} on this chain and executor.`,
      })
    );
  }

  const run = async (): Promise<EffectPreview> => {
    const unobserved = new Set<string>();
    const registry = getDecoderRegistry();

    // Labels: manifest contract names, bundle-provided role names, then env roles.
    const labels: Record<string, string> = { ...(options.labels ?? {}) };
    for (const [name, entry] of Object.entries(manifest?.contracts ?? {})) {
      if (entry?.address) labels[entry.address.toLowerCase()] = name;
    }
    for (const [address, label] of Object.entries(bundle.labels ?? {})) {
      labels[address.toLowerCase()] = label;
    }
    for (const [env, label] of [
      ["DEV_WALLET_ADDRESS", "Dev wallet"],
      ["VENDOR_ADDRESS", "Vendor"],
      ["PROPOSER_ADDRESS", "Proposer"],
      ["CHALLENGER_ADDRESS", "Challenger"],
    ] as const) {
      const value = process.env[env];
      if (value && ethers.isAddress(value)) labels[value.toLowerCase()] = label;
    }

    const calldata = {
      all: [] as string[],
      spenders: [] as string[],
      implementations: [] as string[],
      recipients: [] as string[],
    };
    for (const action of actions) {
      mergeCalldata(calldata, addressesInCalldata(action.target, action.data));
    }

    const watch = await buildWatchList(
      provider,
      manifest,
      actions,
      executorAddress,
      calldata
    );

    const context: EffectContext = {
      labels,
      registry,
      rules,
      actions,
      executorAddress,
    };

    const preview = basePreview({
      proposalId: pidString,
      network: networkName,
      chainId,
      blockNumber,
      status: "OK",
    });
    preview.actions = actions.map((action) =>
      decodeAction(action, registry, labels)
    );
    preview.statedVsSimulated.statedSummary = statedSummaryFor(context);

    const snapshotId = await takeSnapshot(provider);
    if (!snapshotId) {
      return finalize(
        {
          ...preview,
          status: "UNAVAILABLE",
          reason:
            "This node does not support evm_snapshot/evm_revert, so the preview " +
            "cannot run without risking chain state. Use a local Hardhat node or FORK=1.",
        },
        unobserved
      );
    }

    let before = emptyState();
    let after = emptyState();
    try {
      await impersonateAccount(provider, executorAddress);
      before = await captureState(provider, watch, executorAddress, unobserved, "before");

      const outcome = await executeActions(provider, executorAddress, actions);
      after = await captureState(provider, watch, executorAddress, unobserved, "after");

      preview.effects = classify(before, after, context);

      const findings = await collectTraceFindings(
        provider,
        executorAddress,
        outcome,
        watch,
        unobserved
      );
      preview.traceFindings = findings;
      preview.effects = [...preview.effects, ...traceEffects(findings)];

      if ((actions.some((action) => (action.value ?? 0n) > 0n))) {
        unobserved.add(
          "after: the caller's ETH balance delta excludes gas costs and is not classified as an effect"
        );
      }

      if (outcome.failedAtIndex !== null) {
        const decoded = decodeRevertSelector(outcome.revertData);
        const revert: DecodedRevert = {
          selector: decoded?.selector ?? outcome.revertData.slice(0, 10),
          code: decoded?.code ?? `UNKNOWN_ERROR_${outcome.revertData.slice(0, 10)}`,
          title: decoded?.title ?? "Execution reverted in the sandbox",
          explanation:
            (decoded?.explanation ?? "No catalog entry matched this selector.") +
            ` Simulated action ${outcome.failedAtIndex} (${preview.actions[outcome.failedAtIndex]?.humanText ?? "unknown"}) reverts, so execution would stop there.`,
          revertData: outcome.revertData,
        };
        preview.status = "FAILED_SIMULATION";
        preview.revert = revert;
        unobserved.add(
          `after: actions from index ${outcome.failedAtIndex} onward did not execute; ` +
            "their effects cannot be observed"
        );
      }

      const mismatches = preview.effects
        .filter(
          (effect) => effect.severity === "UNEXPECTED" || effect.severity === "CRITICAL"
        )
        .map(mismatchLine);
      preview.statedVsSimulated.mismatchCount = mismatches.length;
      preview.statedVsSimulated.mismatches = mismatches;

      return finalize(preview, unobserved);
    } catch (error) {
      // Even a mid-flight failure must leave the observable state unchanged.
      return finalize(
        {
          ...preview,
          status: "UNAVAILABLE",
          reason: `The preview simulation failed before completing: ${errorMessage(error)}`,
        },
        unobserved
      );
    } finally {
      await stopImpersonatingAccount(provider, executorAddress);
      await revertSnapshot(provider, snapshotId);
    }
  };

  const executeWithLock = () =>
    options.skipLock
      ? run()
      : withSnapshotLock(run, {
          label: `preview:${pidString}`,
          timeoutMs: options.lockTimeoutMs ?? 180_000,
        });

  let preview: EffectPreview;
  try {
    preview = await executeWithLock();
  } catch (error) {
    return finalize(
      basePreview({
        proposalId: pidString,
        network: networkName,
        chainId,
        blockNumber,
        status: "UNAVAILABLE",
        reason: errorMessage(error),
      })
    );
  }

  if (!options.noCache && process.env.PREVIEW_NO_CACHE !== "1") {
    writeCache(cacheKey, preview);
  }
  return preview;
}
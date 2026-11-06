/**
 * intelligence/intent-bridge.ts
 *
 * Bridges the AI-draft IntentSpec (schema a) to the on-chain Action[] and
 * ActionRule[] arrays, producing the hashes required by IntentLockExecutor /
 * CommitmentHasher.
 *
 * Contract:
 *   bridgeIntent(intent) -> BridgeOutput
 *     - Throws if ANY unresolved[] item is present (refuse to hash an unfinished spec).
 *     - Converts IntentAction[] -> Action[] (calldata encoding) and ActionRule[].
 *     - Returns intentHash, actionsHash, rules, actions.
 *     - Only uses packages/shared/hash.ts for hashing — no local re-implementation.
 *
 * Round-trip: the returned actionsHash must match what CommitmentHasher.hashActions
 * would produce for the same Action[], and intentHash is keccak256 of the
 * canonical JSON of the original IntentSpec.
 */

import { ethers } from "ethers";
import {
  hashActions,
  hashRules,
  Action,
  ActionRule,
  ActionKind,
} from "../packages/shared/hash";
import type { IntentSpec, IntentAction, ActionKindName } from "./ai-draft";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface BridgeOutput {
  /** keccak256 of the canonical JSON of the input IntentSpec. */
  intentHash: string;
  /** ActionRule[] — matches IntentLockExecutor rule registration. */
  rules: ActionRule[];
  /** keccak256(abi.encodePacked(leaves)) matching CommitmentHasher.hashActions. */
  actionsHash: string;
  /** Action[] — the concrete calldata array for execution. */
  actions: Action[];
}

// ---------------------------------------------------------------------------
// ABI encoding helpers (mirrors Solidity function signatures)
// ---------------------------------------------------------------------------

const ZERO_ADDR = ethers.ZeroAddress;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

/**
 * Encode calldata for a given action kind.
 * Mirrors the Solidity dispatcher in IntentLockExecutor.
 */
function encodeCalldata(action: IntentAction): string {
  const { kind, selector, counterparty, maxAmount } = action;
  const cp = counterparty || ZERO_ADDR;
  const amt = BigInt(maxAmount || "0");

  switch (kind) {
    case "ERC20_TRANSFER":
      // transfer(address recipient, uint256 amount)
      return (
        selector +
        abiCoder
          .encode(["address", "uint256"], [cp, amt])
          .slice(2)
      );

    case "ERC20_APPROVE":
      // approve(address spender, uint256 amount)
      return (
        selector +
        abiCoder
          .encode(["address", "uint256"], [cp, amt])
          .slice(2)
      );

    case "PARAM_SET":
      // setFee(uint256 value) — generic param set
      return (
        selector +
        abiCoder.encode(["uint256"], [amt]).slice(2)
      );

    case "UPGRADE":
      // upgradeTo(address newImpl)
      return (
        selector +
        abiCoder.encode(["address"], [cp]).slice(2)
      );

    case "OWNERSHIP_TRANSFER":
      // transferOwnership(address newOwner)
      return (
        selector +
        abiCoder.encode(["address"], [cp]).slice(2)
      );

    case "MULTICALL":
      // multicall(bytes[] calldata data) — inner calls not resolved here
      return (
        selector +
        abiCoder.encode(["bytes[]"], [[]]).slice(2)
      );

    default:
      // Should never reach here once kind is validated.
      throw new Error(`Unsupported ActionKind: ${String(kind)}`);
  }
}

/** Map ActionKindName string -> ActionKind enum number. */
function kindToEnum(name: ActionKindName): ActionKind {
  const map: Record<ActionKindName, ActionKind> = {
    ERC20_TRANSFER: ActionKind.ERC20_TRANSFER,
    ERC20_APPROVE: ActionKind.ERC20_APPROVE,
    PARAM_SET: ActionKind.PARAM_SET,
    UPGRADE: ActionKind.UPGRADE,
    OWNERSHIP_TRANSFER: ActionKind.OWNERSHIP_TRANSFER,
    MULTICALL: ActionKind.MULTICALL,
  };
  return map[name];
}

/** Normalise a selector string to 4-byte hex (no 0x prefix guaranteed). */
function normaliseSelector(sel: string): string {
  if (!sel) return "0x00000000";
  const clean = sel.startsWith("0x") ? sel : `0x${sel}`;
  if (!/^0x[0-9a-fA-F]{8}$/.test(clean)) return "0x00000000";
  return clean.toLowerCase();
}

/** Normalise a codeHash to bytes32 or zero. */
function normaliseCodeHash(h: string | null | undefined): string {
  if (!h) return ZERO_BYTES32;
  if (/^0x[0-9a-fA-F]{64}$/.test(h)) return h.toLowerCase();
  return ZERO_BYTES32;
}

/** Normalise an address or fall back to zero address. */
function normaliseAddress(addr: string | null | undefined): string {
  if (!addr) return ZERO_ADDR;
  try {
    return ethers.getAddress(addr);
  } catch {
    return ZERO_ADDR;
  }
}

// ---------------------------------------------------------------------------
// bridgeIntent
// ---------------------------------------------------------------------------

/**
 * Bridge a finalised IntentSpec to on-chain hashes and arrays.
 *
 * Throws BridgeError if:
 *   - intent.unresolved[] is non-empty (spec is not finalised).
 *   - intent.actions[] is empty.
 */
export function bridgeIntent(intent: IntentSpec): BridgeOutput {
  // ── Guard: refuse unresolved items ──
  if (intent.unresolved.length > 0) {
    const questions = intent.unresolved.map((u) => `"${u.question}"`).join("; ");
    throw new BridgeError(
      `Cannot bridge intent with ${intent.unresolved.length} unresolved item(s): ${questions}`,
      intent.unresolved.length,
      "UNRESOLVED_ITEMS"
    );
  }

  if (intent.actions.length === 0) {
    throw new BridgeError(
      "Cannot bridge intent with zero actions.",
      0,
      "NO_ACTIONS"
    );
  }

  // ── Build Action[] and ActionRule[] ──
  const actions: Action[] = [];
  const rules: ActionRule[] = [];

  for (const ia of intent.actions) {
    const target = normaliseAddress(ia.target);
    const calldata = encodeCalldata(ia);
    const childCount = ia.children.length;

    actions.push({
      target,
      value: 0n,
      data: calldata,
    });

    rules.push({
      kind: kindToEnum(ia.kind),
      target,
      selector: normaliseSelector(ia.selector),
      counterparty: normaliseAddress(ia.counterparty),
      maxAmount: BigInt(ia.maxAmount || "0"),
      codeHash: normaliseCodeHash(ia.codeHash),
      childCount,
    });
  }

  // ── Hashes (only via packages/shared/hash.ts) ──
  const actionsHash = hashActions(actions);

  // intentHash = keccak256(canonical JSON of the intent spec)
  // Canonical: keys sorted, no trailing whitespace.
  const canonicalJson = stableStringify(intent);
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalJson));

  return { intentHash, rules, actionsHash, actions };
}

// ---------------------------------------------------------------------------
// BridgeError
// ---------------------------------------------------------------------------

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly unresolvedCount: number,
    public readonly code: "UNRESOLVED_ITEMS" | "NO_ACTIONS"
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

// ---------------------------------------------------------------------------
// Stable JSON serialisation (key-sorted, no circular refs)
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
  return "{" + pairs.join(",") + "}";
}

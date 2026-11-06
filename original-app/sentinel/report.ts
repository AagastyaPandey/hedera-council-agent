/**
 * sentinel/report.ts
 *
 * Assembles the frozen Violation Report (schema c) from Sentinel simulation
 * evidence. Decoding (humanText, targetLabel) comes from decode.ts. The
 * jargon-vs-reality gap is surfaced by pairing that decoded reality with the
 * human-readable error explanation from packages/shared/errors.json.
 */

import { ethers } from "ethers";
import errorMap from "../packages/shared/errors.json";
import findingMap from "../packages/shared/sentinel-findings.json";
import { Action, ActionRule, hashActions } from "../packages/shared/hash";
import { SimulationResult } from "./simulate";
import {
  DecodedAction,
  DecoderRegistry,
  decodeAction,
  decodeRule,
  getDecoderRegistry,
} from "./decode";
import type { ViolationReport } from "./report-schema";

export type { DecodedAction } from "./decode";
export type { ViolationReport } from "./report-schema";

export interface ReportMeta {
  proposalId?: string;
  scenarioId?: string;
  proposalSaid?: string;
  approved?: DecodedAction[];
  submitted?: DecodedAction[];
  targetLabels?: Record<string, string>;
  traceRef?: string | null;
  status?: "REJECTED" | "FLAGGED" | "PASSED";
  layer?: "executor" | "sentinel";
  /** Persist the report + trace evidence under packages/shared/fixtures/reports/. */
  persist?: boolean;
}

const VIOLATION_CODES: Record<string, string> = {
  UPGRADE: "UnauthorizedUpgrade",
  OWNERSHIP: "UnauthorizedOwnershipTransfer",
  ALLOWANCE: "UnauthorizedAllowance",
  BALANCE: "UnauthorizedBalanceChange",
  TRANSFER: "UnauthorizedRecipient",
  DELEGATECALL: "UnauthorizedDelegateCall",
  CODEHASH: "CodeHashMismatch",
  STORAGE: "UnauthorizedStorageChange",
  RULE_MISMATCH: "RuleMismatch",
};

/**
 * Assemble the frozen Violation Report schema (c) from simulation evidence.
 */
export function buildViolationReport(
  simulation: SimulationResult,
  meta: ReportMeta = {}
): ViolationReport {
  const registry = getDecoderRegistry();
  const labels = meta.targetLabels ?? {};

  const approved =
    meta.approved ?? simulation.rules.map((r) => decodeRule(r, registry, labels));
  const submitted =
    meta.submitted ??
    simulation.actions.map((a) => decodeAction(a, registry, labels));

  const traceRef =
    meta.traceRef !== undefined
      ? meta.traceRef
      : meta.persist && simulation.commitment
        ? `packages/shared/fixtures/reports/${simulation.commitment}.json`
        : null;

  return {
    proposalId: meta.proposalId ?? simulation.proposalId.toString(),
    scenarioId: meta.scenarioId ?? "sentinel",
    layer: meta.layer ?? "sentinel",
    status: meta.status ?? (simulation.shouldHalt ? "FLAGGED" : "PASSED"),
    proposalSaid:
      meta.proposalSaid ?? describeRules(simulation.rules, registry, labels),
    approved,
    submitted,
    violatedConstraint: buildViolatedConstraint(
      simulation,
      meta.layer ?? "sentinel"
    ),
    evidence: {
      commitment: simulation.commitment,
      calldataHash: calldataHash(simulation.actions),
      calldata: simulation.actions[0]?.data ?? "0x",
      revertData: simulation.revertData ?? "0x",
      txHash: simulation.txHash ?? null,
      traceRef,
    },
  };
}

export function hashViolationReport(report: ViolationReport): string {
  return ethers.keccak256(ethers.toUtf8Bytes(stableStringify(report)));
}

/**
 * Deterministic JSON: sorted keys, bigint as string, stable escaping.
 * The on-chain report hash must be reproducible from the same report.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Pair the decoded reality with the explanation that belongs to the layer that
 * fired. Sentinel findings are not Solidity errors and must never be looked up
 * in errors.json; executor findings are Solidity errors and keep that catalog.
 */
function buildViolatedConstraint(
  simulation: SimulationResult,
  layer: "executor" | "sentinel"
): { code: string; message: string } {
  if (!simulation.shouldHalt) {
    return { code: "None", message: "No violation detected" };
  }

  const code = violationCode(simulation, layer);

  if (layer === "sentinel") {
    const finding = lookupFinding(code);
    return {
      code,
      message: finding
        ? `${finding.title}: ${finding.explanation}`
        : `UNKNOWN FINDING ${code}`,
    };
  }

  const error = lookupError(simulation.revertData);
  if (error) {
    return {
      code,
      message: `${error.title}: ${error.explanation}`,
    };
  }

  return {
    code,
    message: simulation.haltReason
      ? simulation.haltReason
      : `UNKNOWN ERROR ${code}`,
  };
}

interface SentinelFinding {
  code?: string;
  title?: string;
  explanation?: string;
  layer?: string;
}

function lookupFinding(code: string): {
  title: string;
  explanation: string;
} | null {
  const entry = (findingMap as Record<string, SentinelFinding>)[code];
  if (!entry?.explanation) return null;
  return {
    title: entry.title ?? `UNKNOWN FINDING ${code}`,
    explanation: entry.explanation,
  };
}

interface ErrorEntry {
  signature?: string;
  contract?: string;
  title?: string;
  explanation?: string;
}

/**
 * Decode a Solidity revert selector with packages/shared/errors.json.
 * Exported for the Pre-vote Effect Preview, which reports the same catalog.
 */
export function decodeRevertSelector(revertData?: string): {
  selector: string;
  code: string;
  title: string;
  explanation: string;
} | null {
  if (!revertData) return null;
  const selector = revertData.slice(0, 10).toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(selector)) return null;
  const entry = (errorMap as Record<string, ErrorEntry>)[selector];
  if (!entry) {
    return {
      selector,
      code: `UNKNOWN_ERROR_${selector}`,
      title: `UNKNOWN ERROR ${selector}`,
      explanation:
        "This selector is not in packages/shared/errors.json, so the constraint " +
        "cannot be named from the catalog. The raw revert data is attached.",
    };
  }
  return {
    selector,
    code: (entry.signature ?? entry.title ?? "Error").split("(")[0],
    title: entry.title ?? entry.signature ?? "Constraint violation",
    explanation: entry.explanation ?? "",
  };
}

function lookupError(revertData?: string): {
  title: string;
  explanation: string;
} | null {
  if (!revertData) return null;
  const selector = revertData.slice(0, 10).toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(selector)) return null;
  const entry = (errorMap as Record<string, ErrorEntry>)[selector];
  if (!entry?.explanation) return null;
  return {
    title: entry.title ?? entry.signature ?? "Constraint violation",
    explanation: entry.explanation,
  };
}

function violationCode(
  simulation: SimulationResult,
  layer: "executor" | "sentinel"
): string {
  const staticHalt =
    simulation.staticScan && simulation.staticScan.violations.length > 0;
  if (staticHalt) return "DangerousBytecode";

  if (layer === "sentinel") {
    if (simulation.commitmentMismatch) return "CommitmentMismatch";
    const sentinelCategory = simulation.diffReport.violations[0]?.category;
    if (sentinelCategory) {
      return VIOLATION_CODES[sentinelCategory] ?? "SentinelViolation";
    }
    if (simulation.reverted) return "ExecutionReverted";
    return "SentinelViolation";
  }

  const selector = simulation.revertData?.slice(0, 10).toLowerCase();
  if (selector && selector.length === 10 && selector !== "0x") {
    const known = (errorMap as Record<string, { signature?: string }>)[selector];
    if (known?.signature) {
      return known.signature.split("(")[0];
    }
  }

  if (simulation.commitmentMismatch) return "CommitmentMismatch";

  const category = simulation.diffReport.violations[0]?.category;
  if (category) return VIOLATION_CODES[category] ?? "SentinelViolation";

  if (simulation.reverted) return "ExecutionReverted";
  return "None";
}

function calldataHash(actions: Action[]): string {
  if (actions.length === 0) return ethers.ZeroHash;
  if (actions.length === 1) return ethers.keccak256(actions[0].data);
  return hashActions(actions);
}

function describeRules(
  rules: ActionRule[],
  registry: DecoderRegistry,
  labels: Record<string, string>
): string {
  if (rules.length === 0) return "No approved intent rules";
  return rules.map((r) => decodeRule(r, registry, labels).humanText).join("; ");
}

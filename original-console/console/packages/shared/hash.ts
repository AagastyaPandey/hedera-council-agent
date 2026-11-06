import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import type { ActionKind, ActionSpec, Intent } from "./schemas";

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export const KIND_CODES: Record<ActionKind, number> = {
  ERC20_TRANSFER: 1,
  ERC20_APPROVE: 2,
  PARAM_SET: 3,
  UPGRADE: 4,
  OWNERSHIP_TRANSFER: 5,
  MULTICALL: 6,
};

export type ActionRule = {
  kind: ActionKind;
  kindCode: number;
  target: Address;
  selector: Hex;
  counterparty: Address;
  maxAmount: bigint;
  codeHash: Hex;
  children: ActionRule[];
};

const RULE_COMPONENTS = [
  { name: "kind", type: "uint8" },
  { name: "target", type: "address" },
  { name: "selector", type: "bytes4" },
  { name: "counterparty", type: "address" },
  { name: "maxAmount", type: "uint256" },
  { name: "codeHash", type: "bytes32" },
  { name: "childrenHash", type: "bytes32" },
] as const;

const ACTION_COMPONENTS = [
  { name: "target", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
] as const;

const COMMITMENT_COMPONENTS = [
  { name: "chainId", type: "uint256" },
  { name: "executor", type: "address" },
  { name: "proposalKey", type: "bytes32" },
  { name: "version", type: "uint256" },
  { name: "actionsHash", type: "bytes32" },
  { name: "intentHash", type: "bytes32" },
  { name: "evidenceRoot", type: "bytes32" },
  { name: "disclosureHash", type: "bytes32" },
] as const;

export type ConcreteAction = {
  target: Address;
  value: bigint;
  data: Hex;
};

export function compileRules(input: Intent | ActionSpec[]): ActionRule[] {
  const actions = Array.isArray(input) ? input : input.actions;
  return actions.map((action) => ({
    kind: action.kind,
    kindCode: KIND_CODES[action.kind],
    target: action.target,
    selector: action.selector,
    counterparty: action.counterparty,
    maxAmount: BigInt(action.maxAmount),
    codeHash: action.codeHash ?? ZERO_HASH,
    children: compileRules(action.children ?? []),
  }));
}

function childrenHash(children: ActionRule[]): Hex {
  if (children.length === 0) return ZERO_HASH;
  const hashes = children.map(ruleHash);
  return keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [hashes]));
}

export function ruleHash(rule: ActionRule): Hex {
  return keccak256(
    encodeAbiParameters(RULE_COMPONENTS, [
      rule.kindCode,
      rule.target,
      rule.selector,
      rule.counterparty,
      rule.maxAmount,
      rule.codeHash,
      childrenHash(rule.children),
    ]),
  );
}

export function computeIntentHash(intent: Intent): Hex {
  const rules = compileRules(intent);
  return keccak256(
    encodeAbiParameters([{ type: "bytes32[]" }], [rules.map(ruleHash)]),
  );
}

export function computeActionsHash(actions: ConcreteAction[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "tuple[]", components: ACTION_COMPONENTS }],
      [actions.map((action) => ({ target: action.target, value: action.value, data: action.data }))],
    ),
  );
}

export function computeProposalKey(proposalId: string): Hex {
  return keccak256(toBytes(proposalId));
}

export function computeCommitment(input: {
  chainId: number;
  executor: Address;
  proposalId: string;
  version: number;
  actionsHash: Hex;
  intentHash: Hex;
  evidenceRoot: Hex;
  disclosureHash: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(COMMITMENT_COMPONENTS, [
      BigInt(input.chainId),
      input.executor,
      computeProposalKey(input.proposalId),
      BigInt(input.version),
      input.actionsHash,
      input.intentHash,
      input.evidenceRoot,
      input.disclosureHash,
    ]),
  );
}

export function computeCalldataHash(calldata: Hex): Hex {
  return keccak256(calldata);
}

export function computeDocHash(text: string): Hex {
  return keccak256(toBytes(text));
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentProjection(intent: Intent) {
  return {
    proposalId: intent.proposalId,
    version: intent.version,
    title: intent.title,
    actions: intent.actions.map(projectAction),
    assumptions: [...intent.assumptions]
      .map((assumption) => ({ name: assumption.name, value: assumption.value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function projectAction(action: ActionSpec): unknown {
  return {
    kind: action.kind,
    target: action.target,
    selector: action.selector,
    counterparty: action.counterparty,
    maxAmount: action.maxAmount,
    codeHash: action.codeHash,
    children: (action.children ?? []).map(projectAction),
  };
}

export function computeContentHash(intent: Intent): Hex {
  return keccak256(toBytes(canonicalJson(contentProjection(intent))));
}

export function computeDisclosureHash(disclosure: {
  proposalId: string;
  proposer: Address;
  wallets: string[];
  statement: string;
  signedAt: string;
}): Hex {
  return keccak256(
    toBytes(
      canonicalJson({
        proposalId: disclosure.proposalId,
        proposer: disclosure.proposer,
        wallets: [...disclosure.wallets].map((wallet) => wallet.toLowerCase()).sort(),
        statement: disclosure.statement,
        signedAt: disclosure.signedAt,
      }),
    ),
  );
}

export function computeBriefHash(input: {
  proposalId: string;
  version: number;
  intentHash: Hex;
  contentHash: Hex;
  evidenceRoot: Hex;
}): Hex {
  return keccak256(toBytes(canonicalJson(input)));
}

export function computeSimulatedTxHash(input: { scenarioId: string; calldata: Hex; commitBlock: number }): Hex {
  return keccak256(toBytes(`aegisdao:simulated-tx:${input.scenarioId}:${input.calldata}:${input.commitBlock}`));
}

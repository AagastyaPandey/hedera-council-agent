/**
 * packages/shared/hash.ts
 *
 * TypeScript implementation of the AegisDAO IntentLock commitment hashing
 * (Section 4.1). Must produce byte-identical results to CommitmentHasher.sol.
 *
 * Person B only ever calls these functions — never reimplements hashing.
 *
 * Standardized on the ethers v6 namespace so frontend and backend share
 * identical ABI encoding and hashing.
 */

import { ethers } from "ethers";

// ──────────────────────────────────────────────
// COMMIT_TYPEHASH — identical to Solidity constant
// ──────────────────────────────────────────────
export const COMMIT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "Commitment(uint256 chainId,address executor,uint256 proposalId,uint256 version,bytes32 versionHash,bytes32 actionsHash,bytes32 intentHash,bytes32 disclosureHash)"
  )
);

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export interface Action {
  target: string;   // address
  value: bigint;    // wei
  data: string;     // hex-encoded calldata
}

export enum ActionKind {
  ERC20_TRANSFER = 0,
  ERC20_APPROVE = 1,
  PARAM_SET = 2,
  UPGRADE = 3,
  OWNERSHIP_TRANSFER = 4,
  MULTICALL = 5,
}

export interface ActionRule {
  kind: ActionKind | number;
  target: string;          // address
  selector: string;        // bytes4
  counterparty: string;    // address
  maxAmount: bigint;       // uint256
  codeHash: string;        // bytes32
  childCount: number;      // uint8
}

export interface CommitmentInput {
  chainId: bigint;
  executor: string;       // address
  proposalId: bigint;
  version: bigint;
  versionHash: string;    // bytes32
  actionsHash: string;    // bytes32
  intentHash: string;     // bytes32
  disclosureHash: string; // bytes32
}

// ──────────────────────────────────────────────
// hashActions — mirrors CommitmentHasher.hashActions
// ──────────────────────────────────────────────
/**
 * Hash an ordered array of actions.
 *
 * Each leaf = keccak256(abi.encode(target, value, keccak256(data)))
 * actionsHash = keccak256(abi.encodePacked(leaves))
 */
export function hashActions(actions: Action[]): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const leaves: string[] = actions.map((a) => {
    const dataHash = ethers.keccak256(a.data);
    const encoded = abiCoder.encode(
      ["address", "uint256", "bytes32"],
      [a.target, a.value, dataHash]
    );
    return ethers.keccak256(encoded);
  });

  // abi.encodePacked(bytes32[]) = just concatenate the raw 32-byte values
  const packed = ethers.concat(leaves);
  return ethers.keccak256(packed);
}

// ──────────────────────────────────────────────
// computeCommitment — mirrors CommitmentHasher.computeCommitment
// ──────────────────────────────────────────────
/**
 * Compute the full execution commitment hash.
 *
 * commitment = keccak256(abi.encode(
 *   COMMIT_TYPEHASH, chainId, executor, proposalId, version,
 *   versionHash, actionsHash, intentHash, disclosureHash
 * ))
 */
export function computeCommitment(input: CommitmentInput): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const encoded = abiCoder.encode(
    [
      "bytes32",  // COMMIT_TYPEHASH
      "uint256",  // chainId
      "address",  // executor
      "uint256",  // proposalId
      "uint256",  // version
      "bytes32",  // versionHash
      "bytes32",  // actionsHash
      "bytes32",  // intentHash
      "bytes32",  // disclosureHash
    ],
    [
      COMMIT_TYPEHASH,
      input.chainId,
      input.executor,
      input.proposalId,
      input.version,
      input.versionHash,
      input.actionsHash,
      input.intentHash,
      input.disclosureHash,
    ]
  );

  return ethers.keccak256(encoded);
}

// ──────────────────────────────────────────────
// computeCommitmentWithActions — convenience wrapper
// ──────────────────────────────────────────────
export function computeCommitmentWithActions(
  chainId: bigint,
  executor: string,
  proposalId: bigint,
  version: bigint,
  versionHash: string,
  actions: Action[],
  intentHash: string,
  disclosureHash: string
): { commitment: string; actionsHash: string } {
  const actionsHash = hashActions(actions);
  const commitment = computeCommitment({
    chainId,
    executor,
    proposalId,
    version,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash,
  });
  return { commitment, actionsHash };
}

// ──────────────────────────────────────────────
// hashRules — mirrors ActionDecoder.hashRules
// ──────────────────────────────────────────────
export const ACTION_RULE_TUPLE =
  "tuple(uint8 kind, address target, bytes4 selector, address counterparty, uint256 maxAmount, bytes32 codeHash, uint8 childCount)";

/**
 * Hash an array of ActionRules.
 * Matches Solidity keccak256(abi.encode(rules)) in ActionDecoder.
 */
export function hashRules(rules: ActionRule[]): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    [`${ACTION_RULE_TUPLE}[]`],
    [
      rules.map((r) => [
        r.kind,
        r.target,
        r.selector,
        r.counterparty,
        r.maxAmount,
        r.codeHash,
        r.childCount,
      ]),
    ]
  );
  return ethers.keccak256(encoded);
}


import { ADDRESSES, CHAIN_ID } from "./addresses";
import type { Intent } from "./schemas";
import { buildApprovedCalls } from "./calls";
import {
  computeActionsHash,
  computeBriefHash,
  computeCalldataHash,
  computeCommitment,
  computeContentHash,
  computeDisclosureHash,
  computeDocHash,
  computeIntentHash,
} from "./hash";

const VECTOR_SOURCE = {
  docKey: "vector",
  page: 1,
  section: "vector",
  quote: "hash vector fixture",
};

const vectorIntent: Intent = {
  proposalId: "HASH-VECTOR-001",
  version: 1,
  title: "Hash vector fixture",
  actions: [
    {
      kind: "ERC20_TRANSFER",
      target: ADDRESSES.usdc,
      selector: "0xa9059cbb",
      counterparty: ADDRESSES.growthLabs,
      maxAmount: "200000000000",
      codeHash: null,
      source: VECTOR_SOURCE,
      confidence: 0.99,
      label: "Vector transfer",
    },
    {
      kind: "ERC20_APPROVE",
      target: ADDRESSES.usdc,
      selector: "0x095ea7b3",
      counterparty: ADDRESSES.treasuryOps,
      maxAmount: "5000000000",
      codeHash: null,
      source: VECTOR_SOURCE,
      confidence: 0.99,
      label: "Vector approve",
    },
    {
      kind: "MULTICALL",
      target: ADDRESSES.multicall,
      selector: "0xcaa5c23f",
      counterparty: "0x0000000000000000000000000000000000000000",
      maxAmount: "0",
      codeHash: null,
      source: VECTOR_SOURCE,
      confidence: 0.99,
      children: [
        {
          kind: "ERC20_TRANSFER",
          target: ADDRESSES.usdc,
          selector: "0xa9059cbb",
          counterparty: ADDRESSES.developerGuild,
          maxAmount: "50000000000",
          codeHash: null,
          source: VECTOR_SOURCE,
          confidence: 0.99,
        },
      ],
      label: "Vector multicall",
    },
  ],
  unresolved: [],
  assumptions: [
    { name: "vector_assumption", value: "fixed", source: VECTOR_SOURCE },
  ],
};

export type HashVectorInputs = ReturnType<typeof buildVectorInputs>;

export function buildVectorInputs() {
  const calls = buildApprovedCalls(vectorIntent);
  const disclosure = {
    proposalId: vectorIntent.proposalId,
    proposer: ADDRESSES.proposer,
    wallets: [ADDRESSES.novaMain, ADDRESSES.novaTreasury],
    statement: "Vector disclosure",
    signedAt: "2026-01-01T00:00:00Z",
  };
  const disclosureHash = computeDisclosureHash(disclosure);
  const intentHash = computeIntentHash(vectorIntent);
  const contentHash = computeContentHash(vectorIntent);
  const actionsHash = computeActionsHash(calls);
  const commitment = computeCommitment({
    chainId: CHAIN_ID,
    executor: ADDRESSES.executor,
    proposalId: vectorIntent.proposalId,
    version: vectorIntent.version,
    actionsHash,
    intentHash,
    evidenceRoot: computeDocHash("vector evidence root"),
    disclosureHash,
  });
  const briefHash = computeBriefHash({
    proposalId: vectorIntent.proposalId,
    version: vectorIntent.version,
    intentHash,
    contentHash,
    evidenceRoot: computeDocHash("vector evidence root"),
  });

  return {
    intent: vectorIntent,
    calls,
    disclosure,
    calldata: computeCalldataHash("0x12345678"),
    docHash: computeDocHash("aegisdao vector document\n"),
    expected: {
      intentHash,
      actionsHash,
      contentHash,
      disclosureHash,
      commitment,
      briefHash,
    },
  };
}

import { describe, expect, it } from "vitest";
import { ADDRESSES, CHAIN_ID, ERROR_BY_NAME } from "../packages/shared/addresses";
import {
  computeActionsHash,
  computeCalldataHash,
  computeCommitment,
  computeDisclosureHash,
  computeIntentHash,
} from "../packages/shared/hash";
import { buildVectorInputs } from "../packages/shared/hash-vectors";
import vectors from "../packages/shared/fixtures/hash-vectors.json";
import { getDemo } from "../lib/demo";

describe("commitment hashing", () => {
  it("matches the committed intent hash and commitment", () => {
    const demo = getDemo();
    expect(computeIntentHash(demo.committed)).toBe(demo.intentHash);
    expect(computeActionsHash(demo.approvedCalls)).toBe(demo.actionsHash);
    expect(
      computeCommitment({
        chainId: CHAIN_ID,
        executor: ADDRESSES.executor,
        proposalId: demo.proposal.id,
        version: 3,
        actionsHash: demo.actionsHash,
        intentHash: demo.intentHash,
        evidenceRoot: demo.manifest.root,
        disclosureHash: demo.disclosureHash,
      }),
    ).toBe(demo.commitment);
  });

  it("changes when any rule field changes", () => {
    const demo = getDemo();
    const base = JSON.parse(JSON.stringify(demo.committed)) as typeof demo.committed;
    const variants = [
      (intent: typeof base) => {
        intent.actions[0].target = ADDRESSES.attacker;
      },
      (intent: typeof base) => {
        intent.actions[0].maxAmount = "1";
      },
      (intent: typeof base) => {
        intent.actions[0].counterparty = ADDRESSES.attacker;
      },
      (intent: typeof base) => {
        intent.actions[0].children = [JSON.parse(JSON.stringify(intent.actions[1]))];
      },
      (intent: typeof base) => {
        intent.actions[0].selector = "0xdeadbeef";
      },
    ];
    for (const mutate of variants) {
      const clone = JSON.parse(JSON.stringify(base)) as typeof base;
      mutate(clone);
      expect(computeIntentHash(clone)).not.toBe(demo.intentHash);
    }
  });

  it("binds chain id, executor, version, actions, evidence and disclosure", () => {
    const demo = getDemo();
    const base = {
      chainId: CHAIN_ID,
      executor: ADDRESSES.executor,
      proposalId: demo.proposal.id,
      version: 3,
      actionsHash: demo.actionsHash,
      intentHash: demo.intentHash,
      evidenceRoot: demo.manifest.root,
      disclosureHash: demo.disclosureHash,
    };
    const commitment = computeCommitment(base);
    expect(computeCommitment({ ...base, chainId: 1 })).not.toBe(commitment);
    expect(computeCommitment({ ...base, executor: ADDRESSES.attacker })).not.toBe(commitment);
    expect(computeCommitment({ ...base, version: 4 })).not.toBe(commitment);
    expect(computeCommitment({ ...base, actionsHash: computeActionsHash([]) })).not.toBe(
      commitment,
    );
    expect(computeCommitment({ ...base, intentHash: computeActionsHash([]) })).not.toBe(
      commitment,
    );
    expect(
      computeCommitment({ ...base, evidenceRoot: `0x${"0".repeat(64)}` }),
    ).not.toBe(commitment);
    expect(
      computeCommitment({
        ...base,
        disclosureHash: computeDisclosureHash({
          proposalId: demo.proposal.id,
          proposer: ADDRESSES.proposer,
          wallets: [ADDRESSES.attacker],
          statement: "tampered",
          signedAt: "2026-10-12T10:00:00Z",
        }),
      }),
    ).not.toBe(commitment);
    expect(computeCalldataHash("0x1234")).not.toBe(computeCalldataHash("0x5678"));
  });

  it("matches the frozen hash vectors", () => {
    const inputs = buildVectorInputs();
    for (const [key, value] of Object.entries(inputs.expected)) {
      expect((vectors.expected as Record<string, string>)[key]).toBe(value);
    }
  });

  it("chains versions and keeps rules stable across the v3 wording change", () => {
    const demo = getDemo();
    const [v1, v2, v3] = demo.versions;
    expect(v1.prevVersionHash).toBe(demo.zeroHash);
    expect(v2.prevVersionHash).toBe(v1.contentHash);
    expect(v3.prevVersionHash).toBe(v2.contentHash);
    expect(v2.intentHash).toBe(v3.intentHash);
    expect(v2.contentHash).not.toBe(v3.contentHash);
    expect(v1.technicalAssessmentHash).toBe(demo.zeroHash);
    expect(v3.technicalAssessmentHash).not.toBe(demo.zeroHash);
  });

  it("maps every custom error to a stable selector", () => {
    expect(ERROR_BY_NAME.UnauthorizedRecipient.selector).toBe("0x4cc4c430");
    expect(ERROR_BY_NAME.NestedCallNotAuthorized.selector).toBe("0x1be76755");
  });
});

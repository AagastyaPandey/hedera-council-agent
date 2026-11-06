/**
 * intelligence/__tests__/intelligence.test.ts
 *
 * Unit tests for evidence.ts, chain.ts, and intent-bridge.ts.
 *
 * Run with:   npx ts-mocha --timeout 10000 intelligence/__tests__/intelligence.test.ts
 *             or via:  npm run test:intelligence
 *
 * Coverage:
 *   [evidence]
 *     - Merkle root of 1 leaf equals the leaf itself.
 *     - Proof verifies correctly for multi-leaf trees.
 *     - Tampered leaf fails verification.
 *     - addDocument idempotency.
 *     - verifySource validates span bounds.
 *
 *   [chain]
 *     - CLAIMS: missing data -> UNKNOWN.
 *     - CLAIMS: seeded proposal scores end-to-end with expected range.
 *     - COI: pure noisy-OR monotonicity (adding a link never lowers risk).
 *     - VOTING: missing voters -> UNKNOWN.
 *     - EXECUTION: REVERTED -> RED; PENDING + violation -> RED; EXECUTED -> GREEN.
 *     - evaluateChain: overall status reflects worst stage.
 *
 *   [bridge]
 *     - Refuses intent with unresolved items (BridgeError).
 *     - Refuses intent with zero actions.
 *     - Round-trip: actionsHash matches hashActions on the same Action[].
 *     - intentHash changes when intent body changes.
 */

import { strict as assert } from "assert";
import { ethers } from "ethers";

import {
  EvidenceStore,
  buildMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  hashPair,
} from "../evidence";

import {
  scoreClaims,
  scoreCoi,
  scoreVoting,
  scoreExecution,
  evaluateChain,
  ChainInput,
} from "../chain";

import { bridgeIntent, BridgeError } from "../intent-bridge";
import { hashActions, Action } from "../../packages/shared/hash";
import { IntentSpec } from "../ai-draft";
import { noisyOr } from "../graph";

// ============================================================================
// Helpers
// ============================================================================

function makeStore() {
  return new EvidenceStore({ memoryOnly: true });
}

function makeCleanIntent(overrides: Partial<IntentSpec> = {}): IntentSpec {
  return {
    proposalId: "test-42",
    version: 1,
    title: "Test Proposal",
    actions: [
      {
        kind: "ERC20_TRANSFER",
        target: "0x000000000000000000000000000000000000b001",
        selector: "0xa9059cbb",
        counterparty: "0x000000000000000000000000000000000000b002",
        maxAmount: "5000000000",
        codeHash: null,
        children: [],
        source: {
          docHash: ethers.ZeroHash,
          page: 1,
          section: "1",
          span: [0, 10],
        },
        confidence: 0.9,
      },
    ],
    unresolved: [],
    assumptions: [],
    ...overrides,
  };
}

// ============================================================================
// [evidence] EvidenceStore + Merkle
// ============================================================================

describe("evidence — Merkle tree", () => {
  it("single leaf: root equals the leaf", () => {
    const leaves = [ethers.keccak256(ethers.toUtf8Bytes("hello"))];
    assert.equal(buildMerkleRoot(leaves), leaves[0]);
  });

  it("empty leaves: root equals ZeroHash", () => {
    assert.equal(buildMerkleRoot([]), ethers.ZeroHash);
  });

  it("two leaves: hashPair is symmetric", () => {
    const a = ethers.keccak256(ethers.toUtf8Bytes("a"));
    const b = ethers.keccak256(ethers.toUtf8Bytes("b"));
    assert.equal(hashPair(a, b), hashPair(b, a));
  });

  it("proof verifies for 4-leaf tree (all leaves)", () => {
    const leaves = ["alpha", "beta", "gamma", "delta"].map((s) =>
      ethers.keccak256(ethers.toUtf8Bytes(s))
    );
    const sorted = [...leaves].sort();
    const root = buildMerkleRoot(sorted);

    for (let i = 0; i < sorted.length; i++) {
      const proof = getMerkleProof(sorted, i);
      assert.ok(
        verifyMerkleProof(root, proof, sorted[i]),
        `Proof failed for index ${i}`
      );
    }
  });

  it("proof verifies for odd-length (5-leaf) tree", () => {
    const leaves = ["a", "b", "c", "d", "e"].map((s) =>
      ethers.keccak256(ethers.toUtf8Bytes(s))
    );
    const sorted = [...leaves].sort();
    const root = buildMerkleRoot(sorted);
    for (let i = 0; i < sorted.length; i++) {
      const proof = getMerkleProof(sorted, i);
      assert.ok(verifyMerkleProof(root, proof, sorted[i]));
    }
  });

  it("tampered leaf fails verification", () => {
    const leaves = ["x", "y", "z"].map((s) =>
      ethers.keccak256(ethers.toUtf8Bytes(s))
    );
    const sorted = [...leaves].sort();
    const root = buildMerkleRoot(sorted);
    const proof = getMerkleProof(sorted, 0);
    const tampered = ethers.keccak256(ethers.toUtf8Bytes("tampered"));
    assert.equal(verifyMerkleProof(root, proof, tampered), false);
  });

  it("tampered proof node fails verification", () => {
    const leaves = ["p", "q", "r", "s"].map((s) =>
      ethers.keccak256(ethers.toUtf8Bytes(s))
    );
    const sorted = [...leaves].sort();
    const root = buildMerkleRoot(sorted);
    const proof = getMerkleProof(sorted, 0);
    const badProof = [
      ethers.keccak256(ethers.toUtf8Bytes("bad")),
      ...proof.slice(1),
    ];
    assert.equal(verifyMerkleProof(root, badProof, sorted[0]), false);
  });
});

describe("evidence — EvidenceStore", () => {
  it("addDocument is idempotent (same hash each call)", () => {
    const store = makeStore();
    const h1 = store.addDocument("hello world");
    const h2 = store.addDocument("hello world");
    assert.equal(h1, h2);
    assert.equal(store.knownHashes.length, 1);
  });

  it("different content produces different hashes", () => {
    const store = makeStore();
    const h1 = store.addDocument("doc A");
    const h2 = store.addDocument("doc B");
    assert.notEqual(h1, h2);
    assert.equal(store.knownHashes.length, 2);
  });

  it("getProof + verifyProof round-trips", () => {
    const store = makeStore();
    const h1 = store.addDocument("document one");
    const h2 = store.addDocument("document two");
    store.addDocument("document three");

    const proof1 = store.getProof(h1);
    const proof2 = store.getProof(h2);
    assert.ok(store.verifyProof(proof1, h1));
    assert.ok(store.verifyProof(proof2, h2));
  });

  it("getProof throws for unknown hash", () => {
    const store = makeStore();
    store.addDocument("only doc");
    assert.throws(() => store.getProof(ethers.ZeroHash), /not found/);
  });

  it("verifySource: valid span returns true", () => {
    const store = makeStore();
    const content = "The quick brown fox";
    const hash = store.addDocument(content);
    assert.ok(
      store.verifySource({ docHash: hash, span: [4, 9] }) // "quick"
    );
  });

  it("verifySource: span beyond document length returns false", () => {
    const store = makeStore();
    const content = "short";
    const hash = store.addDocument(content);
    assert.equal(
      store.verifySource({ docHash: hash, span: [0, 1000] }),
      false
    );
  });

  it("verifySource: invalid hash returns false", () => {
    const store = makeStore();
    assert.equal(
      store.verifySource({ docHash: ethers.ZeroHash, span: [0, 0] }),
      false
    );
  });

  it("verifySource: inverted span (end < start) returns false", () => {
    const store = makeStore();
    const hash = store.addDocument("data");
    assert.equal(store.verifySource({ docHash: hash, span: [5, 2] }), false);
  });
});

// ============================================================================
// [chain] Evaluation Chain
// ============================================================================

describe("chain — CLAIMS stage", () => {
  it("empty actions -> UNKNOWN", () => {
    const result = scoreClaims({ actions: [] });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.score, null);
  });

  it("all actions UNRESOLVED -> score 0 -> RED", () => {
    const result = scoreClaims({
      actions: [
        { extraction_confidence: 0.9, evidence_support: null },
        { extraction_confidence: 0.8, evidence_support: null },
      ],
    });
    assert.equal(result.score, 0);
    assert.equal(result.status, "RED");
    assert.equal(result.factors["unresolved_count"], 2);
  });

  it("fully supported actions -> GREEN", () => {
    const result = scoreClaims({
      actions: [
        { extraction_confidence: 0.95, evidence_support: 0.95 },
        { extraction_confidence: 0.9, evidence_support: 1.0 },
      ],
    });
    assert.equal(result.status, "GREEN");
    assert.ok((result.score ?? 0) > 0.7);
  });

  it("mixed resolved/unresolved -> factors correct", () => {
    const result = scoreClaims({
      actions: [
        { extraction_confidence: 0.9, evidence_support: 0.8 },
        { extraction_confidence: 0.5, evidence_support: null }, // unresolved
        { extraction_confidence: 0.8, evidence_support: 0.0 }, // unsupported
      ],
    });
    assert.equal(result.factors["unresolved_count"], 1);
    assert.equal(result.factors["unsupported_count"], 1);
  });
});

describe("chain — COI stage (noisy-OR monotonicity)", () => {
  it("adding a link never lowers risk", () => {
    const baseStrengths = [0.3, 0.5];
    const extended = [0.3, 0.5, 0.1]; // added a weak link

    const baseRisk = noisyOr(baseStrengths);
    const extendedRisk = noisyOr(extended);
    assert.ok(extendedRisk >= baseRisk, "noisy-OR must be monotone");
  });

  it("zero links -> risk 0 -> GREEN", () => {
    const result = scoreCoi({
      linkStrengths: [],
      undisclosedCount: 0,
      totalLinkCount: 0,
    });
    assert.equal(result.score, 0);
    assert.equal(result.status, "GREEN");
  });

  it("high undisclosed fraction increases risk", () => {
    const withDisclosed = scoreCoi({
      linkStrengths: [0.4, 0.3],
      undisclosedCount: 0,
      totalLinkCount: 2,
    });
    const withUndisclosed = scoreCoi({
      linkStrengths: [0.4, 0.3],
      undisclosedCount: 2,
      totalLinkCount: 2,
    });
    assert.ok(
      (withUndisclosed.score ?? 0) >= (withDisclosed.score ?? 0),
      "undisclosed fraction must not decrease risk"
    );
  });

  it("very high link strengths -> RED", () => {
    const result = scoreCoi({
      linkStrengths: [0.9, 0.85, 0.7],
      undisclosedCount: 3,
      totalLinkCount: 3,
    });
    assert.equal(result.status, "RED");
  });
});

describe("chain — VOTING stage", () => {
  it("no voter data -> UNKNOWN", () => {
    const result = scoreVoting({
      voters: [],
      participationFraction: 0.5,
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.score, null);
  });

  it("high quality vote -> GREEN", () => {
    const voters = Array.from({ length: 20 }, (_, i) => ({
      address: `0x${i.toString(16).padStart(40, "0")}`,
      weight: 1,
      informed: true,
      coiFlagged: false,
    }));
    const result = scoreVoting({
      voters,
      participationFraction: 0.7,
      quorumThreshold: 0.4,
    });
    assert.equal(result.status, "GREEN");
  });

  it("low participation -> not GREEN", () => {
    const voters = [
      { address: "0x01", weight: 1, informed: false, coiFlagged: false },
    ];
    const result = scoreVoting({
      voters,
      participationFraction: 0.05, // far below quorum
      quorumThreshold: 0.4,
    });
    assert.notEqual(result.status, "GREEN");
  });
});

describe("chain — EXECUTION stage", () => {
  it("EXECUTED -> GREEN, score 1", () => {
    const r = scoreExecution({ outcome: "EXECUTED" });
    assert.equal(r.status, "GREEN");
    assert.equal(r.score, 1);
  });

  it("REVERTED -> RED, score 0", () => {
    const r = scoreExecution({ outcome: "REVERTED" });
    assert.equal(r.status, "RED");
    assert.equal(r.score, 0);
  });

  it("HALTED -> RED", () => {
    assert.equal(scoreExecution({ outcome: "HALTED" }).status, "RED");
  });

  it("FLAGGED -> RED", () => {
    assert.equal(scoreExecution({ outcome: "FLAGGED" }).status, "RED");
  });

  it("PENDING without violation -> GREEN", () => {
    const r = scoreExecution({ outcome: "PENDING", sentinelViolation: false });
    assert.equal(r.status, "GREEN");
  });

  it("PENDING with Sentinel violation -> RED", () => {
    const r = scoreExecution({ outcome: "PENDING", sentinelViolation: true });
    assert.equal(r.status, "RED");
  });

  it("NOT_SUBMITTED -> UNKNOWN", () => {
    const r = scoreExecution({ outcome: "NOT_SUBMITTED" });
    assert.equal(r.status, "UNKNOWN");
    assert.equal(r.score, null);
  });
});

describe("chain — evaluateChain end-to-end (seeded proposal)", () => {
  it("all GREEN stages -> overall GREEN", () => {
    const input: ChainInput = {
      claims: {
        actions: [
          { extraction_confidence: 0.95, evidence_support: 0.95 },
          { extraction_confidence: 0.9, evidence_support: 1.0 },
        ],
      },
      coi: { linkStrengths: [], undisclosedCount: 0, totalLinkCount: 0 },
      voting: {
        voters: Array.from({ length: 10 }, (_, i) => ({
          address: `0x${i.toString(16).padStart(40, "0")}`,
          weight: 1,
          informed: true,
          coiFlagged: false,
        })),
        participationFraction: 0.8,
        quorumThreshold: 0.4,
      },
      execution: { outcome: "EXECUTED" },
    };
    const result = evaluateChain(input);
    assert.equal(result.overallStatus, "GREEN");
    for (const s of result.stages) {
      assert.equal(s.status, "GREEN", `Stage ${s.stage} should be GREEN`);
    }
  });

  it("one RED stage -> overall RED", () => {
    const input: ChainInput = {
      claims: {
        actions: [{ extraction_confidence: 0.9, evidence_support: 0.9 }],
      },
      coi: { linkStrengths: [], undisclosedCount: 0, totalLinkCount: 0 },
      voting: {
        voters: [
          {
            address: "0x01",
            weight: 1,
            informed: true,
            coiFlagged: false,
          },
        ],
        participationFraction: 0.8,
        quorumThreshold: 0.4,
      },
      execution: { outcome: "REVERTED" }, // RED
    };
    const result = evaluateChain(input);
    assert.equal(result.overallStatus, "RED");
  });

  it("UNKNOWN stage propagates to overall status", () => {
    const input: ChainInput = {
      claims: { actions: [] }, // UNKNOWN
      coi: { linkStrengths: [], undisclosedCount: 0, totalLinkCount: 0 },
      voting: {
        voters: [],
        participationFraction: 0.5,
      },
      execution: { outcome: "EXECUTED" },
    };
    const result = evaluateChain(input);
    // At minimum one UNKNOWN
    const hasUnknown = result.stages.some((s) => s.status === "UNKNOWN");
    assert.ok(hasUnknown);
    // Overall should not be GREEN
    assert.notEqual(result.overallStatus, "GREEN");
  });
});

// ============================================================================
// [bridge] IntentBridge
// ============================================================================

describe("bridge — bridgeIntent", () => {
  it("throws BridgeError when unresolved items are present", () => {
    const intent = makeCleanIntent({
      unresolved: [
        { question: "What is the recipient?", source: {} },
      ],
    });
    assert.throws(
      () => bridgeIntent(intent),
      (err: unknown) => {
        assert.ok(err instanceof BridgeError);
        assert.equal(err.code, "UNRESOLVED_ITEMS");
        assert.equal(err.unresolvedCount, 1);
        return true;
      }
    );
  });

  it("throws BridgeError when actions array is empty", () => {
    const intent = makeCleanIntent({ actions: [] });
    assert.throws(
      () => bridgeIntent(intent),
      (err: unknown) => {
        assert.ok(err instanceof BridgeError);
        assert.equal(err.code, "NO_ACTIONS");
        return true;
      }
    );
  });

  it("round-trip: actionsHash matches hashActions on same Action[]", () => {
    const intent = makeCleanIntent();
    const output = bridgeIntent(intent);

    // Independently compute actionsHash using hashActions.
    const actionsHash = hashActions(output.actions);
    assert.equal(output.actionsHash, actionsHash);
  });

  it("intentHash changes when intent body changes", () => {
    const intentA = makeCleanIntent({ title: "Proposal A" });
    const intentB = makeCleanIntent({ title: "Proposal B" });

    const out1 = bridgeIntent(intentA);
    const out2 = bridgeIntent(intentB);
    assert.notEqual(out1.intentHash, out2.intentHash);
  });

  it("intentHash is stable (same intent -> same hash)", () => {
    const intent = makeCleanIntent();
    const out1 = bridgeIntent(intent);
    const out2 = bridgeIntent(intent);
    assert.equal(out1.intentHash, out2.intentHash);
  });

  it("rules.length == actions.length", () => {
    const intent = makeCleanIntent();
    const output = bridgeIntent(intent);
    assert.equal(output.rules.length, output.actions.length);
    assert.equal(output.rules.length, intent.actions.length);
  });

  it("PARAM_SET action bridges correctly", () => {
    const intent = makeCleanIntent({
      actions: [
        {
          kind: "PARAM_SET",
          target: "0x000000000000000000000000000000000000c001",
          selector: "0x69fe0e2d",
          counterparty: "",
          maxAmount: "3500",
          codeHash: null,
          children: [],
          source: { docHash: ethers.ZeroHash, page: 1, section: "1", span: [0, 5] },
          confidence: 0.8,
        },
      ],
    });
    const output = bridgeIntent(intent);
    assert.equal(output.actions.length, 1);
    // Data should start with 0x69fe0e2d
    assert.ok(output.actions[0].data.startsWith("0x69fe0e2d"));
  });

  it("multiple actions produce correct actionsHash", () => {
    const intent = makeCleanIntent({
      actions: [
        {
          kind: "ERC20_TRANSFER",
          target: "0x000000000000000000000000000000000000b001",
          selector: "0xa9059cbb",
          counterparty: "0x000000000000000000000000000000000000b002",
          maxAmount: "5000000000",
          codeHash: null,
          children: [],
          source: { docHash: ethers.ZeroHash, page: 1, section: "1", span: [0, 10] },
          confidence: 0.9,
        },
        {
          kind: "PARAM_SET",
          target: "0x000000000000000000000000000000000000c001",
          selector: "0x69fe0e2d",
          counterparty: "",
          maxAmount: "35",
          codeHash: null,
          children: [],
          source: { docHash: ethers.ZeroHash, page: 1, section: "2", span: [0, 5] },
          confidence: 0.85,
        },
      ],
    });
    const output = bridgeIntent(intent);
    const expected = hashActions(output.actions);
    assert.equal(output.actionsHash, expected);
    assert.equal(output.rules.length, 2);
  });
});

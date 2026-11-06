import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildVectorInputs } from "../packages/shared/hash-vectors";
import {
  computeActionsHash,
  computeCalldataHash,
  computeCommitment,
  computeContentHash,
  computeDisclosureHash,
  computeIntentHash,
} from "../packages/shared/hash";
import { verifyDocument } from "../packages/shared/evidence";
import { applyResolutions } from "../ai/resolve";
import { validateExtraction } from "../ai/validate";
import { ERROR_BY_NAME, ADDRESSES } from "../packages/shared/addresses";
import { decodeAction, decodeBundle } from "../sentinel/decode";
import { describeErrorSelector } from "../sentinel/report";
import { runScenario, TRACE_REGISTRY, traceFlagsDelegatecall } from "../reference/executor";
import type { ScorecardEntry } from "../packages/shared/schemas";
import { getDemo } from "../lib/demo";
import vectorsJson from "../packages/shared/fixtures/hash-vectors.json";

const demo = getDemo();
const results: ScorecardEntry[] = [];

function entry(
  id: string,
  property: string,
  testFile: string,
  evidenceKind: ScorecardEntry["evidenceKind"],
  fn: () => void,
) {
  const started = performance.now();
  let status: ScorecardEntry["status"] = "PASS";
  let reason: string | undefined;
  try {
    fn();
  } catch (error) {
    status = "FAIL";
    reason = error instanceof Error ? error.message : String(error);
  }
  results.push({
    id,
    property,
    status,
    testFile,
    durationMs: Math.round(performance.now() - started),
    evidenceKind,
    ...(reason ? { reason } : {}),
  });
}

entry("H1", "Intent hash changes when any rule field changes", "tests/hash.test.ts", "unit", () => {
  const base = demo.committed;
  const baseHash = demo.intentHash;
  const mutate = (change: (intent: typeof base) => void) => {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    change(clone);
    return clone;
  };
  assert.notEqual(
    (() => {
      const clone = mutate((intent) => {
        intent.actions[0].target = ADDRESSES.attacker;
      });
      return computeIntentHash(clone);
    })(),
    baseHash,
  );
  assert.notEqual(
    (() => {
      const clone = mutate((intent) => {
        intent.actions[0].maxAmount = "1";
      });
      return computeIntentHash(clone);
    })(),
    baseHash,
  );
  assert.notEqual(
    (() => {
      const clone = mutate((intent) => {
        intent.actions[0].counterparty = ADDRESSES.attacker;
      });
      return computeIntentHash(clone);
    })(),
    baseHash,
  );
  assert.notEqual(
    (() => {
      const clone = mutate((intent) => {
        intent.actions[0].children = [JSON.parse(JSON.stringify(intent.actions[1]))];
      });
      return computeIntentHash(clone);
    })(),
    baseHash,
  );
});

entry("H2", "Commitment binds chain, executor, version, calldata, intent, evidence and disclosure", "tests/hash.test.ts", "unit", () => {
  const base = {
    chainId: 31337,
    executor: ADDRESSES.executor,
    proposalId: demo.proposal.id,
    version: 3,
    actionsHash: demo.actionsHash,
    intentHash: demo.intentHash,
    evidenceRoot: demo.manifest.root,
    disclosureHash: demo.disclosureHash,
  };
  const commitment = computeCommitment(base);
  assert.equal(commitment.toLowerCase(), demo.commitment.toLowerCase());
  assert.notEqual(computeCommitment({ ...base, chainId: 1 }), commitment);
  assert.notEqual(computeCommitment({ ...base, executor: ADDRESSES.attacker }), commitment);
  assert.notEqual(computeCommitment({ ...base, version: 4 }), commitment);
  assert.notEqual(
    computeCommitment({ ...base, actionsHash: computeActionsHash([]) }),
    commitment,
  );
  assert.notEqual(
    computeCommitment({ ...base, evidenceRoot: `0x${"0".repeat(64)}` }),
    commitment,
  );
  assert.notEqual(
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
    commitment,
  );
  assert.notEqual(computeCalldataHash("0x1234"), computeCalldataHash("0x5678"));
});

entry("H3", "Hash vectors are stable", "tests/hash.test.ts", "unit", () => {
  const inputs = buildVectorInputs();
  const expected = vectorsJson.expected as Record<string, string>;
  for (const [key, value] of Object.entries(inputs.expected)) {
    assert.equal(
      value.toLowerCase(),
      expected[key]?.toLowerCase(),
      `Hash vector ${key} changed. Regenerate intentionally with npm run vectors.`,
    );
  }
});

entry("H4", "Version chain links content hashes and preserves rules across v2→v3", "tests/hash.test.ts", "unit", () => {
  const [v1, v2, v3] = demo.versions;
  assert.equal(v1.prevVersionHash, demo.zeroHash);
  assert.equal(v2.prevVersionHash, v1.contentHash);
  assert.equal(v3.prevVersionHash, v2.contentHash);
  assert.equal(v2.intentHash, v3.intentHash);
  assert.notEqual(v2.contentHash, v3.contentHash);
  assert.equal(v1.technicalAssessmentHash, demo.zeroHash);
  assert.equal(v2.technicalAssessmentHash, demo.zeroHash);
  assert.notEqual(v3.technicalAssessmentHash, demo.zeroHash);
});

entry("E1", "Every evidence document re-hashes and verifies against the Merkle root", "tests/evidence.test.ts", "unit", () => {
  for (const doc of demo.manifest.docs) {
    const check = verifyDocument(doc, demo.manifest);
    assert.equal(check.hashMatches, true, `${doc.key} hash mismatch`);
    assert.equal(check.proofValid, true, `${doc.key} proof mismatch`);
  }
  const tampered = { ...demo.manifest.docs[0], text: `${demo.manifest.docs[0].text}\ntampered` };
  const check = verifyDocument(tampered, demo.manifest);
  assert.equal(check.hashMatches, false);
  assert.equal(check.proofValid, false);
});

entry("D1", "Decoder resolves ERC-20, proxy, ownership and recursive multicall", "tests/decode.test.ts", "unit", () => {
  const approved = decodeBundle(demo.approvedCalls);
  assert.equal(approved.length, 3);
  assert.match(approved[0].humanText, /GrowthLabs/);
  assert.match(approved[2].humanText, /TreasuryOps/);
  const nested = demo.runs["04-nested-ownership"].submitted[0];
  assert.equal(nested.nested.length, 2);
  assert.equal(nested.nested[1].function, "transferOwnership()");
  assert.match(nested.nested[1].humanText, /ownership of TreasuryProxy/);
  const unknown = decodeAction({ target: ADDRESSES.usdc, value: 0n, data: "0xdeadbeef" });
  assert.equal(unknown.unknown, true);
  assert.match(unknown.humanText, /UNKNOWN FUNCTION/);
});

entry("D2", "Error selectors map to human constraint names", "tests/report.test.ts", "unit", () => {
  const selector = demo.mainRun.report.violatedConstraint?.selector;
  assert.ok(selector);
  const mapped = describeErrorSelector(selector);
  assert.equal(mapped?.name, "SelectorNotAuthorized");
  assert.equal(ERROR_BY_NAME.SelectorNotAuthorized.selector, selector);
});

const scorecardContext = {
  proposalId: demo.proposal.id,
  chainId: 31337,
  executor: ADDRESSES.executor,
  intent: demo.committed,
  evidenceRoot: demo.manifest.root,
  disclosureHash: demo.disclosureHash,
  approvedCalls: demo.approvedCalls,
};

/**
 * Negative probes. The sentinel and disclosure layers used to branch on
 * `scenario.layer` alone, which made their scorecard rows tautologies. These
 * assert the opposite direction: without the evidence, no flag is raised.
 */
const negativeProbes: Record<string, () => void> = {
  "06-delegatecall-payload": () => {
    const realTrace = TRACE_REGISTRY["sentinel-trace-06.json"];
    assert.equal(traceFlagsDelegatecall(realTrace), true, "the real trace must be flagged");
    const cleanTrace = {
      ...realTrace,
      root: {
        type: "CALL",
        from: realTrace.root.from,
        to: realTrace.root.to,
        selector: "0xa9059cbb",
        function: "transfer(address,uint256)",
        children: [],
      },
      flags: [],
    };
    assert.equal(
      traceFlagsDelegatecall(cleanTrace),
      false,
      "a call tree without DELEGATECALL must not be flagged",
    );

    const scenario = demo.scenarioRows.find((row) => row.scenario.id === "06-delegatecall-payload")!
      .scenario;
    const unverifiable = runScenario(
      {
        ...scenario,
        context: { ...scenario.context, sentinel: { flag: "DELEGATECALL", traceFile: "absent.json" } },
      },
      scorecardContext,
    );
    assert.notEqual(
      unverifiable.code,
      "DelegatecallDetected",
      "a missing trace must not assert a delegatecall",
    );
  },
  "10-undisclosed-link": () => {
    const scenario = demo.scenarioRows.find((row) => row.scenario.id === "10-undisclosed-link")!
      .scenario;
    const belowThreshold = runScenario(scenario, scorecardContext, {
      score: 0.1,
      threshold: 0.65,
      claim: "no conflict",
      linkCount: 0,
      payload: {},
    });
    assert.notEqual(
      belowThreshold.status,
      "FLAGGED",
      "a sub-threshold graph must not raise a disclosure flag",
    );
    const zero = runScenario(scenario, scorecardContext, {
      score: 0,
      threshold: 0.65,
      claim: "no conflict",
      linkCount: 0,
      payload: {},
    });
    assert.notEqual(zero.code, "UndisclosedLink", "risk 0.00 across 0 links must not be flagged");
  },
};

for (const row of demo.scenarioRows) {
  entry(
    `S${row.scenario.index}`,
    row.scenario.title,
    "tests/executor.test.ts",
    "reference-model",
    () => {
      assert.equal(
        row.run.status,
        row.scenario.expected.status,
        `Expected status ${row.scenario.expected.status}, got ${row.run.status}`,
      );
      assert.equal(
        row.run.code,
        row.scenario.expected.code,
        `Expected code ${row.scenario.expected.code}, got ${row.run.code}`,
      );
      negativeProbes[row.scenario.id]?.();
    },
  );
}

entry("R1", "Violation report is deterministic and carries the approved vs submitted diff", "tests/report.test.ts", "unit", () => {
  const scenario = demo.scenarioRows.find((row) => row.scenario.id === "03-jargon-upgrade")!.scenario;
  const recreated = runScenario(
    scenario,
    {
      proposalId: demo.proposal.id,
      chainId: 31337,
      executor: ADDRESSES.executor,
      intent: demo.committed,
      evidenceRoot: demo.manifest.root,
      disclosureHash: demo.disclosureHash,
      approvedCalls: demo.approvedCalls,
    },
    demo.challengeSummary ?? undefined,
  );
  assert.equal(JSON.stringify(recreated.report), JSON.stringify(demo.mainRun.report));
  assert.match(demo.mainRun.report.proposalSaid, /align the treasury implementation/);
  assert.equal(demo.mainRun.report.approved.length, 3);
  assert.equal(demo.mainRun.report.submitted.length, 1);
});

entry("G1", "Undisclosed link discovery reaches the noisy-OR threshold", "tests/graph.test.ts", "unit", () => {
  assert.equal(demo.graph.links.length, 4);
  assert.ok(Math.abs(demo.graph.overallRisk - 0.87761696) < 0.0001);
  assert.equal(demo.graph.status, "RED");
  assert.equal(demo.graph.discoveredWallets.length, 3);
  assert.equal(demo.graph.challenge?.links.length, 4);
  const evidenceIds = new Set(demo.graph.challenge?.links.flatMap((link) => link.evidence.map((e) => e.txHash)) ?? []);
  assert.ok(evidenceIds.size >= 4);
});

entry("V1", "Voting score uses quorum, support, informed ratio, concentration and overlap", "tests/scoring.test.ts", "unit", () => {
  assert.ok(Math.abs(demo.voting.metrics.informedRatio - 0.5897435897) < 0.0001);
  assert.ok(Math.abs(demo.voting.score - 0.7094365) < 0.0001);
  assert.equal(demo.voting.status, "AMBER");
  assert.equal(demo.voting.metrics.overlapCount, 1);
});

entry("C1", "Claim score reacts to unresolved items and reviewer resolutions", "tests/scoring.test.ts", "unit", () => {
  assert.ok(Math.abs(demo.claimsScoreAsExtracted.score - 0.6258) < 0.001);
  assert.equal(demo.claimsScoreAsExtracted.status, "AMBER");
  assert.ok(Math.abs(demo.claimsScoreCommitted.score - 0.8085) < 0.001);
  assert.equal(demo.claimsScoreCommitted.status, "GREEN");
  assert.deepEqual(demo.claimsScoreCommitted.rejectedClaimIds, ["c6"]);
});

entry("A1", "Strict source validation accepts the baked extraction and rejects a sourceless claim", "tests/ai.test.ts", "unit", () => {
  assert.equal(demo.validation.ok, true);
  assert.equal(demo.validation.sourceLinked, 7);
  const bad = { ...demo.claims[0], id: "bad-claim", source: undefined } as unknown as (typeof demo.claims)[number];
  const result = validateExtraction({
    claims: [bad],
    intent: demo.extracted,
    manifest: demo.manifest,
  });
  assert.equal(result.ok, false);
  assert.equal(result.rejected.length, 1);
});

entry("A2", "Correct review resolutions reproduce the committed intent exactly", "tests/ai.test.ts", "unit", () => {
  const resolved = applyResolutions(demo.extracted, {
    "upgrade-scope": "reject",
    cadence: "one_time",
  });
  assert.equal(computeIntentHash(resolved), demo.intentHash);
  assert.equal(computeContentHash(resolved), demo.contentHash);
  const unauthorized = applyResolutions(demo.extracted, {
    "upgrade-scope": "authorize",
    cadence: "one_time",
  });
  assert.notEqual(computeIntentHash(unauthorized), demo.intentHash);
  const recurring = applyResolutions(demo.extracted, {
    "upgrade-scope": "reject",
    cadence: "recurring_quarterly",
  });
  assert.notEqual(computeIntentHash(recurring), demo.intentHash);
});

entry("X1", "Execution is a hard gate, not an average of the other stages", "tests/scoring.test.ts", "unit", () => {
  const execution = demo.chain.stages.find((stage) => stage.stage === "EXECUTION");
  assert.ok(execution);
  assert.equal(execution?.score, null);
  assert.equal(execution?.status, "RED");
});

const pending: [string, string, string][] = [
  ["P1", "Solidity intentHash is byte-identical to TypeScript", "contracts/ + test/ (Person A)"],
  ["P2", "ProposalRegistry is append-only and hash-chained on-chain", "contracts/ProposalRegistry.sol (Person A)"],
  ["P3", "Commitment cannot change after voting opens", "contracts/IntentGovernor.sol (Person A)"],
  ["P4", "nonReentrant blocks a real EVM re-entrancy", "contracts/IntentLockExecutor.sol (Person A)"],
  ["P5", "EIP-1967 implementation post-condition holds", "contracts/IntentLockExecutor.sol (Person A)"],
  ["P6", "Timelock and executed flag are enforced on-chain", "test/redteam/ (Person A)"],
  ["P7", "Guardian halt stops a queued proposal", "sentinel/halt.ts (Person A)"],
  ["P8", "Sentinel fork simulation produces a real trace", "sentinel/simulate.ts (Person A)"],
  ["P9", "DisclosureRegistry verifies a challenge on-chain", "contracts/DisclosureRegistry.sol (Person A)"],
];
for (const [id, property, testFile] of pending) {
  results.push({
    id,
    property,
    status: "TEST_REQUIRED",
    testFile,
    durationMs: 0,
    evidenceKind: "pending-solidity",
    reason: "No Solidity layer in this workspace. Shown amber, never green.",
  });
}

const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  testRequired: results.filter((item) => item.status === "TEST_REQUIRED").length,
};

const fixtures = join(process.cwd(), "packages", "shared", "fixtures");
writeFileSync(`${fixtures}/scorecard.json`, `${JSON.stringify(results, null, 2)}\n`, "utf8");
writeFileSync(
  `${fixtures}/scorecard-meta.json`,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      generator: "scripts/scorecard.ts",
      mode: "reference-model (TypeScript)",
      summary,
      note: "Checks executed in-process against the reference executor and shared code. Solidity-only properties are TEST_REQUIRED.",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

for (const item of results) {
  console.log(
    `${item.id.padEnd(4)} ${item.status.padEnd(14)} ${item.property}${item.reason ? ` — ${item.reason}` : ""}`,
  );
}
console.log(`\nPASS ${summary.pass} · FAIL ${summary.fail} · TEST_REQUIRED ${summary.testRequired}`);

if (summary.fail > 0) process.exitCode = 1;

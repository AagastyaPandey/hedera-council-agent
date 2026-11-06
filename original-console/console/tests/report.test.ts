import { describe, expect, it } from "vitest";
import { ADDRESSES, CHAIN_ID, ERROR_BY_NAME } from "../packages/shared/addresses";
import { buildConcreteCalls } from "../packages/shared/calls";
import { runScenario } from "../reference/executor";
import { describeErrorSelector } from "../sentinel/report";
import type { ExecutionContext } from "../reference/types";
import { getDemo } from "../lib/demo";

function context(): ExecutionContext {
  const demo = getDemo();
  return {
    proposalId: demo.proposal.id,
    chainId: CHAIN_ID,
    executor: ADDRESSES.executor,
    intent: demo.committed,
    evidenceRoot: demo.manifest.root,
    disclosureHash: demo.disclosureHash,
    approvedCalls: demo.approvedCalls,
  };
}

describe("violation report", () => {
  it("is deterministic and carries the approved vs submitted diff", () => {
    const demo = getDemo();
    const scenario = demo.scenarioRows.find((row) => row.scenario.id === "03-jargon-upgrade")!
      .scenario;
    const first = runScenario(scenario, context(), demo.challengeSummary ?? undefined);
    const second = runScenario(scenario, context(), demo.challengeSummary ?? undefined);
    expect(first.report).toEqual(second.report);
    expect(first.report.status).toBe("REJECTED");
    expect(first.report.layer).toBe("executor");
    expect(first.report.approved).toHaveLength(3);
    expect(first.report.submitted).toHaveLength(1);
    expect(first.report.violatedConstraint?.code).toBe("SelectorNotAuthorized");
    expect(first.report.evidence.commitment).toBe(demo.commitment);
    expect(first.report.evidence.submittedCommitment).not.toBe(demo.commitment);
  });

  it("maps the custom error selector to human text", () => {
    const demo = getDemo();
    const selector = demo.mainRun.report.violatedConstraint?.selector;
    expect(selector).toBe(ERROR_BY_NAME.SelectorNotAuthorized.selector);
    const mapped = describeErrorSelector(selector!);
    expect(mapped?.name).toBe("SelectorNotAuthorized");
    expect(mapped?.text).toContain("never authorized");
    expect(describeErrorSelector("0x00000000")).toBeNull();
  });

  it("points sentinel reports at the trace fixture", () => {
    const demo = getDemo();
    const run = demo.runs["06-delegatecall-payload"];
    expect(run.report.layer).toBe("sentinel");
    expect(run.report.status).toBe("FLAGGED");
    expect(run.report.evidence.traceRef).toBe("sentinel-trace-06.json");
    expect(run.report.evidence.txHash).toBeNull();
    expect(run.report.violatedConstraint?.code).toBe("DelegatecallDetected");
  });

  it("keeps the decoded nested tree in the report evidence", () => {
    const demo = getDemo();
    const scenario = demo.scenarioRows.find((row) => row.scenario.id === "04-nested-ownership")!;
    expect(scenario.run.report.submitted[0].nested[1].humanText).toContain(
      "ownership of TreasuryProxy",
    );
    expect(scenario.run.report.violatedConstraint?.message).toContain("Multicall child #2");
  });

  it("encodes revert data that starts with the mapped selector", () => {
    const [call] = buildConcreteCalls([
      {
        kind: "ERC20_TRANSFER",
        target: ADDRESSES.usdc,
        counterparty: ADDRESSES.attacker,
        amount: "1",
      },
    ]);
    expect(call.data.slice(0, 10)).toBe("0xa9059cbb");
    const demo = getDemo();
    expect(demo.runs["02-amount-inflation"].revertData.slice(0, 10)).toBe(
      ERROR_BY_NAME.ExceedsSpendLimit.selector,
    );
  });
});

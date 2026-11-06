import { describe, expect, it } from "vitest";
import {
  buildEvaluationChain,
  scoreClaims,
  scoreCoi,
  scoreExecution,
  scoreVoting,
} from "../chain-scoring/score";
import { getDemo } from "../lib/demo";

describe("evaluation chain", () => {
  it("scores the extracted claims lower than the reviewed claims", () => {
    const demo = getDemo();
    expect(demo.claimsScoreAsExtracted.score).toBeCloseTo(0.6258, 3);
    expect(demo.claimsScoreAsExtracted.status).toBe("AMBER");
    expect(demo.claimsScoreAsExtracted.open).toBe(2);
    expect(demo.claimsScoreCommitted.score).toBeCloseTo(0.8085, 3);
    expect(demo.claimsScoreCommitted.status).toBe("GREEN");
    expect(demo.claimsScoreCommitted.open).toBe(0);
    expect(demo.claimsScoreCommitted.rejectedClaimIds).toEqual(["c6"]);
  });

  it("raises the claim score as ambiguities are resolved", () => {
    const demo = getDemo();
    const partial = scoreClaims(demo.validation.claims, demo.extracted.unresolved, {
      cadence: "one_time",
    });
    expect(partial.score).toBeGreaterThan(demo.claimsScoreAsExtracted.score);
    expect(partial.score).toBeLessThan(demo.claimsScoreCommitted.score);
    expect(partial.open).toBe(1);
  });

  it("scores COI from the graph risk", () => {
    const demo = getDemo();
    const coi = scoreCoi(demo.graph);
    expect(coi.status).toBe("RED");
    expect(coi.score).toBeCloseTo(demo.graph.overallRisk, 6);
    expect(coi.factors).toHaveLength(5);
  });

  it("scores voting with informed ratio and overlap penalty", () => {
    const demo = getDemo();
    const voting = scoreVoting(demo.votes, demo.committed.version);
    expect(voting.metrics.informedRatio).toBeCloseTo(0.5897435, 6);
    expect(voting.metrics.supportRatio).toBeCloseTo(0.6849315, 6);
    expect(voting.metrics.turnout).toBeCloseTo(0.78, 6);
    expect(voting.metrics.overlapCount).toBe(1);
    expect(voting.score).toBeCloseTo(0.7094365, 6);
    expect(voting.status).toBe("AMBER");
  });

  it("treats execution as a hard gate, not a score", () => {
    const demo = getDemo();
    const execution = scoreExecution(demo.mainRun);
    expect(execution.score).toBeNull();
    expect(execution.status).toBe("RED");
    expect(execution.reason).toContain("SelectorNotAuthorized");
    expect(demo.chain.stages.map((stage) => stage.stage)).toEqual([
      "CLAIMS",
      "COI",
      "VOTING",
      "EXECUTION",
    ]);
  });

  it("builds the four-stage chain with drilldowns", () => {
    const demo = getDemo();
    const chain = buildEvaluationChain({
      proposalId: demo.proposal.id,
      claims: demo.claimsScoreCommitted,
      coi: scoreCoi(demo.graph),
      voting: demo.voting,
      execution: demo.mainRun,
    });
    expect(chain.stages).toHaveLength(4);
    expect(chain.stages[0].drilldown).toBe("/intent");
    expect(chain.stages[1].drilldown).toBe("/graph");
    expect(chain.stages[2].drilldown).toBe("/vote");
    expect(chain.stages[3].drilldown).toBe("/arena/03-jargon-upgrade");
    expect(chain.stages[0].factors.length).toBeGreaterThan(2);
  });
});

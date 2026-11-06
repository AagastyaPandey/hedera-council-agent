import { describe, expect, it } from "vitest";
import { analyzeGraph, challengeHash } from "../graph/discover";
import { getDemo } from "../lib/demo";

describe("wallet graph", () => {
  it("discovers four links and aggregates them with noisy-OR", () => {
    const demo = getDemo();
    expect(demo.graph.links).toHaveLength(4);
    expect(demo.graph.links.filter((link) => link.type === "DIRECT_TRANSFER")).toHaveLength(2);
    expect(demo.graph.links.filter((link) => link.type === "COMMON_FUNDER")).toHaveLength(1);
    expect(demo.graph.links.filter((link) => link.type === "TIME_CORRELATED")).toHaveLength(1);
    expect(demo.graph.overallRisk).toBeCloseTo(0.87761696, 6);
    expect(demo.graph.status).toBe("RED");
    expect(demo.graph.discoveredWallets).toHaveLength(3);
  });

  it("attaches transaction evidence to every discovered link", () => {
    const demo = getDemo();
    for (const link of demo.graph.links) {
      expect(link.txHashes.length).toBeGreaterThan(0);
      expect(link.evidenceEdgeIds.length).toBeGreaterThan(0);
      expect(link.description.length).toBeGreaterThan(10);
    }
    const common = demo.graph.links.find((link) => link.type === "COMMON_FUNDER")!;
    expect(common.evidenceEdgeIds).toEqual(["e3", "e4"]);
    expect(common.txHashes).toHaveLength(2);
  });

  it("produces a challenge payload with the disclosure hash and links", () => {
    const demo = getDemo();
    expect(demo.graph.challenge).not.toBeNull();
    expect(demo.graph.challenge?.proposalId).toBe("AIP-042");
    expect(demo.graph.challenge?.disclosureHash).toBe(demo.disclosureHash);
    expect(demo.graph.challenge?.links).toHaveLength(4);
    expect(demo.graph.challenge?.threshold).toBe(0.65);
    const digestA = challengeHash(demo.graph.challenge!);
    const digestB = challengeHash(demo.graph.challenge!);
    expect(digestA).toBe(digestB);
  });

  it("damps a link when every endpoint is disclosed", () => {
    const demo = getDemo();
    const allAddresses = demo.graph.fixture.nodes.map((node) => node.address);
    const allDisclosed = analyzeGraph(demo.graph.fixture, allAddresses);
    const direct = allDisclosed.links.find((link) => link.type === "DIRECT_TRANSFER")!;
    expect(direct.disclosed).toBe(true);
    expect(direct.multiplier).toBe(0.35);
    expect(direct.strength).toBeCloseTo(0.48 * 0.35, 6);
    expect(allDisclosed.overallRisk).toBeLessThan(demo.graph.overallRisk);
  });

  it("keeps cautious language in the analysis", () => {
    const demo = getDemo();
    expect(demo.graph.disclaimer).toContain("not a conclusion of wrongdoing");
    expect(demo.graph.disclaimer).toContain("SIMULATED DATA");
  });
});

import { describe, expect, it } from "vitest";
import { applyResolutions } from "../ai/resolve";
import { buildTreasuryBrief } from "../ai/brief";
import { validateExtraction } from "../ai/validate";
import { computeContentHash, computeIntentHash } from "../packages/shared/hash";
import type { Claim } from "../packages/shared/schemas";
import { getDemo } from "../lib/demo";

describe("AI intent validation and review", () => {
  it("accepts the baked extraction with every claim source-linked", () => {
    const demo = getDemo();
    expect(demo.validation.ok).toBe(true);
    expect(demo.validation.totalClaims).toBe(7);
    expect(demo.validation.sourceLinked).toBe(7);
    expect(demo.validation.rejected).toHaveLength(0);
    expect(demo.validation.warnings).toHaveLength(1);
    expect(demo.validation.actionCount).toBe(4);
  });

  it("rejects a claim without a source", () => {
    const demo = getDemo();
    const bad = { ...demo.claims[0], id: "no-source", source: undefined } as unknown as Claim;
    const result = validateExtraction({
      claims: [bad],
      intent: demo.extracted,
      manifest: demo.manifest,
    });
    expect(result.ok).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.sourceLinked).toBe(0);
  });

  it("rejects a claim whose quote is not in the document", () => {
    const demo = getDemo();
    const bad = {
      ...demo.claims[0],
      id: "bad-quote",
      source: { ...demo.claims[0].source, quote: "an invented quote" },
    };
    const result = validateExtraction({
      claims: [bad],
      intent: demo.extracted,
      manifest: demo.manifest,
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0].kind).toBe("source");
  });

  it("reproduces the committed intent only with the correct resolutions", () => {
    const demo = getDemo();
    const correct = applyResolutions(demo.extracted, {
      "upgrade-scope": "reject",
      cadence: "one_time",
    });
    expect(computeIntentHash(correct)).toBe(demo.intentHash);
    expect(computeContentHash(correct)).toBe(demo.contentHash);
    expect(correct.unresolved).toHaveLength(0);
    expect(correct.assumptions).toHaveLength(3);

    const upgrade = applyResolutions(demo.extracted, {
      "upgrade-scope": "authorize",
      cadence: "one_time",
    });
    expect(computeIntentHash(upgrade)).not.toBe(demo.intentHash);

    const recurring = applyResolutions(demo.extracted, {
      "upgrade-scope": "reject",
      cadence: "recurring_quarterly",
    });
    expect(computeIntentHash(recurring)).not.toBe(demo.intentHash);
  });

  it("drops the tentative upgrade claim when the upgrade is rejected", () => {
    const demo = getDemo();
    const rejected = applyResolutions(demo.extracted, {
      "upgrade-scope": "reject",
      cadence: "one_time",
    });
    expect(rejected.actions).toHaveLength(3);
    expect(rejected.actions.some((action) => action.kind === "UPGRADE")).toBe(false);
  });

  it("builds a source-linked treasury brief", () => {
    const demo = getDemo();
    const brief = buildTreasuryBrief(demo.committed, demo.manifest);
    expect(brief.totalGrantsUsdc).toBe("250000000000");
    expect(brief.allowanceUsdc).toBe("5000000000");
    expect(brief.runwayBeforeMonths).toBeCloseTo(9.836, 3);
    expect(brief.runwayAfterMonths).toBeCloseTo(7.787, 3);
    expect(brief.recipients).toHaveLength(2);
    expect(brief.figures).toHaveLength(4);
    for (const figure of brief.figures) {
      expect(figure.source.span).toBeDefined();
      expect(figure.source.docHash).toBeDefined();
    }
  });

  it("recomputes the brief when the cadence changes", () => {
    const demo = getDemo();
    const recurring = applyResolutions(demo.extracted, {
      "upgrade-scope": "reject",
      cadence: "recurring_quarterly",
    });
    const brief = buildTreasuryBrief(recurring, demo.manifest);
    expect(brief.totalGrantsUsdc).toBe("850000000000");
    expect(brief.runwayAfterMonths).toBeCloseTo(2.869, 3);
  });
});

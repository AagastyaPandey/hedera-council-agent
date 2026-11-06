/**
 * intelligence/__tests__/tiny-model.test.ts
 *
 * Unit tests for the tiny, dependency-free benefit classifier and the
 * recommendation decision engine built on top of it.
 *
 * Run with:   npx ts-mocha --timeout 10000 intelligence/__tests__/tiny-model.test.ts
 *             or via:  npm run test:decide
 *
 * Coverage:
 *   [tiny-model]
 *     - sigmoid is monotonic and bounded to (0, 1).
 *     - clamp01 clamps out-of-range and non-finite values.
 *     - predict() decomposes the score into per-feature contributions that
 *       sum to the logit (bias + sum(contributions)).
 *     - predict() thresholds exactly at model.threshold.
 *     - trainTinyModel() learns a linearly separable set from scratch.
 *     - trainTinyModel() is deterministic (same data -> same weights).
 *     - modelToJson / modelFromJson round-trip, and reject bad payloads.
 *
 *   [recommendation]
 *     - featuresFromRecommendation: missing amount is the worst case, not zero.
 *     - featuresFromRecommendation: known vs unknown recipient.
 *     - featuresFromRecommendation: voteQuality is participation x informed.
 *     - decideRecommendation matches the expected ACCEPT/DENY for all
 *       labelled fixtures.
 *     - decideRecommendation explains itself (non-empty reasons).
 *     - decideRecommendation is deterministic.
 *     - formatDecision renders the decision.
 */

import { strict as assert } from "assert";
import { readFileSync } from "fs";
import * as path from "path";

import {
  DEFAULT_MODEL,
  FEATURE_NAMES,
  accuracy,
  clamp01,
  modelFromJson,
  modelToJson,
  predict,
  sigmoid,
  trainTinyModel,
  type BenefitFeatures,
  type TinyModel,
  type TrainingExample,
} from "../tiny-model";

import {
  decideRecommendation,
  featuresFromRecommendation,
  formatDecision,
  type Recommendation,
} from "../recommendation";

import { bridgeIntent, BridgeError } from "../intent-bridge";

// ============================================================================
// Helpers
// ============================================================================

function features(overrides: Partial<BenefitFeatures> = {}): BenefitFeatures {
  const base: BenefitFeatures = {
    spendRatio: 0.1,
    runwayAfter: 0.8,
    recipientKnown: 1,
    recipientUnknown: 0,
    evidenceLinked: 1,
    coiRisk: 0,
    selectorAuthorized: 1,
    voteQuality: 0.7,
    disclosure: 1,
  };
  return { ...base, ...overrides };
}

const FIXTURES: Array<Recommendation & { id: string; label: 0 | 1 }> = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "recommendations.json"), "utf8")
);

// ============================================================================
// tiny-model
// ============================================================================

describe("tiny-model", () => {
  describe("sigmoid / clamp01", () => {
    it("sigmoid is bounded and strictly increasing", () => {
      // Saturates: e^-100 is ~3.7e-44, so sigmoid(100) rounds to exactly 1.
      assert.equal(sigmoid(100), 1);
      assert.ok(sigmoid(-100) > 0 && sigmoid(-100) < 0.01);
      assert.ok(sigmoid(0) > 0.4999 && sigmoid(0) < 0.5001);
      assert.ok(sigmoid(-2) < sigmoid(0));
      assert.ok(sigmoid(0) < sigmoid(2));
    });

    it("never returns a negative or non-finite probability", () => {
      for (const z of [-1e6, -100, -1, 0, 1, 100, 1e6]) {
        const value = sigmoid(z);
        assert.ok(Number.isFinite(value), `sigmoid(${z}) was ${value}`);
        assert.ok(value >= 0 && value <= 1, `sigmoid(${z}) was ${value}`);
      }
    });

    it("clamp01 clamps to [0, 1] and rejects non-finite values", () => {
      assert.equal(clamp01(0.42), 0.42);
      assert.equal(clamp01(-3), 0);
      assert.equal(clamp01(9), 1);
      assert.equal(clamp01(Number.NaN), 0);
      assert.equal(clamp01(Number.POSITIVE_INFINITY), 0);
    });
  });

  describe("predict", () => {
    it("decomposes the score into contributions that sum to the logit", () => {
      const f = features();
      const result = predict(DEFAULT_MODEL, f);
      const logit = DEFAULT_MODEL.bias + result.contributions.reduce((sum, c) => sum + c.contribution, 0);
      assert.ok(Math.abs(result.score - sigmoid(logit)) < 1e-12);
      assert.equal(result.contributions.length, FEATURE_NAMES.length);
    });

    it("emits one contribution per declared feature, in order", () => {
      const result = predict(DEFAULT_MODEL, features());
      result.contributions.forEach((contribution, index) => {
        assert.equal(contribution.feature, FEATURE_NAMES[index]);
        assert.equal(contribution.contribution, contribution.weight * contribution.value);
      });
    });

    it("treats missing features as zero", () => {
      const empty = predict(DEFAULT_MODEL, {} as BenefitFeatures);
      assert.equal(empty.score, sigmoid(DEFAULT_MODEL.bias));
      assert.equal(empty.decision, "DENY");
    });

    it("ACCEPTs a healthy recommendation and DENYs a risky one", () => {
      const good = predict(DEFAULT_MODEL, features());
      assert.equal(good.decision, "ACCEPT");
      assert.ok(good.score >= 0.5);

      const bad = predict(
        DEFAULT_MODEL,
        features({ spendRatio: 1, runwayAfter: 0, recipientKnown: 0, recipientUnknown: 1, coiRisk: 0.9, evidenceLinked: 0.1 })
      );
      assert.equal(bad.decision, "DENY");
      assert.ok(bad.score < 0.5);
    });

    it("thresholds exactly at model.threshold", () => {
      const model: TinyModel = { ...DEFAULT_MODEL, bias: 0, weights: [0, 0, 0, 0, 0, 0, 0, 0, 0], threshold: 0.5 };
      const at = predict(model, features());
      assert.equal(at.score, 0.5);
      assert.equal(at.decision, "ACCEPT");

      const strict: TinyModel = { ...model, threshold: 0.51 };
      assert.equal(predict(strict, features()).decision, "DENY");
    });
  });

  describe("trainTinyModel", () => {
    const separable: TrainingExample[] = [
      { features: features(), label: 1 },
      { features: features({ recipientKnown: 1, coiRisk: 0, evidenceLinked: 1 }), label: 1 },
      { features: features({ spendRatio: 1, runwayAfter: 0, coiRisk: 1, recipientUnknown: 1 }), label: 0 },
      { features: features({ spendRatio: 0.9, runwayAfter: 0, coiRisk: 0.8, recipientUnknown: 1 }), label: 0 },
    ];

    it("learns a linearly separable set", () => {
      const trained = trainTinyModel(separable, { init: { ...DEFAULT_MODEL, bias: 0, weights: [0, 0, 0, 0, 0, 0, 0, 0, 0] } });
      assert.ok(accuracy(trained, separable) >= 1);
    });

    it("is deterministic: same data yields the same weights", () => {
      const a = trainTinyModel(separable);
      const b = trainTinyModel(separable);
      assert.deepEqual(a.weights, b.weights);
      assert.equal(a.bias, b.bias);
    });

    it("returns a usable model for an empty training set", () => {
      const empty = trainTinyModel([]);
      assert.equal(empty.weights.length, FEATURE_NAMES.length);
      assert.equal(empty.featureNames.length, FEATURE_NAMES.length);
    });

    it("generalises to the labelled fixtures after training on them", () => {
      const examples: TrainingExample[] = FIXTURES.map((fixture) => ({
        features: featuresFromRecommendation(fixture),
        label: fixture.label,
      }));
      const trained = trainTinyModel(examples);
      assert.ok(accuracy(trained, examples) >= 0.9, `accuracy was ${accuracy(trained, examples)}`);
    });
  });

  describe("serialisation", () => {
    it("round-trips through JSON", () => {
      const restored = modelFromJson(JSON.parse(modelToJson(DEFAULT_MODEL)));
      assert.ok(restored);
      assert.deepEqual(restored, DEFAULT_MODEL);
    });

    it("rejects malformed payloads", () => {
      assert.equal(modelFromJson(null), null);
      assert.equal(modelFromJson("nope"), null);
      assert.equal(modelFromJson({ weights: [1, 2] }), null);
      assert.equal(modelFromJson({ weights: [1, 2, 3, 4, 5, 6, 7, 8, "x"] }), null);
    });
  });
});

// ============================================================================
// recommendation
// ============================================================================

describe("recommendation", () => {
  describe("featuresFromRecommendation", () => {
    it("treats a missing amount as the worst case, not as zero", () => {
      const f = featuresFromRecommendation({
        user: "agastya",
        text: "Transfer funds to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
      });
      assert.equal(f.spendRatio, 1);
      assert.equal(f.runwayAfter, 0);
    });

    it("reads the amount and recipient out of the text", () => {
      const f = featuresFromRecommendation({
        user: "agastya",
        text: "Transfer 5,000 USDC to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 for the Q3 audit.",
      });
      assert.ok(f.spendRatio > 0 && f.spendRatio < 0.01);
      assert.equal(f.recipientKnown, 0);
      assert.equal(f.recipientUnknown, 1);
    });

    it("marks an allowlisted recipient as known", () => {
      const f = featuresFromRecommendation({
        user: "agastya",
        text: "Transfer 5,000 USDC to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 for the Q3 audit.",
        knownRecipients: ["0x14dc79964da2c08b23698b3d3cc7ca32193d9955"],
      });
      assert.equal(f.recipientKnown, 1);
      assert.equal(f.recipientUnknown, 0);
    });

    it("computes voteQuality as participation x informed", () => {
      const f = featuresFromRecommendation({
        user: "agastya",
        text: "Vote on the proposal.",
        participation: 0.5,
        informed: 0.4,
      });
      assert.ok(Math.abs(f.voteQuality - 0.2) < 1e-12);
    });

    it("keeps every feature inside [0, 1]", () => {
      for (const fixture of FIXTURES) {
        const f = featuresFromRecommendation(fixture);
        for (const name of FEATURE_NAMES) {
          assert.ok(f[name] >= 0 && f[name] <= 1, `${name} out of range for ${fixture.id}`);
        }
      }
    });
  });

  describe("decideRecommendation", () => {
    it("matches the expected ACCEPT/DENY for every labelled fixture", () => {
      for (const fixture of FIXTURES) {
        const decision = decideRecommendation(fixture);
        const expected = fixture.label === 1 ? "ACCEPT" : "DENY";
        assert.equal(
          decision.decision,
          expected,
          `${fixture.id}: expected ${expected}, got ${decision.decision} (benefit ${decision.benefit.toFixed(3)})`
        );
      }
    });

    it("returns a benefit score in [0, 1]", () => {
      for (const fixture of FIXTURES) {
        const decision = decideRecommendation(fixture);
        assert.ok(decision.benefit >= 0 && decision.benefit <= 1);
      }
    });

    it("explains itself with non-empty reasons", () => {
      for (const fixture of FIXTURES) {
        const decision = decideRecommendation(fixture);
        assert.ok(decision.reasons.length > 0, `${fixture.id} produced no reasons`);
        assert.ok(decision.reasons.length <= 4);
      }
    });

    it("is deterministic", () => {
      for (const fixture of FIXTURES) {
        const a = decideRecommendation(fixture);
        const b = decideRecommendation(fixture);
        assert.equal(a.decision, b.decision);
        assert.equal(a.benefit, b.benefit);
        assert.deepEqual(a.contributions, b.contributions);
      }
    });

    it("carries the parsed intent through to the decision", () => {
      const decision = decideRecommendation(FIXTURES[0]);
      assert.ok(decision.intent);
      assert.ok(Array.isArray(decision.intent.actions));
    });

    it("leaves the plan blocked when the token contract cannot be resolved", () => {
      const decision = decideRecommendation(FIXTURES[0]);
      assert.ok(decision.intent.unresolved.length > 0);
      assert.throws(() => bridgeIntent(decision.intent), BridgeError);
    });

    it("bridges to executable calldata once the token registry is supplied", () => {
      const decision = decideRecommendation({
        ...FIXTURES[0],
        knownAddresses: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
      });

      assert.equal(decision.intent.unresolved.length, 0);

      const bridged = bridgeIntent(decision.intent);
      assert.equal(bridged.actions.length, 1);
      assert.equal(bridged.actions[0].target.toLowerCase(), "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
      // ERC20 transfer(address,uint256) selector.
      assert.ok(bridged.actions[0].data.startsWith("0xa9059cbb"));
      // The calldata is selector(4) + address(32) + amount(32).
      const hex = bridged.actions[0].data.slice(2);
      assert.equal(hex.length, 8 + 64 + 64);
      const addressWord = hex.slice(8, 8 + 64);
      const amountWord = hex.slice(8 + 64);
      assert.equal(amountWord.length, 64);
      // 5,000 USDC at 6 decimals = 5,000,000,000.
      assert.equal(BigInt(`0x${amountWord}`), 5_000_000_000n);
      // The recipient is the allowlisted counterparty, ABI left-padded.
      assert.equal(
        `0x${addressWord}`,
        "0x00000000000000000000000014dc79964da2c08b23698b3d3cc7ca32193d9955"
      );
      assert.ok(bridged.intentHash.startsWith("0x"));
      assert.ok(bridged.actionsHash.startsWith("0x"));
    });

    it("denies a recommendation with a huge spend to a known recipient", () => {
      const decision = decideRecommendation({
        user: "agastya",
        text: "Transfer 1,000,000 USDC to 0x00000000000000000000000000000000000000c1 in one payment.",
        amountUsdc: 1_000_000,
        recipient: "0x00000000000000000000000000000000000000c1",
        knownRecipients: ["0x00000000000000000000000000000000000000c1"],
        evidenceLinked: 1,
        coiRisk: 0,
        selectorAuthorized: true,
        participation: 0.7,
        informed: 1,
        disclosure: true,
      });
      assert.equal(decision.decision, "DENY");
    });

    it("denies a conflict-of-interest hit even on a small spend", () => {
      const decision = decideRecommendation({
        user: "agastya",
        text: "Transfer 20,000 USDC to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 for advisory work.",
        amountUsdc: 20_000,
        recipient: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
        knownRecipients: ["0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"],
        evidenceLinked: 0.8,
        coiRisk: 0.9,
        selectorAuthorized: true,
        participation: 0.4,
        informed: 0.8,
        disclosure: false,
      });
      assert.equal(decision.decision, "DENY");
    });
  });

  describe("formatDecision", () => {
    it("renders the decision, reasons and features", () => {
      const output = formatDecision(decideRecommendation(FIXTURES[0]));
      assert.ok(output.includes("ACCEPT"));
      assert.ok(output.includes("WHY"));
      assert.ok(output.includes("FEATURES"));
      assert.ok(output.includes("spendRatio"));
    });
  });
});

/**
 * intelligence/recommendation.ts
 *
 * One recommendation -> ACCEPT or DENY, using the tiny 9-feature logistic
 * regression in tiny-model.ts. No network, no LLM, no API key, no tokenizer.
 *
 * The model answers a single question: is this recommendation in the
 * treasury's benefit? Every decision decomposes into weighted feature
 * contributions, so the answer is always explainable.
 */

import { extractIntentHeuristic, type ActionKindName, type IntentSpec } from "./ai-draft";
import {
  DEFAULT_MODEL,
  clamp01,
  predict,
  type BenefitFeatures,
  type Contribution,
  type TinyModel,
} from "./tiny-model";

export interface Recommendation {
  /** Who made the recommendation. */
  user: string;
  /** The recommendation text. */
  text: string;
  /** Structured facts, when the caller already has them. */
  amountUsdc?: number;
  recipient?: string;
  action?: ActionKindName;
  treasuryUsdc?: number;
  monthlyBurnUsdc?: number;
  knownRecipients?: string[];
  /**
   * Contract name -> address (e.g. { USDC: "0xA0b8..." }). The treasury's token
   * registry. Without it the intent cannot resolve a named token, so the plan
   * stays blocked rather than guessing a token contract.
   */
  knownAddresses?: Record<string, string>;
  /** 0..1 — share of claims backed by evidence. */
  evidenceLinked?: number;
  /** 0..1 — conflict-of-interest risk. */
  coiRisk?: number;
  selectorAuthorized?: boolean;
  /** 0..1 — vote participation. */
  participation?: number;
  /** 0..1 — share of voters who read the proposal. */
  informed?: number;
  disclosure?: boolean;
}

export interface Decision {
  user: string;
  recommendation: string;
  decision: "ACCEPT" | "DENY";
  /** Benefit probability, 0..1. */
  benefit: number;
  features: BenefitFeatures;
  contributions: Contribution[];
  reasons: string[];
  /** Parsed actions, for context. */
  intent: IntentSpec;
}

const DEFAULT_TREASURY_USDC = 1_200_000;
const DEFAULT_MONTHLY_BURN_USDC = 122_000;

const LABELS: Record<keyof BenefitFeatures, string> = {
  spendRatio: "share of treasury requested",
  runwayAfter: "runway left after the spend",
  recipientKnown: "recipient is on the allowlist",
  recipientUnknown: "recipient is not on the allowlist",
  evidenceLinked: "claims are backed by evidence",
  coiRisk: "conflict-of-interest risk",
  selectorAuthorized: "function selector is authorised",
  voteQuality: "vote participation x informed",
  disclosure: "disclosure is present",
};

/**
 * Build the model's input vector. Missing structured facts are derived from
 * the text; a missing amount is treated as the worst case, not as zero.
 */
export function featuresFromRecommendation(rec: Recommendation): BenefitFeatures {
  const intent = extractIntentHeuristic(rec.text, { knownAddresses: rec.knownAddresses });
  const amount = rec.amountUsdc ?? amountFromText(rec.text);
  const recipient = (rec.recipient ?? recipientFromText(rec.text) ?? "").toLowerCase();
  const treasury = rec.treasuryUsdc ?? DEFAULT_TREASURY_USDC;
  const burn = rec.monthlyBurnUsdc ?? DEFAULT_MONTHLY_BURN_USDC;
  const allowlist = (rec.knownRecipients ?? []).map((address) => address.toLowerCase());

  const hasRecipient = recipient.length > 0;
  const isKnown = hasRecipient && allowlist.includes(recipient);
  const hasAmount = amount > 0;
  const selectorAuthorized =
    rec.selectorAuthorized ??
    (intent.actions.length > 0 && intent.actions.every((action) => Boolean(action.selector)));

  return {
    spendRatio: clamp01(hasAmount ? amount / Math.max(1, treasury) : 1),
    runwayAfter: clamp01(hasAmount ? (treasury - amount) / Math.max(1, burn) / 24 : 0),
    recipientKnown: isKnown ? 1 : 0,
    recipientUnknown: hasRecipient && !isKnown ? 1 : 0,
    evidenceLinked: clamp01(rec.evidenceLinked ?? evidenceFromIntent(intent)),
    coiRisk: clamp01(rec.coiRisk ?? 0),
    selectorAuthorized: selectorAuthorized ? 1 : 0,
    voteQuality: clamp01((rec.participation ?? 0) * (rec.informed ?? 0)),
    disclosure: rec.disclosure ? 1 : 0,
  };
}

export function decideRecommendation(
  rec: Recommendation,
  model: TinyModel = DEFAULT_MODEL
): Decision {
  const intent = extractIntentHeuristic(rec.text, { knownAddresses: rec.knownAddresses });
  const features = featuresFromRecommendation(rec);
  const prediction = predict(model, features);

  return {
    user: rec.user,
    recommendation: rec.text,
    decision: prediction.decision,
    benefit: prediction.score,
    features,
    contributions: prediction.contributions,
    reasons: explain(prediction.contributions),
    intent,
  };
}

export function formatDecision(decision: Decision): string {
  const lines = [
    `DECISION · ${decision.decision}  (benefit ${(decision.benefit * 100).toFixed(1)}%)`,
    `user: ${decision.user}`,
    "",
    decision.recommendation,
    "",
    "WHY",
    ...decision.reasons.map((reason) => `  ${reason}`),
    "",
    "FEATURES",
    ...Object.entries(decision.features).map(
      ([name, value]) => `  ${name.padEnd(20)} ${value.toFixed(3)}`
    ),
  ];
  return lines.join("\n");
}

function amountFromText(text: string): number {
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(USDC|USDT|DAI)\b/i);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function recipientFromText(text: string): string | null {
  const match = text.match(/0x[0-9a-fA-F]{40}/);
  return match ? match[0] : null;
}

function evidenceFromIntent(intent: IntentSpec): number {
  if (intent.actions.length === 0) return 0;
  const grounded = intent.actions.filter((action) => action.source && action.source.span).length;
  return grounded / intent.actions.length;
}

function explain(contributions: Contribution[]): string[] {
  return contributions
    .filter((item) => Math.abs(item.contribution) > 0.04)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4)
    .map((item) => {
      const sign = item.contribution >= 0 ? "+" : "";
      return `${sign}${item.contribution.toFixed(2)}  ${LABELS[item.feature]}`;
    });
}

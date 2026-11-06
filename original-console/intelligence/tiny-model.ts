/**
 * intelligence/tiny-model.ts
 *
 * A tiny, dependency-free benefit classifier: a 9-feature logistic regression.
 * The whole model is a bias plus nine weights — a few hundred bytes, no
 * network, no API key, no tokenizer. It runs in microseconds.
 *
 * It answers one question: is this recommendation in the treasury's benefit?
 * Because the model is linear, every decision decomposes into per-feature
 * contributions, so the answer is always explainable.
 */

export const FEATURE_NAMES = [
  "spendRatio",
  "runwayAfter",
  "recipientKnown",
  "recipientUnknown",
  "evidenceLinked",
  "coiRisk",
  "selectorAuthorized",
  "voteQuality",
  "disclosure",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type BenefitFeatures = Record<FeatureName, number>;

export interface TinyModel {
  bias: number;
  weights: number[];
  threshold: number;
  featureNames: FeatureName[];
}

export interface Contribution {
  feature: FeatureName;
  value: number;
  weight: number;
  contribution: number;
}

export interface Prediction {
  /** Benefit probability, 0..1. */
  score: number;
  decision: "ACCEPT" | "DENY";
  contributions: Contribution[];
}

/**
 * Hand-set prior policy, in the same units as the features.
 *   spendRatio        -5.5  (spending most of the treasury is disqualifying)
 *   runwayAfter       +2.0  (more runway left is better)
 *   recipientKnown    +1.3  (allowlisted recipient)
 *   recipientUnknown  -2.8  (unlisted recipient is a strong negative)
 *   evidenceLinked    +1.2  (claims backed by evidence)
 *   coiRisk           -3.5  (conflict of interest is a hard negative)
 *   selectorAuthorized +1.3 (the function was committed)
 *   voteQuality       +1.1  (participation x informed)
 *   disclosure        +0.9  (disclosure present)
 */
export const DEFAULT_MODEL: TinyModel = {
  bias: -1.5,
  weights: [-5.5, 2.0, 1.3, -2.8, 1.2, -3.5, 1.3, 1.1, 0.9],
  threshold: 0.5,
  featureNames: [...FEATURE_NAMES],
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function predict(model: TinyModel, features: BenefitFeatures): Prediction {
  let z = model.bias;
  const contributions: Contribution[] = [];

  model.featureNames.forEach((name, index) => {
    const value = clamp01(features[name] ?? 0);
    const weight = model.weights[index] ?? 0;
    const contribution = weight * value;
    z += contribution;
    contributions.push({ feature: name, value, weight, contribution });
  });

  const score = sigmoid(z);
  return {
    score,
    decision: score >= model.threshold ? "ACCEPT" : "DENY",
    contributions,
  };
}

export interface TrainingExample {
  features: BenefitFeatures;
  /** 1 = beneficial (accept), 0 = not beneficial (deny). */
  label: 0 | 1;
}

/**
 * Train by gradient descent on a small labelled set. Deterministic: no
 * shuffling and no random initialisation, so the same data always yields the
 * same weights.
 */
export function trainTinyModel(
  examples: TrainingExample[],
  options: {
    epochs?: number;
    learningRate?: number;
    l2?: number;
    init?: TinyModel;
  } = {}
): TinyModel {
  const epochs = options.epochs ?? 800;
  const learningRate = options.learningRate ?? 0.25;
  const l2 = options.l2 ?? 0.001;
  const n = FEATURE_NAMES.length;
  const init = options.init ?? DEFAULT_MODEL;
  const weights = init.weights.slice(0, n);
  let bias = init.bias;

  if (examples.length === 0) {
    return { ...init, featureNames: [...FEATURE_NAMES] };
  }

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(n).fill(0);
    let gradB = 0;

    for (const example of examples) {
      let z = bias;
      for (let i = 0; i < n; i++) {
        z += weights[i] * clamp01(example.features[FEATURE_NAMES[i]] ?? 0);
      }
      const error = sigmoid(z) - example.label;
      for (let i = 0; i < n; i++) {
        gradW[i] += error * clamp01(example.features[FEATURE_NAMES[i]] ?? 0);
      }
      gradB += error;
    }

    for (let i = 0; i < n; i++) {
      weights[i] -= learningRate * (gradW[i] / examples.length + l2 * weights[i]);
    }
    bias -= learningRate * (gradB / examples.length);
  }

  return { bias, weights, threshold: 0.5, featureNames: [...FEATURE_NAMES] };
}

export function accuracy(model: TinyModel, examples: TrainingExample[]): number {
  if (examples.length === 0) return 0;
  let correct = 0;
  for (const example of examples) {
    const predicted = predict(model, example.features).decision === "ACCEPT" ? 1 : 0;
    if (predicted === example.label) correct++;
  }
  return correct / examples.length;
}

export function modelToJson(model: TinyModel): string {
  return JSON.stringify(model, null, 2);
}

export function modelFromJson(value: unknown): TinyModel | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const weights = Array.isArray(obj.weights) ? obj.weights.map(Number) : [];
  if (weights.length !== FEATURE_NAMES.length || weights.some((w) => !Number.isFinite(w))) {
    return null;
  }
  return {
    bias: Number(obj.bias ?? 0),
    weights,
    threshold: Number(obj.threshold ?? 0.5),
    featureNames: [...FEATURE_NAMES],
  };
}

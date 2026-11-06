/**
 * intelligence/chain.ts
 *
 * Evaluation Chain: produces a structured score for a proposal across four
 * sequential stages: CLAIMS -> COI -> VOTING -> EXECUTION.
 *
 * Key invariants
 * ==============
 * 1. No stage may default to a PASS status when its required data is absent.
 *    Missing data -> status: "UNKNOWN".
 * 2. EXECUTION is a hard gate: it is "GREEN" only when the proposal is
 *    executed (or pending with no Sentinel violation).  Any revert, halt, or
 *    flag -> "RED".
 * 3. All numeric thresholds are co-located in CONFIG with explanatory comments.
 *
 * CLAIMS scoring
 * ==============
 *   score = mean(action.extraction_confidence * evidence_support_fraction)
 *   UNRESOLVED items count 0; unresolved_count and unsupported_count reported.
 *
 * COI scoring
 * ===========
 *   R = 1 - prod(1 - s_j)  [noisy-OR from graph.ts]
 *   adjusted for undisclosed fraction delta:
 *   R_adj = R * (1 + CONFIG.coi.undisclosedPenalty * undisclosed_fraction)
 *   clamped to [0, 1].
 *
 * VOTING scoring
 * ==============
 *   Four sub-signals -> harmonic mean:
 *     1. quorum_margin    = (participation - quorumThreshold) / quorumThreshold
 *     2. informed_ratio   = informed_votes / total_votes
 *     3. concentration    = 1 - HHI(top-N voter weights)  (HHI = Σ w_i^2)
 *     4. coi_overlap      = 1 - (flagged_voters / total_voters)
 *
 * EXECUTION
 * =========
 *   status determined by outcome field; score is 1 for green states, 0 otherwise.
 */

import { noisyOr } from "./graph";

// ---------------------------------------------------------------------------
// CONFIG — all thresholds live here with explanatory comments
// ---------------------------------------------------------------------------

export const CONFIG = {
  claims: {
    /** score >= this -> GREEN */
    greenThreshold: 0.7,
    /** score >= this -> YELLOW */
    yellowThreshold: 0.4,
    /** Fraction of actions that must have evidence support -> factor */
    evidenceSupportWeight: 0.5,
  },
  coi: {
    /** overall risk < this -> GREEN */
    greenThreshold: 0.3,
    /** overall risk < this -> YELLOW */
    yellowThreshold: 0.6,
    /** Multiplier applied proportional to undisclosed link fraction */
    undisclosedPenalty: 0.5,
  },
  voting: {
    /** Harmonic mean >= this -> GREEN */
    greenThreshold: 0.65,
    /** Harmonic mean >= this -> YELLOW */
    yellowThreshold: 0.4,
    /** Number of top voters to include in concentration HHI */
    concentrationTopN: 10,
    /** quorumThreshold used when caller does not supply one */
    defaultQuorumThreshold: 0.4,
  },
  execution: {
    /** Execution outcomes that are considered GREEN */
    greenOutcomes: ["EXECUTED", "PENDING"] as string[],
    /** Execution outcomes that are definitively RED */
    redOutcomes: ["REVERTED", "FLAGGED", "HALTED"] as string[],
    /** A PENDING proposal is only GREEN if no Sentinel violation is present */
    pendingRequiresNoViolation: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Input types (caller-supplied per-proposal data)
// ---------------------------------------------------------------------------

export type StageStatus = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export interface ClaimsInput {
  /** One entry per extracted action. */
  actions: Array<{
    extraction_confidence: number; // 0..1
    evidence_support: number | null; // 0..1 or null if UNRESOLVED
  }>;
}

export interface CoiInput {
  /** Array of adjusted link strengths (s_j after disclosure adjustment). */
  linkStrengths: number[];
  /** Number of undisclosed links out of total links. */
  undisclosedCount: number;
  totalLinkCount: number;
}

export interface VoterRecord {
  address: string;
  weight: number;       // normalised 0..1 or raw token count
  informed: boolean;    // did this voter read the full proposal (off-chain signal)
  coiFlagged: boolean;  // flagged as having a COI with the proposal
}

export interface VotingInput {
  voters: VoterRecord[];
  quorumThreshold?: number; // fraction 0..1 (defaults to CONFIG.voting.defaultQuorumThreshold)
  participationFraction: number; // actual participation 0..1
}

export type ExecutionOutcome =
  | "EXECUTED"
  | "PENDING"
  | "REVERTED"
  | "FLAGGED"
  | "HALTED"
  | "NOT_SUBMITTED";

export interface ExecutionInput {
  outcome: ExecutionOutcome;
  /** Present when outcome is PENDING and a Sentinel violation was detected. */
  sentinelViolation?: boolean;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface StageResult {
  stage: string;
  score: number | null;
  status: StageStatus;
  reason: string;
  factors: Record<string, number | string | boolean | null>;
  drilldown: unknown;
}

export interface EvaluationChain {
  stages: StageResult[];
  /** Overall: first non-GREEN stage status, or GREEN if all pass */
  overallStatus: StageStatus;
}

// ---------------------------------------------------------------------------
// Stage scorers
// ---------------------------------------------------------------------------

// ── CLAIMS ──────────────────────────────────────────────────────────────────

export function scoreClaims(input: ClaimsInput): StageResult {
  if (!input.actions || input.actions.length === 0) {
    return unknownStage("CLAIMS", "No actions provided", {
      action_count: 0,
    });
  }

  let resolved = 0;
  let supported = 0;
  let weightedSum = 0;

  for (const action of input.actions) {
    if (action.evidence_support === null) {
      // UNRESOLVED → treated as 0 in the mean
      weightedSum += 0;
    } else {
      resolved += 1;
      const s = clamp01(action.evidence_support);
      const c = clamp01(action.extraction_confidence);
      if (s > 0) supported += 1;
      weightedSum += c * s;
    }
  }

  const n = input.actions.length;
  const unresolved_count = n - resolved;
  const unsupported_count = resolved - supported;
  const score = round4(weightedSum / n);

  const status = applyThresholds(
    score,
    CONFIG.claims.greenThreshold,
    CONFIG.claims.yellowThreshold
  );

  return {
    stage: "CLAIMS",
    score,
    status,
    reason:
      status === "GREEN"
        ? "All claims are well-grounded with evidence."
        : status === "YELLOW"
        ? "Some claims lack evidence support or have unresolved items."
        : "Claims are poorly supported; too many unresolved or unsupported items.",
    factors: {
      action_count: n,
      unresolved_count,
      unsupported_count,
      mean_confidence_x_support: score,
    },
    drilldown: input.actions,
  };
}

// ── COI ─────────────────────────────────────────────────────────────────────

export function scoreCoi(input: CoiInput): StageResult {
  if (!input.linkStrengths || input.totalLinkCount < 0) {
    return unknownStage("COI", "COI link data is missing", {});
  }

  const baseRisk = noisyOr(input.linkStrengths);
  const undisclosed_fraction =
    input.totalLinkCount === 0
      ? 0
      : clamp01(input.undisclosedCount / input.totalLinkCount);

  const adjusted = clamp01(
    baseRisk * (1 + CONFIG.coi.undisclosedPenalty * undisclosed_fraction)
  );

  // Lower risk = better; invert for GREEN/YELLOW/RED logic.
  let status: StageStatus;
  if (adjusted < CONFIG.coi.greenThreshold) {
    status = "GREEN";
  } else if (adjusted < CONFIG.coi.yellowThreshold) {
    status = "YELLOW";
  } else {
    status = "RED";
  }

  return {
    stage: "COI",
    score: round4(adjusted),
    status,
    reason:
      status === "GREEN"
        ? "Conflict-of-interest risk is low."
        : status === "YELLOW"
        ? "Moderate conflict-of-interest risk; review undisclosed links."
        : "High conflict-of-interest risk; significant undisclosed connections detected.",
    factors: {
      base_noisy_or: round4(baseRisk),
      undisclosed_fraction: round4(undisclosed_fraction),
      adjusted_risk: round4(adjusted),
      link_count: input.totalLinkCount,
      undisclosed_count: input.undisclosedCount,
    },
    drilldown: { linkStrengths: input.linkStrengths },
  };
}

// ── VOTING ───────────────────────────────────────────────────────────────────

export function scoreVoting(input: VotingInput): StageResult {
  const { voters, participationFraction } = input;
  const quorumThreshold =
    input.quorumThreshold ?? CONFIG.voting.defaultQuorumThreshold;

  if (!voters || voters.length === 0) {
    return unknownStage("VOTING", "No voter data provided", {
      quorum_threshold: quorumThreshold,
    });
  }

  const total = voters.length;
  const informedCount = voters.filter((v) => v.informed).length;
  const flaggedCount = voters.filter((v) => v.coiFlagged).length;

  // 1. Quorum margin (clamped to [-1, 1])
  const quorum_margin = clamp(
    (participationFraction - quorumThreshold) / Math.max(quorumThreshold, 0.001),
    -1,
    1
  );
  // Normalise to [0,1] for harmonic mean input.
  const quorum_signal = clamp01((quorum_margin + 1) / 2);

  // 2. Informed vote ratio.
  const informed_ratio = clamp01(informedCount / total);

  // 3. Concentration: 1 - HHI of top-N voter weights.
  const topN = CONFIG.voting.concentrationTopN;
  const weights = voters
    .map((v) => v.weight)
    .sort((a, b) => b - a)
    .slice(0, topN);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let hhi = 0;
  if (totalWeight > 0) {
    for (const w of weights) {
      const share = w / totalWeight;
      hhi += share * share;
    }
  }
  const concentration = clamp01(1 - hhi);

  // 4. COI overlap: 1 - (flagged / total).
  const coi_overlap = clamp01(1 - flaggedCount / total);

  // Harmonic mean of the four signals (all in [0,1]).
  const signals = [quorum_signal, informed_ratio, concentration, coi_overlap];
  const hmean = harmonicMean(signals);
  const score = round4(hmean);

  const status = applyThresholds(
    score,
    CONFIG.voting.greenThreshold,
    CONFIG.voting.yellowThreshold
  );

  return {
    stage: "VOTING",
    score,
    status,
    reason:
      status === "GREEN"
        ? "Vote quality is high: good quorum, informed voters, low concentration, minimal COI."
        : status === "YELLOW"
        ? "Vote quality is moderate; some signals are below ideal."
        : "Vote quality is poor; check quorum, concentration, or COI overlap.",
    factors: {
      quorum_signal: round4(quorum_signal),
      quorum_margin: round4(quorum_margin),
      informed_ratio: round4(informed_ratio),
      concentration: round4(concentration),
      coi_overlap: round4(coi_overlap),
      harmonic_mean: score,
      total_voters: total,
      informed_count: informedCount,
      flagged_count: flaggedCount,
    },
    drilldown: { topNWeights: weights, hhi: round4(hhi) },
  };
}

// ── EXECUTION ────────────────────────────────────────────────────────────────

export function scoreExecution(input: ExecutionInput): StageResult {
  const { outcome, sentinelViolation } = input;

  if (!outcome) {
    return unknownStage("EXECUTION", "Execution outcome is missing", {});
  }

  let status: StageStatus;
  let score: number;
  let reason: string;

  if (CONFIG.execution.redOutcomes.includes(outcome)) {
    status = "RED";
    score = 0;
    reason = `Execution failed with outcome: ${outcome}.`;
  } else if (outcome === "PENDING") {
    if (CONFIG.execution.pendingRequiresNoViolation && sentinelViolation) {
      status = "RED";
      score = 0;
      reason = "Execution is PENDING but a Sentinel violation was detected.";
    } else {
      status = "GREEN";
      score = 1;
      reason = "Execution is pending; no Sentinel violation detected.";
    }
  } else if (outcome === "EXECUTED") {
    status = "GREEN";
    score = 1;
    reason = "Execution completed successfully.";
  } else if (outcome === "NOT_SUBMITTED") {
    // Not yet submitted — we cannot assess; treat as UNKNOWN.
    return unknownStage("EXECUTION", "Proposal has not been submitted for execution.", {
      outcome,
    });
  } else {
    return unknownStage("EXECUTION", `Unrecognised execution outcome: ${outcome}`, {
      outcome,
    });
  }

  return {
    stage: "EXECUTION",
    score,
    status,
    reason,
    factors: {
      outcome,
      sentinel_violation: sentinelViolation ?? null,
    },
    drilldown: null,
  };
}

// ---------------------------------------------------------------------------
// evaluateChain — runs all four stages in order
// ---------------------------------------------------------------------------

export interface ChainInput {
  claims: ClaimsInput;
  coi: CoiInput;
  voting: VotingInput;
  execution: ExecutionInput;
}

export function evaluateChain(input: ChainInput): EvaluationChain {
  const stages: StageResult[] = [
    scoreClaims(input.claims),
    scoreCoi(input.coi),
    scoreVoting(input.voting),
    scoreExecution(input.execution),
  ];

  // Overall = worst non-GREEN status, or GREEN if all are GREEN.
  const priority: StageStatus[] = ["RED", "UNKNOWN", "YELLOW", "GREEN"];
  let overallStatus: StageStatus = "GREEN";
  for (const stage of stages) {
    const currentPriority = priority.indexOf(overallStatus);
    const stagePriority = priority.indexOf(stage.status);
    if (stagePriority < currentPriority) {
      overallStatus = stage.status;
    }
  }

  return { stages, overallStatus };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function unknownStage(
  stage: string,
  reason: string,
  factors: Record<string, number | string | boolean | null>
): StageResult {
  return {
    stage,
    score: null,
    status: "UNKNOWN",
    reason,
    factors,
    drilldown: null,
  };
}

function applyThresholds(
  score: number,
  green: number,
  yellow: number
): StageStatus {
  if (score >= green) return "GREEN";
  if (score >= yellow) return "YELLOW";
  return "RED";
}

function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sumReciprocals = values.reduce(
    (acc, v) => acc + 1 / Math.max(v, 1e-9),
    0
  );
  return values.length / sumReciprocals;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

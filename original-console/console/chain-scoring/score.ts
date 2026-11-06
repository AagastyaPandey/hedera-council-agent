import type { Resolutions } from "../ai/resolve";
import type { GraphAnalysis } from "../graph/discover";
import type {
  Claim,
  EvaluationChain,
  StageFactor,
  StageScore,
  StageStatus,
  UnresolvedItem,
} from "../packages/shared/schemas";
import type { RunResult } from "../reference/types";

export type Vote = {
  id: string;
  voter: string;
  label: string;
  weight: string;
  support: "FOR" | "AGAINST" | "ABSTAIN";
  sawCurrentBrief: boolean;
  briefVersion: number | null;
  overlap: string | null;
};

export type VotesFixture = {
  eligibleWeight: string;
  quorumBps: number;
  votingClosedAt: string;
  votes: Vote[];
};

export type ClaimsScore = {
  score: number;
  status: StageStatus;
  reason: string;
  factors: StageFactor[];
  activeClaims: number;
  open: number;
  resolved: number;
  rejectedClaimIds: string[];
};

export type CoiScore = {
  score: number;
  status: StageStatus;
  reason: string;
  factors: StageFactor[];
};

export type VotingMetrics = {
  castWeight: number;
  forWeight: number;
  againstWeight: number;
  abstainWeight: number;
  informedWeight: number;
  informedRatio: number;
  supportRatio: number;
  turnout: number;
  quorumRatio: number;
  hhi: number;
  overlapCount: number;
  overlapWeight: number;
};

export type VotingScore = {
  score: number;
  status: StageStatus;
  reason: string;
  factors: StageFactor[];
  metrics: VotingMetrics;
};

function summarize(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function scoreClaims(
  claims: Claim[],
  unresolved: UnresolvedItem[],
  resolutions: Resolutions,
): ClaimsScore {
  const openItems = unresolved.filter((item) => !(item.id in resolutions));
  const resolved = unresolved.length - openItems.length;
  const rejectedClaimIds: string[] = [];

  const active = claims.filter((claim) => {
    if (!claim.linkedUnresolvedId) return true;
    const decision = resolutions[claim.linkedUnresolvedId];
    if (!decision) return true;
    if (decision === "reject") {
      rejectedClaimIds.push(claim.id);
      return false;
    }
    return true;
  });

  const supportValues = active.map((claim) => {
    const decided = claim.linkedUnresolvedId && claim.linkedUnresolvedId in resolutions;
    return claim.confidence * (decided ? 1 : claim.support);
  });
  const meanSupport = summarize(supportValues);
  const unresolvedFactor = 1 / (1 + 0.12 * openItems.length);
  const resolvedFactor = 1 - 0.05 * resolved;
  const score = meanSupport * unresolvedFactor * resolvedFactor;
  const status: StageStatus = score >= 0.8 ? "GREEN" : score >= 0.6 ? "AMBER" : "RED";

  const factors: StageFactor[] = [
    {
      label: "Source-linked claims",
      value: `${active.length} of ${claims.length}`,
      detail: rejectedClaimIds.length
        ? `${rejectedClaimIds.length} tentative claim removed by review`
        : "Every retained claim resolves to a document span",
    },
    {
      label: "Mean claim support",
      value: meanSupport.toFixed(2),
      weight: "confidence × evidence support",
    },
    {
      label: "Open ambiguities",
      value: `${openItems.length}`,
      detail: openItems.length
        ? openItems.map((item) => item.id).join(", ")
        : "Reviewer resolved every open question",
    },
    {
      label: "Resolved ambiguities",
      value: `${resolved}`,
      weight: "-5% each",
      detail: "Resolutions are explicit assumptions with sources",
    },
  ];

  if (rejectedClaimIds.length > 0) {
    factors.push({
      label: "Claims removed",
      value: rejectedClaimIds.join(", "),
      detail: "A rejected tentative action is dropped from the rule set",
    });
  }

  return {
    score,
    status,
    reason:
      openItems.length > 0
        ? `${openItems.length} unresolved claim${openItems.length === 1 ? "" : "s"} · reviewer input required`
        : `${active.length} claims source-linked · ${resolved} ambiguities resolved`,
    factors,
    activeClaims: active.length,
    open: openItems.length,
    resolved,
    rejectedClaimIds,
  };
}

export function scoreCoi(analysis: GraphAnalysis): CoiScore {
  const factors: StageFactor[] = analysis.links.map((link) => ({
    label: link.title,
    value: link.strength.toFixed(2),
    weight: `base ${link.baseStrength.toFixed(2)} × ${link.multiplier.toFixed(2)}`,
    detail: link.description,
  }));
  factors.push({
    label: "Noisy-OR aggregation",
    value: analysis.overallRisk.toFixed(3),
    detail: "R = 1 − Π(1 − sⱼ). Undisclosed links keep full weight; disclosed links are damped to 0.35.",
  });

  return {
    score: analysis.overallRisk,
    status: analysis.status,
    reason:
      analysis.overallRisk >= analysis.thresholds.red
        ? `${analysis.links.length} undisclosed links · noisy-OR ${analysis.overallRisk.toFixed(2)}`
        : analysis.links.length > 0
          ? `${analysis.links.length} link${analysis.links.length === 1 ? "" : "s"} below the red threshold`
          : "No disclosed or discovered links",
    factors,
  };
}

export function scoreVoting(votesFixture: VotesFixture, currentBriefVersion: number): VotingScore {
  const votes = votesFixture.votes;
  const eligibleWeight = Number(votesFixture.eligibleWeight);
  const castWeight = votes.reduce((total, vote) => total + Number(vote.weight), 0);
  const forWeight = votes
    .filter((vote) => vote.support === "FOR")
    .reduce((total, vote) => total + Number(vote.weight), 0);
  const againstWeight = votes
    .filter((vote) => vote.support === "AGAINST")
    .reduce((total, vote) => total + Number(vote.weight), 0);
  const abstainWeight = votes
    .filter((vote) => vote.support === "ABSTAIN")
    .reduce((total, vote) => total + Number(vote.weight), 0);
  const informedWeight = votes
    .filter((vote) => vote.sawCurrentBrief && vote.briefVersion === currentBriefVersion)
    .reduce((total, vote) => total + Number(vote.weight), 0);

  const quorumWeight = (eligibleWeight * votesFixture.quorumBps) / 10000;
  const quorumHealth = quorumWeight === 0 ? 1 : Math.min(1, castWeight / quorumWeight);
  const supportRatio = forWeight + againstWeight === 0 ? 0 : forWeight / (forWeight + againstWeight);
  const informedRatio = castWeight === 0 ? 0 : informedWeight / castWeight;
  const turnout = eligibleWeight === 0 ? 0 : castWeight / eligibleWeight;

  const forVotes = votes.filter((vote) => vote.support === "FOR");
  const hhi =
    forWeight === 0
      ? 1
      : forVotes.reduce((total, vote) => {
          const share = Number(vote.weight) / forWeight;
          return total + share * share;
        }, 0);
  const concentrationHealth = 1 - hhi;

  const overlapVotes = votes.filter((vote) => vote.overlap && vote.support === "FOR");
  const overlapWeight = overlapVotes.reduce((total, vote) => total + Number(vote.weight), 0);
  const overlapPenalty = overlapVotes.length > 0 ? 0.05 : 0;

  const score = Math.max(
    0,
    Math.min(
      1,
      0.3 * quorumHealth +
        0.2 * supportRatio +
        0.35 * informedRatio +
        0.15 * concentrationHealth -
        overlapPenalty,
    ),
  );
  const status: StageStatus = score >= 0.8 ? "GREEN" : score >= 0.55 ? "AMBER" : "RED";

  const factors: StageFactor[] = [
    {
      label: "Quorum",
      value: `${(turnout * 100).toFixed(1)}% turnout · quorum ${(votesFixture.quorumBps / 100).toFixed(0)}%`,
      weight: "30%",
      detail: `${castWeight.toLocaleString("en-US")} of ${eligibleWeight.toLocaleString("en-US")} eligible weight`,
    },
    {
      label: "Support",
      value: `${(supportRatio * 100).toFixed(1)}% FOR`,
      weight: "20%",
      detail: `${forWeight.toLocaleString("en-US")} FOR · ${againstWeight.toLocaleString("en-US")} AGAINST`,
    },
    {
      label: "Informed votes",
      value: `${(informedRatio * 100).toFixed(0)}%`,
      weight: "35%",
      detail: "Weight that recorded the current brief hash via voteWithBrief",
    },
    {
      label: "Concentration",
      value: `HHI ${hhi.toFixed(2)}`,
      weight: "15%",
      detail: "Lower concentration is healthier",
    },
  ];
  if (overlapVotes.length > 0) {
    factors.push({
      label: "Flagged-wallet overlap",
      value: `${overlapVotes.length} FOR voter${overlapVotes.length === 1 ? "" : "s"}`,
      weight: "-5%",
      detail: overlapVotes.map((vote) => `${vote.label}: ${vote.overlap}`).join(" · "),
    });
  }

  return {
    score,
    status,
    reason:
      overlapVotes.length > 0
        ? `Informed ratio ${(informedRatio * 100).toFixed(0)}% · ${overlapVotes.length} FOR voter overlaps a flagged wallet`
        : `Informed ratio ${(informedRatio * 100).toFixed(0)}% · quorum met`,
    factors,
    metrics: {
      castWeight,
      forWeight,
      againstWeight,
      abstainWeight,
      informedWeight,
      informedRatio,
      supportRatio,
      turnout,
      quorumRatio: quorumWeight === 0 ? 1 : castWeight / quorumWeight,
      hhi,
      overlapCount: overlapVotes.length,
      overlapWeight,
    },
  };
}

export function scoreExecution(run: RunResult): StageScore {
  const status: StageStatus = run.status === "PASSED" ? "GREEN" : "RED";
  const factors: StageFactor[] = [
    {
      label: "Layer",
      value: run.layer,
      detail:
        run.layer === "executor"
          ? "On-chain check modeled by the reference executor"
          : run.layer === "sentinel"
            ? "Simulation flag (early warning, not the guarantee)"
            : "Disclosure challenge flag",
    },
    { label: "Verdict", value: run.code, detail: run.label },
    {
      label: "Commitment match",
      value: run.commitmentMatched ? "YES" : "NO",
      detail: run.commitmentMatched ? "Submitted == approved" : "Submitted != approved",
    },
  ];

  return {
    stage: "EXECUTION",
    score: null,
    status,
    reason:
      run.status === "PASSED"
        ? "Deterministic match — all rules and post-conditions hold"
        : run.layer === "sentinel"
          ? `Simulation detected — ${run.code}`
          : run.layer === "disclosure"
            ? `Disclosure challenge filed — ${run.code}`
            : `Rejected by executor — ${run.code}`,
    factors,
    drilldown: `/arena/${run.scenario.id}`,
  };
}

export function buildEvaluationChain(input: {
  proposalId: string;
  claims: ClaimsScore;
  coi: CoiScore;
  voting: VotingScore;
  execution: RunResult;
}): EvaluationChain {
  return {
    proposalId: input.proposalId,
    stages: [
      {
        stage: "CLAIMS",
        score: input.claims.score,
        status: input.claims.status,
        reason: input.claims.reason,
        factors: input.claims.factors,
        drilldown: "/intent",
      },
      {
        stage: "COI",
        score: input.coi.score,
        status: input.coi.status,
        reason: input.coi.reason,
        factors: input.coi.factors,
        drilldown: "/graph",
      },
      {
        stage: "VOTING",
        score: input.voting.score,
        status: input.voting.status,
        reason: input.voting.reason,
        factors: input.voting.factors,
        drilldown: "/vote",
      },
      scoreExecution(input.execution),
    ],
  };
}

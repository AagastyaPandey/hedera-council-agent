import { applyResolutions, type Resolutions } from "../ai/resolve";
import { buildTreasuryBrief, type TreasuryBrief } from "../ai/brief";
import { validateExtraction, type ValidationResult } from "../ai/validate";
import {
  buildEvaluationChain,
  scoreClaims,
  scoreCoi,
  scoreExecution,
  scoreVoting,
  type ClaimsScore,
  type VotingScore,
  type VotesFixture,
} from "../chain-scoring/score";
import { buildMerkleTree } from "../evidence/merkle";
import { analyzeGraph, challengeHash, type GraphAnalysis, type GraphFixture } from "../graph/discover";
import {
  ADDRESSES,
  CHAIN_ID,
  ERROR_BY_NAME,
  PROPOSAL_ID,
} from "../packages/shared/addresses";
import { buildApprovedCalls } from "../packages/shared/calls";
import { hydrateIntent, type EvidenceManifest } from "../packages/shared/evidence";
import {
  computeActionsHash,
  computeBriefHash,
  computeCommitment,
  computeContentHash,
  computeDisclosureHash,
  computeIntentHash,
} from "../packages/shared/hash";
import type {
  Claim,
  EvaluationChain,
  Intent,
  ScorecardEntry,
  StageScore,
} from "../packages/shared/schemas";
import { runScenario } from "../reference/executor";
import type { ChallengeSummary, ExecutionContext, RunResult, Scenario } from "../reference/types";

import attentionJson from "../packages/shared/fixtures/attention.json";
import claimsJson from "../packages/shared/fixtures/claims.json";
import committedJson from "../packages/shared/fixtures/intent.committed.json";
import extractedJson from "../packages/shared/fixtures/intent.extracted.json";
import graphJson from "../packages/shared/fixtures/graph.json";
import manifestJson from "../packages/shared/fixtures/evidence-manifest.json";
import proposalJson from "../packages/shared/fixtures/proposal.json";
import scorecardJson from "../packages/shared/fixtures/scorecard.json";
import scenariosJson from "../packages/shared/fixtures/scenarios.json";
import votesJson from "../packages/shared/fixtures/votes.json";

const ZERO_HASH = `0x${"0".repeat(64)}` as const;

type ProposalMeta = {
  id: string;
  title: string;
  proposer: { name: string; address: string };
  recipients: { name: string; address: string; amountUsdc: string }[];
  requestedUsdc: string;
  state: string;
  stateDetail: string;
  postedAt: string;
  votingOpenedAt: string;
  votingClosedAt: string;
  queuedAt: string;
  timelockEta: number;
  executionAttemptedAt: string;
  versions: {
    version: number;
    createdAt: string;
    author: string;
    note: string;
    changeSummary: string;
    actionCount: number;
    assumptions: string[];
  }[];
  disclosure: {
    proposer: string;
    wallets: string[];
    statement: string;
    signedAt: string;
    signature: string;
  };
  challenge: {
    status: string;
    filedAt: string;
    filer: string;
    filerAddress: string;
    claim: string;
    evidenceEdgeIds: string[];
    window: string;
    reviewNote: string;
  };
};

export type VersionRecord = {
  version: number;
  createdAt: string;
  author: string;
  note: string;
  changeSummary: string;
  actions: Intent["actions"];
  assumptions: Intent["assumptions"];
  intentHash: `0x${string}`;
  contentHash: `0x${string}`;
  prevVersionHash: `0x${string}`;
  evidenceRoot: `0x${string}`;
  financialAssumptionsHash: `0x${string}`;
  technicalAssessmentHash: `0x${string}`;
  disclosureHash: `0x${string}`;
};

export type AttentionEntry = {
  id: string;
  title: string;
  requestedUsdc: string;
  postedAt: string;
  claims: number;
  coi: number;
  voting: number;
  execution: string;
  state: string;
  youAreHere: boolean;
  risk: number;
};

export type ScenarioRow = {
  scenario: Scenario;
  run: RunResult;
  matchesExpected: boolean;
};

export type Demo = {
  manifest: EvidenceManifest;
  proposal: ProposalMeta;
  extracted: Intent;
  committed: Intent;
  claims: Claim[];
  validation: ValidationResult;
  disclosureHash: `0x${string}`;
  approvedCalls: ReturnType<typeof buildApprovedCalls>;
  intentHash: `0x${string}`;
  contentHash: `0x${string}`;
  actionsHash: `0x${string}`;
  commitment: `0x${string}`;
  briefHash: `0x${string}`;
  graph: GraphAnalysis;
  challengeDigest: `0x${string}` | null;
  challengeSummary: ChallengeSummary | null;
  votes: VotesFixture;
  voting: VotingScore;
  claimsScoreCommitted: ClaimsScore;
  claimsScoreAsExtracted: ClaimsScore;
  executionScore: StageScore;
  chain: EvaluationChain;
  brief: TreasuryBrief;
  versions: VersionRecord[];
  runs: Record<string, RunResult>;
  mainRun: RunResult;
  scenarioRows: ScenarioRow[];
  arenaSummary: {
    total: number;
    passed: number;
    rejected: number;
    flagged: number;
    mismatches: number;
  };
  attention: AttentionEntry[];
  scorecard: ScorecardEntry[];
  resolutions: Resolutions;
  zeroHash: `0x${string}`;
};

function buildVersions(
  proposal: ProposalMeta,
  committed: Intent,
  manifest: EvidenceManifest,
  disclosureHash: `0x${string}`,
): VersionRecord[] {
  const financialDoc = manifest.docs.find((doc) => doc.key === "financial-model");
  const technicalDoc = manifest.docs.find((doc) => doc.key === "technical-assessment");
  const forumDoc = manifest.docs.find((doc) => doc.key === "forum-post");
  const letterDoc = manifest.docs.find((doc) => doc.key === "growthlabs-letter");
  if (!financialDoc || !technicalDoc || !forumDoc || !letterDoc) {
    throw new Error("Evidence manifest is missing a required document");
  }

  const earlyRoot = buildMerkleTree([forumDoc.docHash, letterDoc.docHash, financialDoc.docHash])
    .root;

  const v1: Intent = {
    ...committed,
    actions: [
      {
        ...committed.actions[0],
        maxAmount: "150000000000",
        label: "Initial grant to GrowthLabs",
      },
    ],
    assumptions: [],
  };

  const v2: Intent = {
    ...committed,
    actions: committed.actions.slice(0, 3),
    assumptions: committed.assumptions.filter((assumption) =>
      ["grant_cadence", "allowance_ceiling_usdc"].includes(assumption.name),
    ),
  };

  const intents = [v1, v2, committed];
  let previousHash: `0x${string}` = ZERO_HASH;

  return intents.map((intent, index) => {
    const meta = proposal.versions[index];
    const intentHash = computeIntentHash(intent);
    const contentHash = computeContentHash(intent);
    const record: VersionRecord = {
      version: meta.version,
      createdAt: meta.createdAt,
      author: meta.author,
      note: meta.note,
      changeSummary: meta.changeSummary,
      actions: intent.actions,
      assumptions: intent.assumptions,
      intentHash,
      contentHash,
      prevVersionHash: previousHash,
      evidenceRoot: index < 2 ? earlyRoot : manifest.root,
      financialAssumptionsHash: financialDoc.docHash,
      technicalAssessmentHash: index < 2 ? ZERO_HASH : technicalDoc.docHash,
      disclosureHash,
    };
    previousHash = contentHash;
    return record;
  });
}

export function buildDemo(): Demo {
  const manifest = manifestJson as unknown as EvidenceManifest;
  const proposal = proposalJson as unknown as ProposalMeta;
  const extracted = hydrateIntent(extractedJson as unknown as Intent, manifest);
  const committed = hydrateIntent(committedJson as unknown as Intent, manifest);
  const claims = claimsJson as unknown as Claim[];
  const validation = validateExtraction({ claims, intent: extracted, manifest });

  const disclosureHash = computeDisclosureHash({
    proposalId: proposal.id,
    proposer: proposal.disclosure.proposer as `0x${string}`,
    wallets: proposal.disclosure.wallets,
    statement: proposal.disclosure.statement,
    signedAt: proposal.disclosure.signedAt,
  });

  const approvedCalls = buildApprovedCalls(committed);
  const intentHash = computeIntentHash(committed);
  const contentHash = computeContentHash(committed);
  const actionsHash = computeActionsHash(approvedCalls);
  const commitment = computeCommitment({
    chainId: CHAIN_ID,
    executor: ADDRESSES.executor,
    proposalId: proposal.id,
    version: committed.version,
    actionsHash,
    intentHash,
    evidenceRoot: manifest.root,
    disclosureHash,
  });
  const briefHash = computeBriefHash({
    proposalId: proposal.id,
    version: committed.version,
    intentHash,
    contentHash,
    evidenceRoot: manifest.root,
  });

  const graph = analyzeGraph(graphJson as unknown as GraphFixture, proposal.disclosure.wallets, {
    proposalId: proposal.id,
    disclosureHash,
    claim: proposal.challenge.claim,
    filedBy: proposal.challenge.filer,
    filedAt: proposal.challenge.filedAt,
  });
  const challengeSummary: ChallengeSummary | null = graph.challenge
    ? {
        score: graph.overallRisk,
        threshold: graph.thresholds.red,
        claim: proposal.challenge.claim,
        linkCount: graph.links.length,
        payload: {
          ...graph.challenge,
          digest: challengeHash(graph.challenge),
        },
      }
    : null;

  const executionContext: ExecutionContext = {
    proposalId: proposal.id,
    chainId: CHAIN_ID,
    executor: ADDRESSES.executor,
    intent: committed,
    evidenceRoot: manifest.root,
    disclosureHash,
    approvedCalls,
  };

  const scenarios = scenariosJson as unknown as Scenario[];
  const runs: Record<string, RunResult> = {};
  for (const scenario of scenarios) {
    runs[scenario.id] = runScenario(scenario, executionContext, challengeSummary ?? undefined);
  }
  const scenarioRows: ScenarioRow[] = scenarios.map((scenario) => ({
    scenario,
    run: runs[scenario.id],
    matchesExpected:
      runs[scenario.id].status === scenario.expected.status &&
      runs[scenario.id].code === scenario.expected.code,
  }));
  const mainRun = runs["03-jargon-upgrade"];

  const votes = votesJson as unknown as VotesFixture;
  const voting = scoreVoting(votes, committed.version);
  const coi = scoreCoi(graph);
  const resolutions: Resolutions = { "upgrade-scope": "reject", cadence: "one_time" };
  const claimsScoreCommitted = scoreClaims(validation.claims, extracted.unresolved, resolutions);
  const claimsScoreAsExtracted = scoreClaims(validation.claims, extracted.unresolved, {});
  const executionScore = scoreExecution(mainRun);
  const chain = buildEvaluationChain({
    proposalId: proposal.id,
    claims: claimsScoreCommitted,
    coi,
    voting,
    execution: mainRun,
  });

  const versions = buildVersions(proposal, committed, manifest, disclosureHash);
  const brief = buildTreasuryBrief(committed, manifest);

  const attention: AttentionEntry[] = (attentionJson as unknown as Omit<AttentionEntry, "risk">[])
    .map((entry) => {
      const executionRisk = entry.execution === "RED" ? 1 : entry.execution === "AMBER" ? 0.4 : 0;
      return {
        ...entry,
        risk: 1 - entry.claims + entry.coi + (1 - entry.voting) + executionRisk,
      };
    })
    .sort((a, b) => b.risk - a.risk);

  return {
    manifest,
    proposal,
    extracted,
    committed,
    claims,
    validation,
    disclosureHash,
    approvedCalls,
    intentHash,
    contentHash,
    actionsHash,
    commitment,
    briefHash,
    graph,
    challengeDigest: graph.challenge
      ? (challengeSummary?.payload as { digest?: `0x${string}` } | undefined)?.digest ?? null
      : null,
    challengeSummary,
    votes,
    voting,
    claimsScoreCommitted,
    claimsScoreAsExtracted,
    executionScore,
    chain,
    brief,
    versions,
    runs,
    mainRun,
    scenarioRows,
    arenaSummary: {
      total: scenarioRows.length,
      passed: scenarioRows.filter((row) => row.run.status === "PASSED").length,
      rejected: scenarioRows.filter((row) => row.run.status === "REJECTED").length,
      flagged: scenarioRows.filter((row) => row.run.status === "FLAGGED").length,
      mismatches: scenarioRows.filter((row) => !row.matchesExpected).length,
    },
    attention,
    scorecard: scorecardJson as unknown as ScorecardEntry[],
    resolutions,
    zeroHash: ZERO_HASH,
  };
}

let cached: Demo | null = null;

export function getDemo(): Demo {
  if (!cached) cached = buildDemo();
  return cached;
}

export function resolveIntent(demo: Demo, resolutions: Resolutions): Intent {
  return applyResolutions(demo.extracted, resolutions);
}

export function errorEntry(code: string) {
  return ERROR_BY_NAME[code as keyof typeof ERROR_BY_NAME];
}

export function stageByKey(chain: EvaluationChain, key: string) {
  return chain.stages.find((stage) => stage.stage === key);
}

export const DEMO_PROPOSAL_ID = PROPOSAL_ID;

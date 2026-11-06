import { ethers } from "ethers";
import scorecardJson from "./mocks/scorecard.json";
import reportsJson from "./mocks/sentinel-reports.json";
import findingsJson from "./mocks/sentinel-findings.json";
import errorsJson from "./mocks/errors.json";
import evaluationJson from "./mocks/evaluation-chains.json";
import walletGraphJson from "./mocks/wallet-graph.json";
import coiAssessmentJson from "./mocks/coi-assessment.json";
import versionChainsJson from "./mocks/version-chains.json";
import votingStatesJson from "./mocks/voting-states.json";
import intentDraftsJson from "./mocks/intent-drafts.json";
import proposalsJson from "./mocks/proposals.json";
import previewsJson from "../../packages/shared/fixtures/previews.json";

import { bridgeIntent } from "../../intelligence/intent-bridge";
import {
  hashEvidenceContent,
  verifySourceContent,
} from "../../intelligence/evidence-verify";
import { hashRules } from "../../packages/shared/hash";
import { CHAIN_ID, DATA_MODE } from "./config";
import {
  normalizeProposalTitle,
  proposalFamily,
  proposalRef,
} from "./proposal-naming";
import type {
  ActionReceipt,
  ArenaRunResult,
  AttentionItem,
  ChainVerification,
  CoiAssessment,
  DisclosureInput,
  DisclosurePreview,
  DisclosureState,
  EffectPreview,
  ErrorEntry,
  EvaluationChain,
  EvidenceDocument,
  FindingExplanation,
  ForcedExecutionResult,
  IntentConfirmation,
  IntentDraft,
  Proposal,
  RiskBrief,
  ScenarioReport,
  ScorecardEntry,
  SentinelFeed,
  SentinelFinding,
  SourceVerification,
  VersionChain,
  ViolationReport,
  VotingState,
  WalletGraphData,
} from "./types";

export { CHAIN_ID, DATA_MODE };

export const SCENARIO_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const scorecardSeed = scorecardJson as ScorecardEntry[];
const reportsSeed = reportsJson as unknown as ScenarioReport[];
const errorCatalog = errorsJson as unknown as Record<string, ErrorEntry>;
const findingCatalog = findingsJson as unknown as Record<string, SentinelFinding>;
const evaluationSeed = evaluationJson as unknown as EvaluationChain[];
const walletGraphSeed = walletGraphJson as unknown as WalletGraphData;
const coiAssessmentSeed = coiAssessmentJson as unknown as CoiAssessment;
const versionChainsSeed = versionChainsJson as unknown as VersionChain[];
const votingStatesSeed = votingStatesJson as unknown as VotingState[];
const intentDraftsSeed = intentDraftsJson as unknown as IntentDraft[];
const proposalsSeed = proposalsJson as unknown as Proposal[];
const previewsSeed = previewsJson as unknown as Record<string, EffectPreview>;

const mockScorecard: ScorecardEntry[] = scorecardSeed.map((entry) => ({
  ...entry,
}));
const mockVotingStates: VotingState[] = votingStatesSeed.map((state) => ({
  ...state,
  votes: state.votes.map((vote) => ({ ...vote })),
}));
const mockDisclosures = new Map<string, DisclosureState>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(`Request failed (${response.status}) ${detail}`.trim());
  }
  return response.json() as Promise<T>;
}

function liveUnavailable(feature: string): never {
  throw new Error(
    `${feature} has no live endpoint yet. Set NEXT_PUBLIC_DATA_MODE=mock to use the fixtures.`
  );
}

export async function getProposals(): Promise<Proposal[]> {
  if (DATA_MODE === "live") {
    return fetchJson<Proposal[]>("/api/live/proposals");
  }
  return proposalsSeed.map((proposal) => ({
    ...proposal,
    title: normalizeProposalTitle(proposal.title, proposal.provenance),
    provenance: proposal.provenance ?? "MOCK",
  }));
}

export async function getScorecard(): Promise<ScorecardEntry[]> {
  if (DATA_MODE === "live") return fetchJson<ScorecardEntry[]>("/api/scorecard");
  await delay(120);
  return mockScorecard.map((entry) => ({ ...entry }));
}

export async function getReport(id: number): Promise<ScenarioReport> {
  if (DATA_MODE === "live") {
    return fetchJson<ScenarioReport>(`/api/reports/${id}`);
  }
  await delay(80);
  const report = reportsSeed.find((item) => item.scenarioId === id);
  if (!report) throw new Error(`No report found for scenario ${id}`);
  return report;
}

export async function getAllReports(): Promise<ScenarioReport[]> {
  if (DATA_MODE === "live") {
    return Promise.all(
      SCENARIO_IDS.map((id) => fetchJson<ScenarioReport>(`/api/reports/${id}`))
    );
  }
  await delay(100);
  return reportsSeed;
}

export async function runScenario(id: number): Promise<ArenaRunResult> {
  if (DATA_MODE === "live") {
    return fetchJson<ArenaRunResult>(`/api/arena/${id}`, { method: "POST" });
  }

  await delay(650);
  const report = reportsSeed.find((item) => item.scenarioId === id);
  if (!report) throw new Error(`Unknown scenario ${id}`);

  const propertyHolds = mockExpectationHolds(report);
  const durationMs = 240 + ((id * 83) % 560);
  const entry = updateMockScorecard(
    id,
    propertyHolds ? "PASS" : "FAIL",
    durationMs
  );

  return {
    scenarioId: id,
    passed: propertyHolds,
    status: propertyHolds ? "PASS" : "FAIL",
    durationMs,
    exitCode: propertyHolds ? 0 : 1,
    testFile: entry?.testFile ?? `test/redteam/scenario${id}`,
    scorecardEntry: entry,
    report,
    stdout: `[mock] scenario ${id} executed: ${report.outcome}`,
    stderr: "",
  };
}

export async function getEvaluationChain(
  proposalId: string,
  preview?: EffectPreview | null
): Promise<EvaluationChain> {
  const chain =
    DATA_MODE === "live"
      ? await fetchJson<EvaluationChain>(`/api/evaluation/${proposalId}`)
      : await (async () => {
          await delay(80);
          const found = evaluationSeed.find((item) => item.proposalId === proposalId);
          if (!found) throw new Error(`No evaluation chain for proposal ${proposalId}`);
          return found;
        })();

  const resolved =
    preview === undefined ? await tryGetEffectPreview(proposalId) : preview;
  return withPreviewFactor(chain, resolved);
}

/**
 * Fold the Pre-vote Effect Preview into the chain: a CLAIMS factor for the
 * mismatch count, and a VOTING factor that ties the informed ratio to the
 * preview hash the brief acknowledgment covers.
 */
export function withPreviewFactor(
  chain: EvaluationChain,
  preview: EffectPreview | null
): EvaluationChain {
  const mismatchValue = preview
    ? String(preview.statedVsSimulated.mismatchCount)
    : "unavailable";
  const claimsDetail = preview
    ? `Sandboxed simulation of the committed calldata found ${preview.statedVsSimulated.mismatchCount} effect(s) outside the stated intent` +
      `${preview.status === "FAILED_SIMULATION" ? " (the committed action reverts in the sandbox)" : ""}. ` +
      `Preview hash ${preview.previewHash}.`
    : "No pre-vote effect preview is available for this proposal, so no simulation was compared with the stated intent.";
  const votingDetail = preview
    ? `The brief acknowledgment records briefHash over the chain plus preview ${preview.previewHash}, so an informed vote covers this exact simulation and its ${preview.statedVsSimulated.mismatchCount} mismatch(es).`
    : "No effect preview exists for this proposal; the informed-vote ratio still counts brief acknowledgments, but none of them covers a simulation.";

  const stages = chain.stages.map((stage) => {
    if (stage.stage === "CLAIMS") {
      return {
        ...stage,
        factors: [
          ...stage.factors.filter((factor) => factor.label !== "Preview mismatches"),
          { label: "Preview mismatches", value: mismatchValue, detail: claimsDetail },
        ],
      };
    }
    if (stage.stage === "VOTING") {
      return {
        ...stage,
        factors: [
          ...stage.factors.filter((factor) => factor.label !== "Preview in the brief"),
          {
            label: "Preview in the brief",
            value: preview ? `${preview.previewHash.slice(0, 12)}…` : "none",
            detail: votingDetail,
          },
        ],
      };
    }
    return stage;
  });

  return { ...chain, stages };
}

/** Preview lookup that never throws: used to enrich the chain factor. */
async function tryGetEffectPreview(
  proposalId: string
): Promise<EffectPreview | null> {
  try {
    return await getEffectPreview(proposalId);
  } catch {
    return null;
  }
}

export async function getEffectPreview(
  proposalId: string
): Promise<EffectPreview> {
  if (DATA_MODE === "live") {
    return fetchJson<EffectPreview>(
      `/api/preview/${encodeURIComponent(proposalId)}`
    );
  }
  await delay(60);
  const preview = previewsSeed[proposalId];
  if (!preview) {
    throw new Error(
      `No recorded effect preview for proposal ${proposalId}. ` +
        `Recorded previews cover the seeded demo proposals; re-record them with ` +
        `"npm run seed && npm run previews:record".`
    );
  }
  return preview;
}

/** The brief hash binds the chain the voter saw AND the preview it covered. */
export function computeBriefHash(
  evaluation: EvaluationChain,
  previewHash: string | null
): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify({ previewHash: previewHash ?? null, evaluation }))
  );
}

export async function getCoiAssessment(
  proposalId: string
): Promise<CoiAssessment> {
  if (DATA_MODE === "live") liveUnavailable("COI assessment");
  await delay(60);
  return assessmentFor(proposalId);
}

export async function getGraph(
  proposalId: string
): Promise<WalletGraphData> {
  if (DATA_MODE === "live") liveUnavailable("Wallet graph");
  await delay(80);
  const assessment = assessmentFor(proposalId);
  const edges = walletGraphSeed.edges
    .filter((edge) => proposalId === walletGraphSeed.proposalId || edge.disclosed)
    .map((edge) => ({
      ...edge,
      strength:
        assessment.links.find((link) =>
          link.evidenceTxHashes.includes(edge.txHash)
        )?.strength ?? 0,
    }));
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = walletGraphSeed.nodes
    .filter(
      (node) => proposalId === walletGraphSeed.proposalId || connected.has(node.id)
    )
    .map((node) => ({ ...node }));
  return {
    ...walletGraphSeed,
    proposalId,
    disclosure: {
      ...walletGraphSeed.disclosure,
      disclosedWallets: [...walletGraphSeed.disclosure.disclosedWallets],
    },
    nodes,
    edges,
  };
}

export async function getVersionChain(
  proposalId: string
): Promise<VersionChain> {
  if (DATA_MODE === "live") {
    return fetchJson<VersionChain>(`/api/live/version-chain?proposalId=${encodeURIComponent(proposalId)}`);
  }
  await delay(80);
  const chain = versionChainsSeed.find(
    (item) => item.proposalId === proposalId
  );
  if (!chain) throw new Error(`No version chain for proposal ${proposalId}`);
  return chain;
}

export async function verifyVersionChain(
  proposalId: string
): Promise<ChainVerification> {
  if (DATA_MODE === "live") {
    return fetchJson<ChainVerification>(`/api/live/verify-chain?proposalId=${encodeURIComponent(proposalId)}`);
  }
  const chain = await getVersionChain(proposalId);
  const failures: string[] = [];
  chain.versions.forEach((version, index) => {
    if (version.version !== index + 1) {
      failures.push(`Unexpected sequence at v${version.version}.`);
    }
    const expectedPrevious =
      index === 0 ? ethers.ZeroHash : chain.versions[index - 1].versionHash;
    if (version.prevVersionHash.toLowerCase() !== expectedPrevious.toLowerCase()) {
      failures.push(`Broken predecessor link at v${version.version}.`);
    }
  });
  if (!chain.valid) failures.push("The registry fixture marks this chain invalid.");
  return {
    valid: failures.length === 0,
    checkedVersions: chain.versions.length,
    failures,
  };
}

export async function getEvidenceDocument(
  proposalId: string,
  version: number
): Promise<EvidenceDocument> {
  if (DATA_MODE === "live") liveUnavailable("Evidence documents");
  await delay(60);
  const draft = await getIntentDraft(proposalId);
  const source = draft.actions[0]?.source;
  if (!source) throw new Error("No source document is attached to this draft.");
  if (!draft.document) {
    throw new Error(
      `No source text is attached to the intent draft for ${proposalRef(proposalId)}.`
    );
  }
  return {
    proposalId,
    version,
    docHash: source.docHash,
    title: draft.title,
    content: draft.document,
    span: source.span,
  };
}

export async function verifyEvidenceSource(
  proposalId: string,
  docHash: string,
  span: [number, number]
): Promise<SourceVerification> {
  if (DATA_MODE === "live") liveUnavailable("Evidence verification");
  await delay(180);
  const document = await getEvidenceDocument(proposalId, 1);
  const content = document.docHash.toLowerCase() === docHash.toLowerCase()
    ? document.content
    : "";
  const recomputedHash = hashEvidenceContent(content);
  const valid = verifySourceContent(content, { docHash, span });
  const bytes = ethers.toUtf8Bytes(content);
  return {
    status: valid ? "MATCH" : "MISMATCH",
    expectedHash: docHash,
    recomputedHash,
    spanValid:
      Number.isInteger(span[0]) &&
      Number.isInteger(span[1]) &&
      span[0] >= 0 &&
      span[1] >= span[0] &&
      span[1] <= bytes.length,
  };
}

export async function getVotingState(govId: string): Promise<VotingState> {
  if (DATA_MODE === "live") {
    return fetchJson<VotingState>(`/api/live/voting-state?govId=${encodeURIComponent(govId)}`);
  }
  await delay(80);
  const state = mockVotingStates.find((item) => item.govId === govId);
  if (!state) throw new Error(`No voting state for govId ${govId}`);
  return { ...state, votes: state.votes.map((vote) => ({ ...vote })) };
}

export async function castVote(
  govId: string,
  withBrief: boolean
): Promise<ActionReceipt> {
  if (DATA_MODE === "live") {
    const state = await getVotingState(govId);
    const preview = await tryGetEffectPreview(state.proposalId);
    const evaluation = await getEvaluationChain(state.proposalId, preview);
    const briefHash = computeBriefHash(evaluation, preview?.previewHash ?? null);
    return fetchJson<ActionReceipt>("/api/live/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ govId, withBrief, briefHash }),
    });
  }
  await delay(350);
  const state = mockVotingStates.find((item) => item.govId === govId);
  if (!state) throw new Error(`No voting state for govId ${govId}`);
  if (state.state !== "VotingOpen") {
    throw new Error(`Voting is ${state.state}; new votes are closed.`);
  }
  const voter = "0x000000000000000000000000000000000000c104";
  if (state.votes.some((vote) => vote.voter === voter)) {
    return { message: "Your mock vote is already included in the tally." };
  }
  const evaluation = evaluationSeed.find(
    (item) => item.proposalId === state.proposalId
  );
  const weight = 100000000000000000000n;
  // The informed vote acknowledges the chain AND the exact effect preview.
  const preview = previewsSeed[state.proposalId] ?? null;
  const briefHash = evaluation
    ? computeBriefHash(
        await getEvaluationChain(state.proposalId, preview),
        preview?.previewHash ?? null
      )
    : null;
  state.forVotes = (BigInt(state.forVotes) + weight).toString();
  if (withBrief) {
    state.informedForVotes = (
      BigInt(state.informedForVotes) + weight
    ).toString();
    state.totalBriefAcks += 1;
  }
  state.informedRatio =
    BigInt(state.forVotes) === 0n
      ? 0
      : Number(
          (BigInt(state.informedForVotes) * 1000000n) / BigInt(state.forVotes)
        ) / 1000000;
  state.votes.push({
    voter,
    support: 1,
    weight: weight.toString(),
    briefHash: withBrief ? briefHash : null,
    hasVoted: true,
  });
  return {
    message: withBrief
      ? "Mock vote cast with the risk-brief acknowledgment."
      : "Mock vote cast without a risk-brief acknowledgment.",
    hash: withBrief ? briefHash ?? undefined : undefined,
  };
}

export async function getRiskBrief(govId: string): Promise<RiskBrief> {
  const state = await getVotingState(govId);
  const { preview, error: previewError } = await getPreviewOrError(
    state.proposalId
  );
  const [evaluation, intent, assessment] = await Promise.all([
    getEvaluationChain(state.proposalId, preview),
    getIntentDraft(state.proposalId),
    getCoiAssessment(state.proposalId),
  ]);
  const amount = intent.actions
    .filter((action) => action.kind === "ERC20_TRANSFER")
    .reduce((total, action) => total + BigInt(action.maxAmount || "0"), 0n);
  return {
    state,
    evaluation,
    intent,
    assessment,
    preview,
    previewError,
    briefHash: computeBriefHash(evaluation, preview?.previewHash ?? null),
    treasuryImpact: {
      amount: amount.toString(),
      asset: "USDC",
      actionCount: intent.actions.length,
    },
  };
}

async function getPreviewOrError(
  proposalId: string
): Promise<{ preview: EffectPreview | null; error: string | null }> {
  try {
    return { preview: await getEffectPreview(proposalId), error: null };
  } catch (cause) {
    return {
      preview: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function getAttentionQueue(): Promise<AttentionItem[]> {
  if (DATA_MODE === "live") {
    // Best-effort: derive from on-chain data where available, else throw.
    throw new Error(
      "LIVE: getAttentionQueue is not yet implemented for live mode. " +
      "It requires enumerating all on-chain govIds."
    );
  }
  await delay(100);
  const terminal = new Set(["Executed", "Defeated", "Cancelled", "Halted"]);
  return proposalsSeed
    .flatMap((proposal) => {
      const state = votingStatesSeed.find((item) => item.govId === proposal.govId);
      const evaluation = evaluationSeed.find(
        (item) => item.proposalId === proposal.id
      );
      if (!state || !evaluation || terminal.has(state.state)) return [];
      const coi = evaluation.stages.find((stage) => stage.stage === "COI");
      const execution = evaluation.stages.find(
        (stage) => stage.stage === "EXECUTION"
      );
      const riskScore = execution?.status === "RED" ? 1 : coi?.score ?? 0;
      const reasons = evaluation.stages
        .filter((stage) => stage.status !== "GREEN")
        .map((stage) => `${stage.stage}: ${stage.reason}`);
      return [{
        proposal: {
          ...proposal,
          title: normalizeProposalTitle(proposal.title, proposal.provenance),
          provenance: proposal.provenance ?? "MOCK",
        },
        rank: 0,
        riskScore,
        reasons: reasons.length > 0 ? reasons : ["No active advisory flags."],
        state: state.state,
      }];
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function getIntentDraft(
  proposalId: string
): Promise<IntentDraft> {
  await delay(80);
  const proposals = await getProposals();
  const proposal = proposals.find((item) => item.id === proposalId);
  const proposalTitle = normalizeProposalTitle(
    proposal?.title ?? "",
    proposal?.provenance
  );
  const proposalDraftFamily = proposalFamily(proposalTitle);
  const seed =
    intentDraftsSeed.find((draft) => draft.proposalId === proposalId) ??
    intentDraftsSeed.find(
      (draft) => proposalFamily(draft.title) === proposalDraftFamily
    );
  if (!seed) {
    throw new Error(
      `No source-grounded intent draft is attached to ${proposalRef(proposalId)}.`
    );
  }
  const draft = JSON.parse(JSON.stringify(seed)) as IntentDraft;
  return {
    ...draft,
    proposalId,
    title: normalizeProposalTitle(draft.title, proposal?.provenance),
  };
}

export async function confirmIntent(
  proposalId: string,
  acceptedUnresolved: number
): Promise<IntentConfirmation> {
  // Hash computation is pure — same in both modes.
  const draft = await getIntentDraft(proposalId);
  if (acceptedUnresolved < draft.unresolved.length) {
    throw new Error("Resolve or explicitly accept every UNRESOLVED item first.");
  }
  const { document: _sourceDocument, ...finalized } = { ...draft, unresolved: [] };
  const output = bridgeIntent(
    finalized as unknown as Parameters<typeof bridgeIntent>[0]
  );
  const kindLabels = [
    "ERC20_TRANSFER",
    "ERC20_APPROVE",
    "PARAM_SET",
    "UPGRADE",
    "OWNERSHIP_TRANSFER",
    "MULTICALL",
  ];
  return {
    intentHash: output.intentHash,
    rulesHash: hashRules(output.rules),
    actionsHash: output.actionsHash,
    acceptedUnresolved,
    rules: output.rules.map((rule) => ({
      kind: Number(rule.kind),
      kindLabel: kindLabels[Number(rule.kind)] ?? "UNKNOWN",
      target: rule.target,
      selector: rule.selector,
      counterparty: rule.counterparty,
      maxAmount: rule.maxAmount.toString(),
      codeHash: rule.codeHash,
      childCount: rule.childCount,
      plainEnglish: explainRule(kindLabels[Number(rule.kind)], rule),
    })),
  };
}

export async function previewDisclosure(
  input: DisclosureInput
): Promise<DisclosurePreview> {
  // Hash computation is pure — same in both modes.
  return disclosureHashes(input);
}

export async function getDisclosureState(
  proposalId: string
): Promise<DisclosureState> {
  if (DATA_MODE === "live") {
    return fetchJson<DisclosureState>(`/api/live/disclosure-state?proposalId=${encodeURIComponent(proposalId)}`);
  }
  await delay(70);
  const existing = mockDisclosures.get(proposalId);
  if (existing) return cloneDisclosure(existing);
  const graph = await getGraph(proposalId);
  const assessment = assessmentFor(proposalId);
  const initial: DisclosureState = {
    proposalId,
    ...disclosureHashes({
      wallets: graph.disclosure.disclosedWallets,
      interests: "Development grant relationship declared for review.",
    }),
    wallets: graph.disclosure.disclosedWallets,
    interests: "Development grant relationship declared for review.",
    challengeOpensAt: "2026-10-25T00:00:00.000Z",
    challengeClosesAt: "2026-10-28T00:00:00.000Z",
    challenges:
      proposalId === coiAssessmentSeed.proposalId
        ? [{
            id: "challenge-seed-1",
            linkEvidenceHash: assessment.challengePayload.linkEvidenceHash,
            reason: assessment.challengePayload.reason,
            filedAt: assessment.snapshotAt,
            status: "VERIFIED",
          }]
        : [],
  };
  mockDisclosures.set(proposalId, initial);
  return cloneDisclosure(initial);
}

export async function publishDisclosure(
  proposalId: string,
  input: DisclosureInput
): Promise<ActionReceipt> {
  if (DATA_MODE === "live") {
    const hashes = disclosureHashes(input);
    return fetchJson<ActionReceipt>("/api/live/publish-disclosure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        walletListHash: hashes.walletListHash,
        interestsHash: hashes.interestsHash,
      }),
    });
  }
  await delay(350);
  const current = await getDisclosureState(proposalId);
  const hashes = disclosureHashes(input);
  const wallets = normalizeWallets(input.wallets);
  mockDisclosures.set(proposalId, {
    ...current,
    ...hashes,
    wallets,
    interests: input.interests.trim(),
  });
  return {
    message: "Mock disclosure published; hash previews are now committed in session.",
    hash: hashes.walletListHash,
  };
}

export async function fileDisclosureChallenge(
  proposalId: string
): Promise<ActionReceipt> {
  if (DATA_MODE === "live") {
    const assessment = assessmentFor(proposalId);
    return fetchJson<ActionReceipt>("/api/live/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId,
        linkEvidenceHash: assessment.challengePayload.linkEvidenceHash,
        description: assessment.challengePayload.reason,
      }),
    });
  }
  await delay(350);
  const current = await getDisclosureState(proposalId);
  const assessment = assessmentFor(proposalId);
  const id = `challenge-${current.challenges.length + 1}`;
  current.challenges.push({
    id,
    linkEvidenceHash: assessment.challengePayload.linkEvidenceHash,
    reason: assessment.challengePayload.reason,
    filedAt: new Date().toISOString(),
    status: "UNVERIFIED",
  });
  mockDisclosures.set(proposalId, current);
  return {
    message: "Mock disclosure challenge filed with supporting transactions attached.",
    hash: assessment.challengePayload.linkEvidenceHash,
  };
}

export async function getSentinelFeed(): Promise<SentinelFeed> {
  return fetchJson<SentinelFeed>("/api/watcher/events");
}

export async function forceExecute(
  commitment: string
): Promise<ForcedExecutionResult> {
  return fetchJson<ForcedExecutionResult>("/api/watcher/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitment }),
  });
}

export function getErrorCatalog(): Record<string, ErrorEntry> {
  return errorCatalog;
}

export async function getExecutionState(commitment: string): Promise<{
  state: number;
  stateLabel: string;
  eta: string;
  queuedBy: string;
}> {
  if (DATA_MODE === "live") {
    return fetchJson<{
      state: number;
      stateLabel: string;
      eta: string;
      queuedBy: string;
    }>(`/api/live/execution-state?commitment=${encodeURIComponent(commitment)}`);
  }
  return {
    state: 0,
    stateLabel: "Empty",
    eta: new Date(0).toISOString(),
    queuedBy: ethers.ZeroAddress,
  };
}

export function decodeRevert(
  revertData: string
): { title: string; explanation: string; signature: string } {
  if (!revertData || revertData.length < 10) {
    return {
      title: "UNKNOWN REVERT",
      explanation: "Empty or invalid revert data",
      signature: "0x",
    };
  }
  const selector = revertData.slice(0, 10).toLowerCase();
  const known = errorCatalog[selector];
  if (known) {
    return {
      title: known.title,
      explanation: known.explanation,
      signature: known.signature,
    };
  }
  return {
    title: `UNKNOWN ERROR ${selector}`,
    explanation: `Raw revert data: ${revertData}`,
    signature: selector,
  };
}

export function findErrorForReport(
  report: ScenarioReport
): ErrorEntry | null {
  return findErrorForViolation(report.violationReport);
}

export function findExplanationForViolation(
  report: ViolationReport
): FindingExplanation {
  const code = report.violatedConstraint.code;

  if (report.layer === "sentinel") {
    const finding = findingCatalog[code];
    if (finding) {
      return {
        code,
        title: finding.title,
        explanation: finding.explanation,
        layer: "sentinel",
        source: "sentinel-findings",
      };
    }
    return {
      code,
      title: `UNKNOWN FINDING ${code}`,
      explanation: `No Sentinel finding is registered for ${code}.`,
      layer: "sentinel",
      source: "sentinel-findings",
    };
  }

  const byName = Object.values(errorCatalog).find((entry) =>
    entry.signature.startsWith(`${code}(`)
  );
  const selector = report.evidence.revertData?.slice(0, 10).toLowerCase();
  const bySelector =
    selector && /^0x[0-9a-f]{8}$/.test(selector)
      ? errorCatalog[selector]
      : undefined;
  const entry = byName ?? bySelector;

  if (entry) {
    return {
      code,
      title: entry.title,
      explanation: entry.explanation,
      layer: "executor",
      source: "errors",
      contract: entry.contract,
      signature: entry.signature,
    };
  }

  return {
    code,
    title: `UNKNOWN ERROR ${selector || code}`,
    explanation: `No executor error explanation is registered for ${code}.`,
    layer: "executor",
    source: "errors",
  };
}

export function findErrorForViolation(
  report: ViolationReport
): ErrorEntry | null {
  const code = report.violatedConstraint.code;
  const byName = Object.values(errorCatalog).find((entry) =>
    entry.signature.startsWith(`${code}(`)
  );
  if (byName) return byName;

  const selector = report.evidence.revertData
    ?.slice(0, 10)
    .toLowerCase();
  if (selector && /^0x[0-9a-f]{8}$/.test(selector)) {
    return errorCatalog[selector] ?? null;
  }
  return null;
}

function assessmentFor(proposalId: string): CoiAssessment {
  const base = {
    ...coiAssessmentSeed,
    proposalId,
    challengePayload: {
      ...coiAssessmentSeed.challengePayload,
      proposalId,
    },
  };
  if (proposalId === coiAssessmentSeed.proposalId) return base;
  const evaluation = evaluationSeed.find((item) => item.proposalId === proposalId);
  const coi = evaluation?.stages.find((stage) => stage.stage === "COI");
  const score = coi?.score ?? 0;
  return {
    ...base,
    links: base.links.filter((link) => link.disclosed),
    overallRisk: score,
    disclosedRisk: score,
    undisclosedRisk: 0,
    riskBand: coi?.status === "GREEN" ? "LOW" : "REVIEW",
    challengePayload: {
      ...base.challengePayload,
      reason: "No undisclosed links were found in this mock assessment.",
      canonicalEvidence: `proposal=${proposalId}|disclosed-links-only`,
    },
  };
}

function disclosureHashes(input: DisclosureInput): DisclosurePreview {
  const wallets = normalizeWallets(input.wallets);
  if (wallets.length === 0) throw new Error("Add at least one wallet address.");
  if (wallets.some((wallet) => !ethers.isAddress(wallet))) {
    throw new Error("Every wallet must be a valid 0x address.");
  }
  return {
    walletListHash: ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(wallets.map((wallet) => wallet.toLowerCase()).sort()))
    ),
    interestsHash: ethers.keccak256(ethers.toUtf8Bytes(input.interests.trim())),
  };
}

function normalizeWallets(wallets: string[]): string[] {
  return [...new Set(wallets.map((wallet) => wallet.trim()).filter(Boolean))];
}

function cloneDisclosure(state: DisclosureState): DisclosureState {
  return {
    ...state,
    wallets: [...state.wallets],
    challenges: state.challenges.map((challenge) => ({ ...challenge })),
  };
}

function explainRule(
  kind: string | undefined,
  rule: {
    target: string;
    counterparty: string;
    maxAmount: bigint;
    childCount: number;
  }
): string {
  switch (kind) {
    case "ERC20_TRANSFER":
      return `Transfer no more than ${rule.maxAmount.toString()} base units to ${rule.counterparty} using token ${rule.target}.`;
    case "ERC20_APPROVE":
      return `Approve ${rule.counterparty} to spend no more than ${rule.maxAmount.toString()} base units of token ${rule.target}.`;
    case "PARAM_SET":
      return `Set the committed parameter on ${rule.target} to ${rule.maxAmount.toString()}.`;
    case "UPGRADE":
      return `Upgrade ${rule.target} only to implementation ${rule.counterparty}.`;
    case "OWNERSHIP_TRANSFER":
      return `Transfer ownership of ${rule.target} only to ${rule.counterparty}.`;
    case "MULTICALL":
      return `Execute exactly ${rule.childCount} committed child action${rule.childCount === 1 ? "" : "s"} on ${rule.target}.`;
    default:
      return `Unrecognized rule on ${rule.target}; do not execute.`;
  }
}

function mockExpectationHolds(report: ScenarioReport): boolean {
  return (
    report.outcome === "Success" ||
    report.outcome === "Executor Revert" ||
    report.outcome === "Sentinel Halt"
  );
}

function updateMockScorecard(
  id: number,
  status: "PASS" | "FAIL",
  durationMs: number
): ScorecardEntry | null {
  const key = `S${id}`;
  const index = mockScorecard.findIndex((entry) => entry.id === key);
  if (index === -1) return null;
  mockScorecard[index] = { ...mockScorecard[index], status, durationMs };
  return { ...mockScorecard[index] };
}

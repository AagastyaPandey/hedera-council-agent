/** Shapes mirrored from the real backend fixtures and contracts. */

import type { EffectPreview } from "../../packages/shared/schemas/effect-preview";

export type DataMode = "mock" | "live";
export type Provenance = "LIVE" | "RECORDED" | "SIMULATED" | "MOCK";

export interface ScorecardEntry {
  id: string;
  property: string;
  status: "PASS" | "FAIL" | "TEST_REQUIRED";
  testFile: string;
  durationMs: number;
}

export interface DecodedAction {
  target: string;
  targetLabel: string;
  function: string;
  args: Record<string, string>;
  argumentLabels?: Record<string, string>;
  humanText: string;
  nested: DecodedAction[];
}

export interface ViolationReport {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedAction[];
  submitted: DecodedAction[];
  violatedConstraint: { code: string; message: string };
  evidence: {
    commitment: string;
    calldataHash: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    traceRef: string | null;
  };
}

export type ScenarioOutcome = "Success" | "Executor Revert" | "Sentinel Halt";

export interface ScenarioReport {
  scenarioId: number;
  scenarioName: string;
  property: string;
  outcome: ScenarioOutcome;
  recordedAt?: string;
  violationReport: ViolationReport;
  rawEvidence: {
    commitment: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    trace: unknown;
  };
}

export interface ArenaRunResult {
  scenarioId: number;
  passed: boolean;
  status: "PASS" | "FAIL";
  durationMs: number;
  exitCode?: number | null;
  testFile: string;
  scorecardEntry: ScorecardEntry | null;
  report: ScenarioReport | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface ErrorEntry {
  signature: string;
  contract: string;
  title: string;
  explanation: string;
}

export interface SentinelFinding {
  code: string;
  title: string;
  explanation: string;
  layer: "sentinel";
}

export interface FindingExplanation {
  code: string;
  title: string;
  explanation: string;
  layer: "executor" | "sentinel";
  source: "errors" | "sentinel-findings";
  contract?: string;
  signature?: string;
}

export interface StageFactor {
  label: string;
  value: string;
  detail?: string;
}

export type StageName = "CLAIMS" | "COI" | "VOTING" | "EXECUTION";
export type StageStatus = "GREEN" | "AMBER" | "RED" | "UNAVAILABLE";

export interface Stage {
  stage: StageName;
  score: number | null;
  status: StageStatus;
  reason: string;
  factors: StageFactor[];
  drilldown: string;
}

export interface EvaluationChain {
  proposalId: string;
  stages: Stage[];
}

export interface WalletNode {
  id: string;
  label: string;
  role: string;
  disclosed: boolean;
  simulated: boolean;
}

export interface WalletEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  asset: string;
  amount: string;
  timestamp: string;
  txHash: string;
  disclosed: boolean;
  simulated: boolean;
  strength?: number;
}

export interface WalletGraphData {
  simulated: boolean;
  schema: string;
  snapshotAt: string;
  disclaimer: string;
  proposalId: string;
  disclosure: { walletListHash: string; disclosedWallets: string[] };
  nodes: WalletNode[];
  edges: WalletEdge[];
}

export interface VersionEntry {
  version: number;
  versionHash: string;
  prevVersionHash: string;
  contentHash: string;
  evidenceRoot: string;
  financialAssumptionsHash: string;
  technicalAssessmentHash: string;
  intentHash: string;
  disclosureHash: string;
  timestamp: string;
  author: string;
  contentPreview: string;
}

export interface VersionChain {
  proposalId: string;
  valid: boolean;
  versions: VersionEntry[];
}

export interface VoteRecord {
  voter: string;
  support: 0 | 1 | 2;
  weight: string;
  briefHash: string | null;
  hasVoted: boolean;
}

export interface VotingState {
  govId: string;
  proposalId: string;
  state: string;
  stateCode: number;
  versionHash: string;
  version: number;
  commitment: string;
  actionsHash: string;
  intentHash: string;
  disclosureHash: string;
  voteStart: string;
  voteEnd: string;
  snapshotBlock: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  informedForVotes: string;
  totalBriefAcks: number;
  quorum: string;
  proposer: string;
  quorumReached: boolean;
  informedRatio: number;
  votes: VoteRecord[];
}

export interface IntentSource {
  docHash: string;
  page: number;
  section: string;
  span: [number, number];
}

export interface IntentAction {
  kind: string;
  target: string;
  selector: string;
  counterparty: string;
  maxAmount: string;
  codeHash: string | null;
  children: IntentAction[];
  source: IntentSource;
  confidence: number;
}

export interface UnresolvedItem {
  question: string;
  source: IntentSource | Record<string, never>;
}

export interface Assumption {
  name: string;
  value: string;
  source: IntentSource | Record<string, never>;
}

export interface IntentDraft {
  proposalId: string;
  version: number;
  title: string;
  document?: string;
  actions: IntentAction[];
  unresolved: UnresolvedItem[];
  assumptions: Assumption[];
}

export interface Proposal {
  id: string;
  label: string;
  title: string;
  scenarioId: number;
  govId: string;
  provenance?: Provenance;
}

export interface CoiLink {
  id: string;
  type: string;
  from: string;
  to: string;
  disclosed: boolean;
  rawStrength: number;
  strength: number;
  evidenceTxHashes: string[];
  description: string;
}

export interface CoiAssessment {
  simulated: boolean;
  formula: string;
  proposalId: string;
  snapshotAt: string;
  links: CoiLink[];
  overallRisk: number;
  disclosedRisk: number;
  undisclosedRisk: number;
  riskBand: string;
  caveats: string[];
  challengePayload: {
    proposalId: string;
    linkEvidenceHash: string;
    reason: string;
    canonicalEvidence: string;
  };
}

export interface EvidenceDocument {
  proposalId: string;
  version: number;
  docHash: string;
  title: string;
  content: string;
  span: [number, number];
}

export interface SourceVerification {
  status: "MATCH" | "MISMATCH";
  expectedHash: string;
  recomputedHash: string;
  spanValid: boolean;
}

export interface ChainVerification {
  valid: boolean;
  checkedVersions: number;
  failures: string[];
}

export interface CompiledRule {
  kind: number;
  kindLabel: string;
  target: string;
  selector: string;
  counterparty: string;
  maxAmount: string;
  codeHash: string;
  childCount: number;
  plainEnglish: string;
}

export interface IntentConfirmation {
  intentHash: string;
  rulesHash: string;
  actionsHash: string;
  rules: CompiledRule[];
  acceptedUnresolved: number;
}

export interface DisclosureChallenge {
  id: string;
  linkEvidenceHash: string;
  reason: string;
  filedAt: string;
  status: "VERIFIED" | "UNVERIFIED";
}

export interface DisclosureState {
  proposalId: string;
  walletListHash: string;
  interestsHash: string;
  wallets: string[];
  interests: string;
  challengeOpensAt: string;
  challengeClosesAt: string;
  challenges: DisclosureChallenge[];
}

export interface DisclosureInput {
  wallets: string[];
  interests: string;
}

export interface DisclosurePreview {
  walletListHash: string;
  interestsHash: string;
}

export type SignerType = "DEV" | "BROWSER" | "HARDWARE";

export interface ActionReceipt {
  message: string;
  hash?: string;
  blockNumber?: number;
  signerType?: SignerType;
  signerAddress?: string;
}

export interface AccountState {
  address: string;
  chainId: number;
  nativeBalance: string;
  tokenBalance: string;
  tokenAddress: string;
  isGuardian: boolean;
  guardian: string;
  voteNonce: string;
  haltNonce: string;
}

export interface SigningConfig {
  chainId: number;
  govId: string;
  proposalId: string;
  title: string;
  state: string;
  commitment: string;
  version: number;
  governor: {
    address: string;
    name: string;
    version: string;
    domainSeparator: string;
  };
  executor: {
    address: string;
    name: string;
    version: string;
    domainSeparator: string;
    guardian: string;
  };
  votingToken: string;
  statement: string;
  statementActions: {
    kind: string;
    amount?: string;
    token?: string;
    recipient?: string;
    target?: string;
    label?: string;
  }[];
  briefHash: string;
  deadline: number;
  voteNonce: string;
  haltNonce: string;
  voter: string | null;
  voterBalance: string;
  voterHasVoted: boolean;
  isGuardian: boolean;
  pendingHalt: {
    reportHash: string;
    reason: string;
    detail: string;
  } | null;
}

export interface RiskBrief {
  state: VotingState;
  evaluation: EvaluationChain;
  intent: IntentDraft;
  assessment: CoiAssessment;
  /** Pre-vote effect preview of the exact committed calldata, when available. */
  preview: EffectPreview | null;
  /** Why the preview is missing, when it is. Never hidden. */
  previewError: string | null;
  briefHash: string;
  treasuryImpact: {
    amount: string;
    asset: string;
    actionCount: number;
  };
}

export interface AttentionItem {
  proposal: Proposal;
  rank: number;
  riskScore: number;
  reasons: string[];
  state: string;
}

export type SentinelPhase =
  | "QUEUED"
  | "DECODING"
  | "SIMULATING"
  | "CLEAN"
  | "VIOLATION"
  | "HALTED"
  | "ERROR";

export interface SentinelSimulationSummary {
  success: boolean;
  reverted: boolean;
  revertReason?: string;
  staticViolations: string[];
  diffSummary: string;
  violationCount: number;
  categories: string[];
  traceSource?: string;
  callCount?: number;
  delegateCallCount?: number;
  tokenTransferCount?: number;
}

export interface SentinelEvent {
  id: string;
  at: string;
  phase: SentinelPhase;
  proposalId: string;
  govId: string | null;
  commitment: string;
  title: string;
  blockNumber: number | null;
  txHash: string | null;
  detail: string;
  reportHash?: string;
  haltTxHash?: string;
  haltBlockNumber?: number;
  report?: ViolationReport;
  simulation?: SentinelSimulationSummary;
}

export interface SentinelResult {
  proposalId: string;
  govId: string | null;
  commitment: string;
  title: string;
  status: "OBSERVED" | "CLEAN" | "HALTED" | "ERROR";
  updatedAt: string;
  reason: string;
  reportHash?: string;
  haltTxHash?: string;
  haltBlockNumber?: number;
  report?: ViolationReport;
  simulation?: SentinelSimulationSummary;
}

export interface SentinelWatcher {
  status: "running" | "stopped";
  online?: boolean;
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  lastBlock: number | null;
  rpcUrl: string;
  executor: string;
  guardian: string;
  pollIntervalMs: number;
}

export interface SentinelFeed {
  version: 1;
  watcher: SentinelWatcher | null;
  events: SentinelEvent[];
  results: Record<string, SentinelResult>;
}

export interface ForcedExecutionResult {
  status: "reverted" | "executed";
  label: "Rejected by executor" | "Executor accepted";
  boundary: "executor";
  txHash: string | null;
  revertData: string;
  selector: string;
  signature: string;
  title: string;
  explanation: string;
  commitment: string;
  /** Block explorer link for the mined (possibly failed) transaction. */
  explorerUrl?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-vote Effect Preview — single source of truth in packages/shared/schemas
// ─────────────────────────────────────────────────────────────────────────────
export type {
  DecodedRevert,
  EffectEntry,
  EffectKind,
  EffectPreview,
  EffectPreviewStatus,
  EffectSeverity,
} from "../../packages/shared/schemas/effect-preview";

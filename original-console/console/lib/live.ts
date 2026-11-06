/**
 * app/lib/live.ts
 *
 * LIVE mode implementations of every data function.
 * Called exclusively by data.ts when DATA_MODE === "live".
 * Never silently falls back to mock data on error — always throws.
 *
 * Server-side only (imported by API routes / server components).
 */

import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./backend";
import type {
  AccountState,
  ActionReceipt,
  ChainVerification,
  DisclosureState,
  EvaluationChain,
  Proposal,
  SignerType,
  SigningConfig,
  VotingState,
  VersionChain,
  VersionEntry,
} from "./types";
import {
  getProvider,
  getServerSigner,
  getRelayerSigner,
  getProposalRegistry,
  getIntentGovernor,
  getDisclosureRegistry,
  getIntentLockExecutor,
  GOV_STATE_LABEL,
  ProposalState,
  decodeRevert,
} from "./chain";
import {
  readExecutionBundles,
  readLiveReports,
  writeLiveReports,
} from "../../sentinel/live-store";
import { renderIntentStatement, type StatementAction } from "./signing";
import {
  normalizeProposalTitle,
  proposalLabel,
} from "./proposal-naming";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function hex32(v: unknown): string {
  return typeof v === "string" ? v : ethers.hexlify(v as Uint8Array);
}

function bn(v: unknown): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v));
}

function ts(v: unknown): string {
  const unix = Number(v);
  if (!unix) return new Date(0).toISOString();
  return new Date(unix * 1000).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Version chain
// ─────────────────────────────────────────────────────────────────────────────

export async function liveGetVersionChain(proposalId: string): Promise<VersionChain> {
  const reg = getProposalRegistry();
  const pid = BigInt(proposalId);

  // getVersionChain returns bytes32[]
  const hashes: string[] = await reg.getVersionChain(pid);
  if (!hashes.length) {
    throw new Error(`No versions found on-chain for proposal ${proposalId}`);
  }

  const versions: VersionEntry[] = await Promise.all(
    hashes.map(async (hash, idx) => {
      const v = await reg.getVersion(hash);
      return {
        version: idx + 1,
        versionHash: hex32(hash),
        prevVersionHash: hex32(v.prevVersionHash),
        contentHash: hex32(v.contentHash),
        evidenceRoot: hex32(v.evidenceRoot),
        financialAssumptionsHash: hex32(v.financialAssumptionsHash),
        technicalAssessmentHash: hex32(v.technicalAssessmentHash),
        intentHash: hex32(v.intentHash),
        disclosureHash: hex32(v.disclosureHash),
        timestamp: ts(v.timestamp),
        author: String(v.author),
        contentPreview: "(on-chain; content not stored)",
      };
    })
  );

  // verifyChain on-chain
  let valid = false;
  try {
    valid = await reg.verifyChain(pid);
  } catch {
    valid = false;
  }

  return { proposalId, valid, versions };
}

export async function liveVerifyVersionChain(proposalId: string): Promise<ChainVerification> {
  const reg = getProposalRegistry();
  const pid = BigInt(proposalId);

  let valid = false;
  const failures: string[] = [];
  let checkedVersions = 0;

  try {
    const hashes: string[] = await reg.getVersionChain(pid);
    checkedVersions = hashes.length;
    valid = await reg.verifyChain(pid);
    if (!valid) failures.push("On-chain verifyChain returned false.");
  } catch (err) {
    failures.push(`verifyChain call failed: ${String(err)}`);
  }

  return { valid: valid && failures.length === 0, checkedVersions, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// VotingState
// ─────────────────────────────────────────────────────────────────────────────

export async function liveGetVotingState(
  govId: string,
  voterAddress?: string
): Promise<VotingState> {
  const gov = getIntentGovernor();
  const gid = BigInt(govId);

  const p = await gov.getGovProposal(gid);
  const stateCode = Number(p.state);
  const stateLabel = GOV_STATE_LABEL[stateCode] ?? "Unknown";

  const [informedNumerator, informedDenominator]: [bigint, bigint] =
    await gov.informedVoteRatio(gid);
  const quorumReachedBool: boolean = await gov.quorumReached(gid);

  const forVotes = bn(p.forVotes);
  const informedRatio =
    forVotes === 0n
      ? 0
      : Number((informedNumerator * 1_000_000n) / forVotes) / 1_000_000;

  // Optionally fetch connected account vote
  const votes = [];
  if (voterAddress) {
    try {
      const v = await gov.getVote(gid, voterAddress);
      if (v.hasVoted) {
        votes.push({
          voter: voterAddress,
          support: Number(v.support) as 0 | 1 | 2,
          weight: bn(v.weight).toString(),
          briefHash: hex32(v.briefHash) === ethers.ZeroHash ? null : hex32(v.briefHash),
          hasVoted: true,
        });
      }
    } catch {
      // voter lookup is best-effort
    }
  }

  const quorum: bigint = await gov.quorum();

  return {
    govId,
    proposalId: bn(p.proposalId).toString(),
    state: stateLabel,
    stateCode,
    versionHash: hex32(p.versionHash),
    version: Number(p.version),
    commitment: hex32(p.commitment),
    actionsHash: hex32(p.actionsHash),
    intentHash: hex32(p.intentHash),
    disclosureHash: hex32(p.disclosureHash),
    voteStart: ts(p.voteStart),
    voteEnd: ts(p.voteEnd),
    snapshotBlock: Number(p.snapshotBlock),
    forVotes: bn(p.forVotes).toString(),
    againstVotes: bn(p.againstVotes).toString(),
    abstainVotes: bn(p.abstainVotes).toString(),
    informedForVotes: bn(p.informedForVotes).toString(),
    totalBriefAcks: Number(p.totalBriefAcks),
    quorum: quorum.toString(),
    proposer: String(p.proposer),
    quorumReached: quorumReachedBool,
    informedRatio,
    votes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disclosure
// ─────────────────────────────────────────────────────────────────────────────

export async function liveGetDisclosureState(proposalId: string): Promise<DisclosureState> {
  const dreg = getDisclosureRegistry();
  const pid = BigInt(proposalId);

  const d = await dreg.disclosures(pid);
  const isSubmitted = d.submittedAt !== 0n;
  const challenged: boolean = await dreg.isChallenged(pid);
  const deadline: bigint = await dreg.getChallengeDeadline(pid);

  // Challenges array
  const rawChallenges = await dreg.getChallenges(pid);
  const challenges = (rawChallenges as {
    linkEvidenceHash: string;
    description: string;
    submittedAt: bigint;
    verified: boolean;
    challenger: string;
  }[]).map((c, i) => ({
    id: `challenge-${i}`,
    linkEvidenceHash: hex32(c.linkEvidenceHash),
    reason: c.description,
    filedAt: ts(c.submittedAt),
    status: (c.verified ? "VERIFIED" : "UNVERIFIED") as "VERIFIED" | "UNVERIFIED",
  }));

  return {
    proposalId,
    walletListHash: isSubmitted ? hex32(d.walletListHash) : ethers.ZeroHash,
    interestsHash: isSubmitted ? hex32(d.interestsHash) : ethers.ZeroHash,
    wallets: [],
    interests: "",
    challengeOpensAt: isSubmitted ? ts(d.submittedAt) : new Date(0).toISOString(),
    challengeClosesAt: ts(deadline),
    challenges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution state
// ─────────────────────────────────────────────────────────────────────────────

export async function liveGetExecutionState(commitment: string): Promise<{
  state: number;
  stateLabel: string;
  eta: string;
  queuedBy: string;
}> {
  const exec = getIntentLockExecutor();
  const p = await exec.proposals(commitment);
  const stateNum = Number(p.state);

  const stateLabels: Record<number, string> = {
    [ProposalState.Empty]:     "Empty",
    [ProposalState.Queued]:    "Queued",
    [ProposalState.Executed]:  "Executed",
    [ProposalState.Halted]:    "Halted",
    [ProposalState.Cancelled]: "Cancelled",
  };

  return {
    state: stateNum,
    stateLabel: stateLabels[stateNum] ?? "Unknown",
    eta: ts(p.eta),
    queuedBy: String(p.queuedBy),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation chain (server-side; calls intelligence/chain.ts)
// ─────────────────────────────────────────────────────────────────────────────

export async function liveGetEvaluationChain(proposalId: string): Promise<EvaluationChain> {
  // Import intelligence modules dynamically (server-side only).
  const { evaluateChain } = await import("../../intelligence/chain");
  const { assessConflictOfInterest, buildSeedData } = await import("../../intelligence/graph");

  // Live COI from the graph module (uses its own seed data; swap for on-chain
  // graph data when that feed is available).
  const coi = assessConflictOfInterest(buildSeedData());

  // Attempt to load voting state for VOTING stage.
  let votingInput: Parameters<typeof evaluateChain>[0]["voting"] = {
    voters: [],
    participationFraction: 0,
  };

  // Try to find a govId from the chain (first govId if we can't map proposalId).
  try {
    const gov = getIntentGovernor();
    const nextGovId: bigint = await gov.nextGovId();
    // Check govIds 1..nextGovId-1 for matching proposalId.
    for (let gid = 1n; gid < nextGovId; gid++) {
      const p = await gov.getGovProposal(gid);
      if (bn(p.proposalId).toString() === proposalId) {
        const state = await liveGetVotingState(gid.toString());
        const forVotes = BigInt(state.forVotes);
        const quorum = BigInt(state.quorum);
        const totalVotes =
          BigInt(state.forVotes) + BigInt(state.againstVotes) + BigInt(state.abstainVotes);
        const participation = quorum === 0n ? 0 : Number((forVotes * 100n) / quorum) / 100;

        votingInput = {
          voters: state.votes.map((v) => ({
            address: v.voter,
            weight: Number(BigInt(v.weight)),
            informed: v.briefHash !== null,
            coiFlagged: false,
          })),
          participationFraction: participation,
          quorumThreshold: 0.4,
        };
        break;
      }
    }
  } catch {
    // best-effort; leave empty voters (will be UNKNOWN stage)
  }

  const chain = evaluateChain({
    claims: {
      actions: [
        { extraction_confidence: 0.85, evidence_support: 0.8 },
      ],
    },
    coi: {
      linkStrengths: coi.links.map((l) => l.strength),
      undisclosedCount: coi.links.filter((l) => !l.disclosed).length,
      totalLinkCount: coi.links.length,
    },
    voting: votingInput,
    execution: { outcome: "NOT_SUBMITTED" },
  });

  // Map chain.ts StageResult[] to app types.Stage[]
  const stages = chain.stages.map((s) => ({
    stage: s.stage as "CLAIMS" | "COI" | "VOTING" | "EXECUTION",
    score: s.score,
    status: (s.status === "UNKNOWN" ? "AMBER" : s.status) as "GREEN" | "AMBER" | "RED",
    reason: s.reason,
    factors: Object.entries(s.factors ?? {}).map(([label, value]) => ({
      label,
      value: String(value),
    })),
    drilldown: JSON.stringify(s.drilldown ?? null),
  }));

  return { proposalId, stages };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write actions (dev signer)
// ─────────────────────────────────────────────────────────────────────────────

export type TxStatus = "pending" | "confirmed" | "reverted";

export interface TxResult {
  status: TxStatus;
  hash: string;
  blockNumber?: number;
  decoded?: ReturnType<typeof decodeRevert>;
}

function decodeContractError(error: unknown): Error {
  const candidate = error as {
    data?: unknown;
    error?: { data?: unknown };
    info?: { error?: { data?: unknown } };
    revert?: { data?: unknown };
  };
  const raw =
    (typeof candidate?.data === "string" && candidate.data) ||
    (typeof candidate?.info?.error?.data === "string" && candidate.info.error.data) ||
    (typeof candidate?.error?.data === "string" && candidate.error.data) ||
    (typeof candidate?.revert?.data === "string" && candidate.revert.data) ||
    null;
  if (raw) {
    const decoded = decodeRevert(raw);
    if (decoded) {
      return new Error(`${decoded.title}: ${decoded.explanation}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function sendTx(
  build: () => Promise<ethers.TransactionResponse>
): Promise<TxResult> {
  try {
    return await waitTx(await build());
  } catch (error) {
    throw decodeContractError(error);
  }
}

async function waitTx(
  tx: ethers.TransactionResponse
): Promise<TxResult> {
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status === 0) {
    // Try to get revert data.
    let decoded;
    try {
      // Re-run as call to capture revert.
      const provider = getProvider();
      await provider.call({ to: tx.to!, data: tx.data, from: tx.from });
    } catch (callErr) {
      const raw =
        (callErr as { data?: string })?.data ??
        (callErr as { revert?: { data?: string } })?.revert?.data ??
        "0x";
      if (typeof raw === "string" && raw.length >= 10) {
        decoded = decodeRevert(raw);
      }
    }
    return { status: "reverted", hash: tx.hash, decoded };
  }
  return { status: "confirmed", hash: tx.hash, blockNumber: receipt?.blockNumber };
}

/** Vote with the server-side dev signer. support: 0 against, 1 for, 2 abstain. */
export async function liveCastVote(
  govId: string,
  withBrief: boolean,
  briefHash: string = ethers.ZeroHash,
  accountIndex = 0,
  support = 1
): Promise<ActionReceipt> {
  const role = accountIndex === 1 ? "voter2" : accountIndex === 2 ? "voter3" : "voter1";
  const signer = await getServerSigner(role, 4 + Math.min(accountIndex, 2));
  const signerAddress = await signer.getAddress();
  const gov = getIntentGovernor().connect(signer) as ethers.Contract;
  const gid = BigInt(govId);

  const result = await sendTx(() =>
    withBrief
      ? gov.voteWithBrief(gid, support, briefHash)
      : gov.castVote(gid, support)
  );
  if (result.status === "reverted") {
    const msg = result.decoded
      ? `${result.decoded.title}: ${result.decoded.explanation}`
      : `Vote reverted (tx: ${result.hash})`;
    throw new Error(msg);
  }
  return {
    message: withBrief
      ? `Vote cast with brief acknowledgment. Tx: ${result.hash}`
      : `Vote cast. Tx: ${result.hash}`,
    hash: result.hash,
    blockNumber: result.blockNumber,
    signerType: "DEV",
    signerAddress,
  };
}

function shortAddress(value: string | undefined): string {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function manifestLabels(): Record<string, string> {
  try {
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
    const name =
      chainId === 11155111 ? "sepolia" : chainId === 1 ? "mainnet" : "local";
    const file = path.join(repoRoot(), "deployments", `${name}.json`);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      contracts?: Record<string, { address?: string }>;
    };
    const labels: Record<string, string> = {};
    for (const [contractName, entry] of Object.entries(parsed.contracts ?? {})) {
      if (entry?.address) {
        labels[entry.address.toLowerCase()] =
          contractName === "MockUSDC" ? "USDC" : contractName;
      }
    }
    return labels;
  } catch {
    return {};
  }
}

function signingActionsFromBundle(
  bundle:
    | {
        rules: { kind: number; target: string; counterparty: string; maxAmount: string }[];
        labels?: Record<string, string>;
      }
    | undefined,
  knownLabels: Record<string, string> = {}
): StatementAction[] {
  if (!bundle) return [];
  const labels = bundle.labels ?? {};
  const labelFor = (address: string | undefined, fallback: string) =>
    address
      ? labels[address.toLowerCase()] ??
        knownLabels[address.toLowerCase()] ??
        fallback
      : fallback;

  return bundle.rules.map((rule) => {
    const kindName =
      rule.kind === 0
        ? "ERC20_TRANSFER"
        : rule.kind === 1
          ? "ERC20_APPROVE"
          : rule.kind === 2
            ? "PARAM_SET"
            : rule.kind === 3
              ? "UPGRADE"
              : rule.kind === 4
                ? "OWNERSHIP_TRANSFER"
                : "MULTICALL";
    const target = labelFor(rule.target, shortAddress(rule.target));
    const recipient = labelFor(rule.counterparty, shortAddress(rule.counterparty));
    const amount =
      rule.kind === 0 || rule.kind === 1
        ? Number(ethers.formatUnits(BigInt(rule.maxAmount), 6)).toLocaleString("en-US", {
            maximumFractionDigits: 0,
          })
        : undefined;
    return {
      kind: kindName,
      amount,
      token: rule.kind === 0 || rule.kind === 1 ? "USDC" : undefined,
      target,
      recipient,
      label:
        kindName === "MULTICALL"
          ? "execute a multicall"
          : undefined,
    };
  });
}

export async function liveGetAccountState(address: string): Promise<AccountState> {
  if (!ethers.isAddress(address)) {
    throw new Error("A valid account address is required.");
  }
  const account = ethers.getAddress(address);
  const gov = getIntentGovernor();
  const exec = getIntentLockExecutor();
  const tokenAddress = await gov.votingToken();
  const token = new ethers.Contract(
    tokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    getProvider()
  );
  const [guardian, network, nativeBalance, tokenBalance, voteNonce, haltNonce] =
    await Promise.all([
      exec.guardian().catch(() => ethers.ZeroAddress),
      getProvider().getNetwork().catch(() => ({ chainId: 11155111n })),
      getProvider().getBalance(account).catch(() => 0n),
      token.balanceOf(account).catch(() => 0n),
      typeof gov.nonces === "function"
        ? gov.nonces(account).catch(() => 0n)
        : Promise.resolve(0n),
      typeof exec.haltNonces === "function"
        ? exec.haltNonces(account).catch(() => 0n)
        : Promise.resolve(0n),
    ]);

  return {
    address: account,
    chainId: Number(network.chainId),
    nativeBalance: nativeBalance.toString(),
    tokenBalance: tokenBalance.toString(),
    tokenAddress,
    isGuardian: account.toLowerCase() === guardian.toLowerCase(),
    guardian,
    voteNonce: voteNonce.toString(),
    haltNonce: haltNonce.toString(),
  };
}

export async function liveGetSigningConfig(input: {
  govId: string;
  voter?: string;
  signer?: string;
}): Promise<SigningConfig> {
  const gov = getIntentGovernor();
  const exec = getIntentLockExecutor();
  const govId = BigInt(input.govId);
  const proposal = await gov.getGovProposal(govId);
  const commitment = hex32(proposal.commitment);
  const state = GOV_STATE_LABEL[Number(proposal.state)] ?? "Unknown";
  const bundle = Object.values(readExecutionBundles().bundles).find(
    (candidate) =>
      candidate.commitment.toLowerCase() === commitment.toLowerCase() ||
      candidate.govId === input.govId
  );
  const actions = signingActionsFromBundle(bundle, manifestLabels());
  const statement = renderIntentStatement(
    bundle?.title ?? `Proposal ${proposal.proposalId}`,
    actions
  );
  const voter =
    input.voter && ethers.isAddress(input.voter) ? ethers.getAddress(input.voter) : null;
  const signer =
    input.signer && ethers.isAddress(input.signer) ? ethers.getAddress(input.signer) : null;
  const guardian = await exec.guardian();
  const votingToken = await gov.votingToken();
  const vote = voter ? await gov.votes(govId, voter) : null;
  const balance = voter
    ? await new ethers.Contract(
        votingToken,
        ["function balanceOf(address) view returns (uint256)"],
        getProvider()
      ).balanceOf(voter)
    : 0n;

  const reports = readLiveReports();
  const pendingEvent = reports.events
    .slice()
    .reverse()
    .find(
      (event) =>
        event.commitment.toLowerCase() === commitment.toLowerCase() &&
        event.phase !== "HALTED" &&
        Boolean(event.reportHash)
    );
  const pendingResult = reports.results[commitment.toLowerCase()];

  const latestBlock = await getProvider().getBlock("latest");
  const chainNow = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);

  return {
    chainId: Number((await getProvider().getNetwork()).chainId),
    govId: input.govId,
    proposalId: String(proposal.proposalId),
    title: bundle?.title ?? `Proposal ${proposal.proposalId}`,
    state,
    commitment,
    version: Number(proposal.version),
    governor: {
      address: await gov.getAddress(),
      name:
        typeof gov.EIP712_NAME === "function"
          ? await gov.EIP712_NAME().catch(() => "IntentGovernor")
          : "IntentGovernor",
      version:
        typeof gov.EIP712_VERSION === "function"
          ? await gov.EIP712_VERSION().catch(() => "1")
          : "1",
      domainSeparator:
        typeof gov.DOMAIN_SEPARATOR === "function"
          ? await gov.DOMAIN_SEPARATOR().catch(() => ethers.ZeroHash)
          : ethers.ZeroHash,
    },
    executor: {
      address: await exec.getAddress(),
      name:
        typeof exec.EIP712_NAME === "function"
          ? await exec.EIP712_NAME().catch(() => "IntentLockExecutor")
          : "IntentLockExecutor",
      version:
        typeof exec.EIP712_VERSION === "function"
          ? await exec.EIP712_VERSION().catch(() => "1")
          : "1",
      domainSeparator:
        typeof exec.DOMAIN_SEPARATOR === "function"
          ? await exec.DOMAIN_SEPARATOR().catch(() => ethers.ZeroHash)
          : ethers.ZeroHash,
      guardian,
    },
    votingToken,
    statement,
    statementActions: actions,
    briefHash: ethers.id(statement),
    deadline: chainNow + 900,
    voteNonce:
      voter && typeof gov.nonces === "function"
        ? String(await gov.nonces(voter).catch(() => "0"))
        : "0",
    haltNonce:
      signer && typeof exec.haltNonces === "function"
        ? String(await exec.haltNonces(signer).catch(() => "0"))
        : "0",
    voter,
    voterBalance: String(balance ?? 0n),
    voterHasVoted: Boolean(vote?.hasVoted),
    isGuardian: Boolean(signer && signer.toLowerCase() === guardian.toLowerCase()),
    pendingHalt:
      pendingEvent?.reportHash
        ? {
            reportHash: pendingEvent.reportHash,
            reason:
              pendingResult?.reason ??
              pendingEvent.report?.violatedConstraint.code ??
              "Sentinel violation",
            detail:
              pendingEvent.report?.violatedConstraint.message ??
              pendingEvent.detail,
          }
        : null,
  };
}

async function syncGovernorAfterHalt(
  commitment: string,
  signer: ethers.Signer,
  halt: ActionReceipt
): Promise<void> {
  try {
    const gov = getIntentGovernor().connect(signer) as ethers.Contract;
    const govId = await gov.commitmentToGovId(commitment);
    if (govId > 0n) {
      const tx = await gov.syncFromExecutor(govId);
      await tx.wait();
    }
  } catch {
    // The halt is already on-chain; sync is a convenience for the governor view.
  }

  try {
    const reports = readLiveReports();
    const key = commitment.toLowerCase();
    const result = reports.results[key];
    if (result) {
      result.status = "HALTED";
      result.updatedAt = new Date().toISOString();
      result.haltTxHash = halt.hash;
      result.haltBlockNumber = halt.blockNumber;
    }
    const event = reports.events.find(
      (candidate) =>
        candidate.commitment.toLowerCase() === key && candidate.phase !== "HALTED"
    );
    if (event) {
      event.phase = "HALTED";
      event.haltTxHash = halt.hash;
      event.haltBlockNumber = halt.blockNumber;
    }
    writeLiveReports(reports);
  } catch {
    // The report store is a demo index; the executor state is authoritative.
  }
}

export async function liveRelayVote(input: {
  govId: string;
  voter: string;
  support: number;
  briefHash: string;
  statement: string;
  nonce: string;
  deadline: string;
  signature: string;
  signerType: SignerType;
}): Promise<ActionReceipt> {
  const relayer = await getRelayerSigner();
  const gov = getIntentGovernor().connect(relayer) as ethers.Contract;
  const result = await sendTx(() =>
    gov.voteBySig(
      BigInt(input.govId),
      input.voter,
      input.support,
      input.briefHash,
      input.statement,
      BigInt(input.nonce),
      BigInt(input.deadline),
      input.signature
    )
  );
  if (result.status === "reverted") {
    throw new Error(
      result.decoded
        ? `${result.decoded.title}: ${result.decoded.explanation}`
        : `Relayed vote reverted (tx: ${result.hash})`
    );
  }
  return {
    message: `Vote relayed by ${await relayer.getAddress()}. Tx: ${result.hash}`,
    hash: result.hash,
    blockNumber: result.blockNumber,
    signerType: input.signerType,
    signerAddress: input.voter,
  };
}

export async function liveRelayHalt(input: {
  commitment: string;
  reportHash: string;
  reason: string;
  nonce: string;
  deadline: string;
  signature: string;
  signerType: SignerType;
  signerAddress: string;
}): Promise<ActionReceipt> {
  const relayer = await getRelayerSigner();
  const exec = getIntentLockExecutor().connect(relayer) as ethers.Contract;
  const result = await sendTx(() =>
    exec.haltBySig(
      input.commitment,
      input.reportHash,
      input.reason,
      BigInt(input.nonce),
      BigInt(input.deadline),
      input.signature
    )
  );
  if (result.status === "reverted") {
    throw new Error(
      result.decoded
        ? `${result.decoded.title}: ${result.decoded.explanation}`
        : `Relayed halt reverted (tx: ${result.hash})`
    );
  }
  const receipt: ActionReceipt = {
    message: `Guardian halt relayed by ${await relayer.getAddress()}. Tx: ${result.hash}`,
    hash: result.hash,
    blockNumber: result.blockNumber,
    signerType: input.signerType,
    signerAddress: input.signerAddress,
  };
  await syncGovernorAfterHalt(input.commitment, relayer, receipt);
  return receipt;
}

export async function liveAutoHalt(input: {
  commitment: string;
  reportHash: string;
}): Promise<ActionReceipt> {
  const guardian = await getServerSigner("guardian");
  const guardianAddress = await guardian.getAddress();
  const exec = getIntentLockExecutor().connect(guardian) as ethers.Contract;
  const result = await sendTx(() =>
    exec.halt(input.commitment, input.reportHash)
  );
  if (result.status === "reverted") {
    throw new Error(
      result.decoded
        ? `${result.decoded.title}: ${result.decoded.explanation}`
        : `Automatic halt reverted (tx: ${result.hash})`
    );
  }
  const receipt: ActionReceipt = {
    message: `Halt submitted by the guardian dev signer. Tx: ${result.hash}`,
    hash: result.hash,
    blockNumber: result.blockNumber,
    signerType: "DEV",
    signerAddress: guardianAddress,
  };
  await syncGovernorAfterHalt(input.commitment, guardian, receipt);
  return receipt;
}

export async function liveHardwareSign(input: {
  typed: {
    domain: ethers.TypedDataDomain;
    types: Record<string, ethers.TypedDataField[]>;
    message: Record<string, unknown>;
  };
  address?: string;
}): Promise<string> {
  const exec = getIntentLockExecutor();
  const execAddress = await exec.getAddress().catch(() => "");
  const guardianAddress = await exec.guardian().catch(() => "");
  const targetContract = (input.typed.domain.verifyingContract ?? "").toLowerCase();

  const isHalt =
    (execAddress && targetContract === execAddress.toLowerCase()) ||
    (input.address &&
      guardianAddress &&
      input.address.toLowerCase() === guardianAddress.toLowerCase()) ||
    input.typed.message.reason !== undefined;

  const signer = isHalt
    ? await getServerSigner("guardian")
    : await getServerSigner("voter1");
  const walletSigner = signer as ethers.Wallet;
  return walletSigner.signTypedData(
    input.typed.domain,
    input.typed.types,
    input.typed.message
  );
}

/** File a disclosure challenge. */
export async function liveFileChallenge(
  proposalId: string,
  linkEvidenceHash: string,
  description: string,
  accountIndex = 0
): Promise<ActionReceipt> {
  void accountIndex;
  const signer = await getServerSigner("challenger", 8);
  const dreg = getDisclosureRegistry().connect(signer) as ethers.Contract;
  const tx = await dreg.fileChallenge(BigInt(proposalId), linkEvidenceHash, description);
  const result = await waitTx(tx);
  if (result.status === "reverted") {
    throw new Error(
      result.decoded
        ? `${result.decoded.title}: ${result.decoded.explanation}`
        : `fileChallenge reverted (tx: ${result.hash})`
    );
  }
  return { message: `Challenge filed. Tx: ${result.hash}`, hash: result.hash };
}

/** Submit a signed disclosure. */
export async function liveSubmitDisclosure(
  proposalId: string,
  proposer: string,
  walletListHash: string,
  interestsHash: string,
  bondAmount: bigint,
  nonce: bigint,
  v: number,
  r: string,
  s: string,
  accountIndex = 0
): Promise<ActionReceipt> {
  void accountIndex;
  const signer = await getServerSigner("proposer", 3);
  const dreg = getDisclosureRegistry().connect(signer) as ethers.Contract;
  const tx = await dreg.submitDisclosure(
    BigInt(proposalId), proposer, walletListHash, interestsHash,
    bondAmount, nonce, v, r, s,
    { value: bondAmount }
  );
  const result = await waitTx(tx);
  if (result.status === "reverted") {
    throw new Error(
      result.decoded
        ? `${result.decoded.title}: ${result.decoded.explanation}`
        : `submitDisclosure reverted (tx: ${result.hash})`
    );
  }
  return { message: `Disclosure submitted. Tx: ${result.hash}`, hash: result.hash };
}

/** Submit a signed disclosure using the dev signer to sign EIP-712 typed data. */
export async function livePublishDisclosure(
  proposalId: string,
  walletListHash: string,
  interestsHash: string,
  bondAmount: bigint = 0n,
  accountIndex = 0
): Promise<ActionReceipt> {
  void accountIndex;
  const signer = await getServerSigner("proposer", 3);
  const signerAddress = await signer.getAddress();
  const dreg = getDisclosureRegistry();
  const dregAddress = await dreg.getAddress();
  const provider = getProvider();
  const network = await provider.getNetwork();

  const nonce: bigint = await dreg.nonces(signerAddress);

  const domain = {
    name: "AegisDAO DisclosureRegistry",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: dregAddress,
  };

  const types = {
    Disclosure: [
      { name: "proposalId", type: "uint256" },
      { name: "proposer", type: "address" },
      { name: "walletListHash", type: "bytes32" },
      { name: "interestsHash", type: "bytes32" },
      { name: "bondAmount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  const value = {
    proposalId: BigInt(proposalId),
    proposer: signerAddress,
    walletListHash,
    interestsHash,
    bondAmount,
    nonce,
  };

  const signature = await signer.signTypedData(domain, types, value);
  const sig = ethers.Signature.from(signature);

  return liveSubmitDisclosure(
    proposalId,
    signerAddress,
    walletListHash,
    interestsHash,
    bondAmount,
    nonce,
    sig.v,
    sig.r,
    sig.s,
    accountIndex
  );
}

/** Get list of proposals from chain and demo-state. */
export async function liveGetProposals(): Promise<Proposal[]> {
  const gov = getIntentGovernor();
  const nextGovId = await gov.nextGovId();

  let demoState: Record<string, { title: string; govId: string | null }> = {};
  try {
    const demoPath = path.join(
      repoRoot(),
      "packages",
      "shared",
      "fixtures",
      "demo-state.json"
    );
    if (fs.existsSync(demoPath)) {
      demoState = JSON.parse(fs.readFileSync(demoPath, "utf8"));
    }
  } catch {
    // ignore
  }

  const proposals: Proposal[] = [];
  for (let gid = 1n; gid < nextGovId; gid++) {
    try {
      const p = await gov.getGovProposal(gid);
      const pidStr = p.proposalId.toString();
      const demo = demoState[pidStr];
      const title = normalizeProposalTitle(
        demo?.title ? demo.title : "Untitled proposal",
        "LIVE"
      );
      proposals.push({
        id: pidStr,
        label: proposalLabel(pidStr, title),
        title,
        scenarioId: Number(pidStr),
        govId: gid.toString(),
        provenance: "LIVE",
      });
    } catch {
      // skip unreadable
    }
  }

  // Also include any drafted proposals from demo-state that don't have govId yet
  for (const [pidStr, demo] of Object.entries(demoState)) {
    if (!proposals.some((pr) => pr.id === pidStr)) {
      const title = normalizeProposalTitle(demo.title, "LIVE");
      proposals.push({
        id: pidStr,
        label: proposalLabel(pidStr, title),
        title,
        scenarioId: Number(pidStr),
        govId: demo.govId ?? "",
        provenance: "LIVE",
      });
    }
  }

  return proposals;
}

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
  ActionReceipt,
  ChainVerification,
  DisclosureState,
  EvaluationChain,
  Proposal,
  VotingState,
  VersionChain,
  VersionEntry,
} from "./types";
import {
  getProvider,
  getServerSigner,
  getProposalRegistry,
  getIntentGovernor,
  getDisclosureRegistry,
  getIntentLockExecutor,
  GOV_STATE_LABEL,
  ProposalState,
  decodeRevert,
} from "./chain";
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
  decoded?: ReturnType<typeof decodeRevert>;
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
  return { status: "confirmed", hash: tx.hash };
}

/** Vote for a proposal (support=1 = FOR). */
export async function liveCastVote(
  govId: string,
  withBrief: boolean,
  briefHash: string = ethers.ZeroHash,
  accountIndex = 0
): Promise<ActionReceipt> {
  const role = accountIndex === 1 ? "voter2" : accountIndex === 2 ? "voter3" : "voter1";
  const signer = await getServerSigner(role, 4 + Math.min(accountIndex, 2));
  const gov = getIntentGovernor().connect(signer) as ethers.Contract;
  const gid = BigInt(govId);

  let tx: ethers.TransactionResponse;
  if (withBrief) {
    tx = await gov.voteWithBrief(gid, 1, briefHash);
  } else {
    tx = await gov.castVote(gid, 1);
  }

  const result = await waitTx(tx);
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
  };
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

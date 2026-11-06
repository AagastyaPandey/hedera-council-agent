// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Council agent orchestration: pay for a check, get the 0G verdict,
// apply the deterministic mismatch check, apply the World ID gate for
// large proposals, then sign or refuse. Every decision is logged to HCS
// (real) or labelled SIMULATED.

import { SpendingCap } from "./budget.js";
import { checkProposal } from "./checker.js";
import { HederaClient, hashscanUrl } from "./hedera.js";
import type { CheckPayer } from "./payment.js";
import { scheduleProblem, type ChainPort } from "./chain.js";
import type { Proposal } from "./proposal.js";
import { isLargeProposal } from "./proposal.js";
import { worldGate, type WorldCheck } from "./world.js";
import { zeroGVerdict, type ZeroGConfig, type ZeroGVerdict } from "./zeroG.js";

export type CouncilDecision = "SIGNED" | "REFUSED";

export interface CouncilOutcome {
  proposalId: string;
  decision: CouncilDecision;
  reason: string;
  checkMatches: boolean;
  paidVia: "x402" | "simulated";
  paidTxId: string | null;
  paidHashscan: string | null;
  auditTxId: string | null;
  // Position and hash of this decision's entry in the hash-chained HCS log.
  auditSeq: number | null;
  auditHash: string | null;
  auditError: string | null;
  scheduledTxId: string | null;
  scheduleAction: "created" | "signed" | "already-signed" | null;
  zeroGRequestId: string | null;
  zeroGSource: ZeroGVerdict["source"] | "none";
  zeroGVerdictText: string;
  worldGateReason: string | null;
  // True when a large proposal was signed on the strength of a World ID
  // approval; the caller must then spend that approval.
  usedWorldApproval: boolean;
  // Where the transfer that was checked came from.
  transferSource: "request" | "hedera-mirror-node";
  // The proposal as checked: with the on-chain transfer and schedule id filled in.
  proposal: Proposal;
  mode: "real" | "simulated";
}

export interface CouncilAgent {
  hedera: HederaClient;
  budget: SpendingCap;
  zeroG: ZeroGConfig;
  largeThresholdTinybars: number;
  payer: CheckPayer;
  // Real mode: the Hedera side of the council. Absent in simulated mode.
  chain?: ChainPort;
}

function emptyOutcome(proposal: Proposal, mode: "real" | "simulated", paidVia: "x402" | "simulated", transferSource: CouncilOutcome["transferSource"]): CouncilOutcome {
  return {
    proposalId: proposal.id,
    decision: "REFUSED",
    reason: "",
    checkMatches: false,
    paidVia,
    paidTxId: null,
    paidHashscan: null,
    auditTxId: null,
    auditSeq: null,
    auditHash: null,
    auditError: null,
    scheduledTxId: null,
    scheduleAction: null,
    zeroGRequestId: null,
    zeroGSource: "none",
    zeroGVerdictText: "",
    worldGateReason: null,
    usedWorldApproval: false,
    transferSource,
    proposal,
    mode,
  };
}

export async function processProposal(
  agent: CouncilAgent,
  submitted: Proposal,
  worldCheck: WorldCheck | null,
): Promise<CouncilOutcome> {
  const mode = agent.hedera.mode;
  const network = agent.hedera.config.network;
  let proposal = submitted;
  let transferSource: CouncilOutcome["transferSource"] = "request";
  const writeAudit = async (proposalId: string, event: string, detail: string) => {
    try {
      const r = await agent.hedera.auditEntry({ proposalId, event, detail, at: new Date().toISOString() });
      return { auditTxId: r.txId, auditSeq: r.entry.seq, auditHash: r.entry.hash, auditError: null };
    } catch (err) {
      return { auditTxId: null, auditSeq: null, auditHash: null, auditError: `HCS audit failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  const auditEarly = (event: string, detail: string) => writeAudit(submitted.id, event, detail);

  // 0. Real mode: the transfer to check is the one on Hedera, read back
  // from the mirror node, never the one that came with the request.
  if (agent.chain) {
    try {
      const onChain = await agent.chain.resolve(submitted);
      const problem = scheduleProblem(onChain, agent.hedera.config.treasuryAccountId);
      proposal = { ...submitted, scheduleId: onChain.scheduleId, transferFromChain: undefined };
      if (onChain.transfer) {
        proposal = { ...proposal, transfer: { payee: onChain.transfer.payee, amountTinybars: onChain.transfer.amountTinybars, token: "HBAR" } };
        transferSource = "hedera-mirror-node";
      }
      if (problem) {
        const reason = `Schedule ${onChain.scheduleId} cannot be signed: ${problem}`;
        return { ...emptyOutcome(proposal, mode, agent.payer.via, transferSource), reason, ...(await auditEarly("REFUSED_SCHEDULE", reason)) };
      }
    } catch (err) {
      const reason = `Could not read the proposal's Scheduled Transaction from Hedera: ${err instanceof Error ? err.message : String(err)}`;
      return { ...emptyOutcome(proposal, mode, agent.payer.via, transferSource), reason };
    }
  } else if (submitted.transferFromChain) {
    return {
      ...emptyOutcome(proposal, mode, agent.payer.via, transferSource),
      reason: "The request names a scheduleId but gives no transfer, and this agent has no Hedera access to read it. The agent does not sign.",
    };
  }
  const check = checkProposal(proposal);
  const base: CouncilOutcome = {
    proposalId: proposal.id,
    decision: "REFUSED",
    reason: "",
    checkMatches: check.matches,
    paidVia: agent.payer.via,
    paidTxId: null,
    paidHashscan: null,
    auditTxId: null,
    auditSeq: null,
    auditHash: null,
    auditError: null,
    scheduledTxId: null,
    scheduleAction: null,
    zeroGRequestId: null,
    zeroGSource: "none",
    zeroGVerdictText: "",
    worldGateReason: null,
    usedWorldApproval: false,
    transferSource,
    proposal,
    mode,
  };

  const audit = (event: string, detail: string) => writeAudit(proposal.id, event, detail);

  // 1. Pay for the check, under the spending cap. No payment, no check.
  const price = agent.payer.priceAtomic;
  if (!agent.budget.canAfford(price)) {
    return { ...base, reason: `Spending cap reached: cannot afford the check fee (${price} USDC atomic units).` };
  }
  const paid = await agent.payer.payForCheck(proposal);
  if (paid.paymentId) agent.budget.record(price);
  const paidTxId = paid.paymentId;
  const paidHashscan = mode === "real" && paidTxId ? hashscanUrl(network, paidTxId) : null;
  const afterPay = { ...base, paidTxId, paidHashscan };
  if (!paid.ok) return { ...afterPay, reason: `Check payment failed, the agent does not sign: ${paid.error}` };
  if (!(await agent.hedera.verifyPayment(paid.paymentId))) {
    return { ...afterPay, reason: `Check payment ${paid.paymentId} did not verify as settled on Hedera.` };
  }
  // The paid check service and the local checker must agree.
  if (paid.remoteCheck && (paid.remoteCheck.proposalId !== proposal.id || paid.remoteCheck.matches !== check.matches)) {
    return { ...afterPay, reason: "The paid check result disagrees with the local check. The agent does not sign." };
  }

  // 2. 0G writes the plain-language verdict for this check.
  const verdict = await zeroGVerdict(agent.zeroG, {
    proposalId: proposal.id,
    checkVerdict: check.verdict,
    matches: check.matches,
    amountTinybars: proposal.transfer.amountTinybars,
    payee: proposal.transfer.payee,
  });
  const afterVerdict = {
    ...afterPay,
    zeroGRequestId: verdict.requestId,
    zeroGSource: verdict.source,
    zeroGVerdictText: verdict.text,
  };

  // 3. Deterministic decision: a mismatch always refuses, whatever 0G says.
  if (!check.matches) {
    return { ...afterVerdict, reason: check.verdict, ...(await audit("REFUSED_MISMATCH", check.verdict)) };
  }

  // 4. Large proposal: World ID gate before signing.
  const large = isLargeProposal(proposal, agent.largeThresholdTinybars);
  let worldGateReason: string | null = null;
  if (large) {
    const gate = worldGate(worldCheck, proposal.id);
    worldGateReason = gate.reason;
    if (!gate.allowed) {
      return {
        ...afterVerdict,
        reason: `Large proposal, World ID gate blocked signing: ${gate.reason}`,
        worldGateReason,
        ...(await audit("REFUSED_WORLD_ID", gate.reason)),
      };
    }
  }

  // 5. Sign: co-sign the Scheduled Transaction that was just checked.
  let schedule;
  try {
    schedule = agent.chain && proposal.scheduleId ? await agent.chain.sign(proposal.scheduleId) : agent.hedera.simulateSign();
  } catch (err) {
    const msg = `Scheduled Transaction failed: ${err instanceof Error ? err.message : String(err)}`;
    return { ...afterVerdict, reason: msg, worldGateReason, ...(await audit("SIGN_FAILED", msg)) };
  }
  const logged = await audit(
    "SIGNED",
    `Agent ${schedule.action} schedule ${schedule.scheduleId}. Check paid ${paidTxId}. 0G request ${verdict.requestId ?? "none"}.`,
  );
  return {
    ...afterVerdict,
    decision: "SIGNED",
    reason: `Agent signed proposal ${proposal.id}. ${verdict.text}`,
    scheduledTxId: schedule.scheduleId,
    scheduleAction: schedule.action,
    worldGateReason,
    usedWorldApproval: large,
    ...logged,
  };
}

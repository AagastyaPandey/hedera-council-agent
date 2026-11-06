// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Council agent orchestration: pay for a check, get the 0G verdict,
// apply the deterministic mismatch check, apply the World ID gate for
// large proposals, then sign or refuse. Every decision is logged to HCS
// (real) or labelled SIMULATED.

import { SpendingCap } from "./budget.js";
import { checkProposal } from "./checker.js";
import { HederaClient, hashscanUrl } from "./hedera.js";
import type { CheckPayer } from "./payment.js";
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
  mode: "real" | "simulated";
}

export interface CouncilAgent {
  hedera: HederaClient;
  budget: SpendingCap;
  zeroG: ZeroGConfig;
  largeThresholdTinybars: number;
  payer: CheckPayer;
}

// Deterministic so every council member signing the same proposal
// produces the identical schedule.
export function scheduleMemo(p: Proposal): string {
  return `council proposal ${p.id}`;
}

export async function processProposal(
  agent: CouncilAgent,
  proposal: Proposal,
  worldCheck: WorldCheck | null,
): Promise<CouncilOutcome> {
  const mode = agent.hedera.mode;
  const network = agent.hedera.config.network;
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
    auditError: null,
    scheduledTxId: null,
    scheduleAction: null,
    zeroGRequestId: null,
    zeroGSource: "none",
    zeroGVerdictText: "",
    worldGateReason: null,
    usedWorldApproval: false,
    mode,
  };

  const audit = async (event: string, detail: string) => {
    try {
      return { auditTxId: await agent.hedera.audit({ proposalId: proposal.id, event, detail, at: new Date().toISOString() }), auditError: null };
    } catch (err) {
      return { auditTxId: null, auditError: `HCS audit failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

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

  // 5. Sign: create (or co-sign) the Scheduled Transaction for the exact transfer.
  let schedule;
  try {
    schedule = await agent.hedera.signScheduledTransfer(proposal.transfer, scheduleMemo(proposal));
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

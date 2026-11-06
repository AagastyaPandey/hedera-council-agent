// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Council agent orchestration: pay for a check, get the 0G verdict,
// apply the deterministic mismatch check, apply the World ID gate for
// large proposals, then sign or refuse. Every decision is logged to HCS
// (real) or labelled SIMULATED.

import { sha256, type EntryMeta } from "./auditlog.js";
import { SpendingCap } from "./budget.js";
import { checkProposal } from "./checker.js";
import { HederaClient, hashscanUrl } from "./hedera.js";
import type { CheckPayer } from "./payment.js";
import type { PayeeRegistry } from "./payee.js";
import { scheduleProblem, type ChainPort } from "./chain.js";
import type { Proposal } from "./proposal.js";
import { isLargeProposal, proposalFingerprint } from "./proposal.js";
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
  // The council payee registry. Absent or empty-and-not-required: not enforced.
  payees?: PayeeRegistry;
  // Fail closed without a 0G verdict, even when no key is set. Defaults to
  // true in real Hedera mode, false in simulated mode.
  requireVerdict?: boolean;
  // ALLOW_NO_0G=true: sign without a 0G verdict (recorded in the log).
  allowNo0G?: boolean;
}

export const NO_VERDICT_REASON = "0G verdict unavailable, failing closed";

// Why the agent must refuse for want of a 0G verdict, or null to go on.
// A key that is set but whose call failed always fails closed. A missing
// key fails closed only when a verdict is required (real mode by default);
// simulated mode with no key keeps its labelled template verdict.
export function verdictProblem(agent: Pick<CouncilAgent, "hedera" | "requireVerdict" | "allowNo0G">, verdict: ZeroGVerdict): string | null {
  if (agent.allowNo0G) return null;
  if (verdict.source === "unavailable") return `${NO_VERDICT_REASON} (${(verdict.error ?? "no response").slice(0, 160)})`;
  if (verdict.source === "simulated" && (agent.requireVerdict ?? agent.hedera.isReal())) {
    return `${NO_VERDICT_REASON}: no ZERO_G_API_KEY is set, so there is no 0G verdict.`;
  }
  return null;
}

// The anchors each decision carries in its sealed log entry.
function anchors(proposal: Proposal, verdict: ZeroGVerdict | null, payeeStatus: string | null): EntryMeta {
  const proposalHash = sha256(proposalFingerprint(proposal));
  return {
    proposalHash,
    ...(payeeStatus ? { payeeRegistry: payeeStatus } : {}),
    ...(verdict
      ? {
          zeroGRequestId: verdict.requestId?.slice(0, 80) ?? null,
          zeroGModel: verdict.source === "0g" ? verdict.model.slice(0, 48) : null,
          verdictHash: sha256(verdict.text + proposalHash),
        }
      : {}),
  };
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
  const writeAudit = async (proposalId: string, event: string, detail: string, meta?: EntryMeta) => {
    try {
      const r = await agent.hedera.auditEntry({ proposalId, event, detail, at: new Date().toISOString(), meta });
      return { auditTxId: r.txId, auditSeq: r.entry.seq, auditHash: r.entry.hash, auditError: null };
    } catch (err) {
      return { auditTxId: null, auditSeq: null, auditHash: null, auditError: `HCS audit failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  const auditEarly = (event: string, detail: string) => writeAudit(submitted.id, event, detail, anchors(proposal, null, null));

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

  const payeeLookup = agent.payees?.lookup(proposal.transfer.payee) ?? null;
  const payeeStatus = payeeLookup?.status ?? "not-enforced";
  let verdictSeen: ZeroGVerdict | null = null;
  const audit = (event: string, detail: string) => writeAudit(proposal.id, event, detail, anchors(proposal, verdictSeen, payeeStatus));

  // 1. Pay for the check, under the spending cap. No payment, no check.
  const price = agent.payer.priceAtomic;
  if (!agent.budget.canAfford(price)) {
    return { ...base, reason: `Spending cap reached: cannot afford the check fee (${price} USDC atomic units).` };
  }
  const paid = await agent.payer.payForCheck(proposal);
  if (paid.paymentId) agent.budget.record(price);
  // The 402 offer asked to pay someone other than the registered check
  // service: nothing was paid, and the refusal is logged.
  if (!paid.ok && paid.kind === "payee-swap") {
    return { ...base, reason: paid.error, ...(await audit("REFUSED_PAYEE_SWAP", paid.error)) };
  }
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
  verdictSeen = verdict;
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

  // 3b. No 0G verdict: fail closed. Paying for the check is not enough.
  const noVerdict = verdictProblem(agent, verdict);
  if (noVerdict) return { ...afterVerdict, reason: noVerdict, ...(await audit("REFUSED_NO_VERDICT", noVerdict)) };
  const verdictNote = agent.allowNo0G && verdict.source !== "0g" ? " ALLOW_NO_0G is on: signed without a 0G verdict." : "";

  // 3c. The recipient must be in the council payee registry, unexpired.
  if (payeeLookup && payeeLookup.status !== "not-enforced" && payeeLookup.status !== "registered") {
    return { ...afterVerdict, reason: payeeLookup.detail, ...(await audit("REFUSED_UNREGISTERED_PAYEE", `Payee registry lookup: ${payeeLookup.status}. ${payeeLookup.detail}`)) };
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
    `Agent ${schedule.action} schedule ${schedule.scheduleId}. Check paid ${paidTxId}. 0G request ${verdict.requestId ?? "none"}. Payee registry: ${payeeStatus}.${verdictNote}`,
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

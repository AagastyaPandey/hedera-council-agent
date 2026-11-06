// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Demo rehearsal: 7 scenes, the exact moments the submission video shows.
// Scene 1: routine proposal, paid check, agent signs.
// Scene 2: mismatched proposal, paid check, agent refuses.
// Scene 3: large proposal, World ID approved, agent signs.
// Scene 4: large proposal, World ID denied, agent does not sign.
// Scene 5: yesterday's World ID approval is spent; reusing it is refused.
// Scene 6: the 402 names a swapped recipient; refused before paying.
// Scene 7: 0G is unavailable; the agent fails closed.
// In real mode the paid check service (POST /check) is started in-process
// unless CHECK_SERVICE_URL points elsewhere, and the agent pays it via x402.
// World ID approvals in this rehearsal are MOCKED; the real World ID flow
// runs through the server and the console UI.
import type { Server } from "node:http";
import { atomicToUsd } from "./budget.js";
import { processProposal } from "./council.js";
import { buildAgent, createApp } from "./server.js";
import { ApprovalStore, mockedWorldCheck } from "./world.js";
import { SimulatedCheckPayer } from "./payment.js";
import type { Proposal } from "./proposal.js";

function proposal(id: string, payee: string, amount: number, purpose: string, transferPayee?: string, transferAmount?: number): Proposal {
  return {
    id,
    description: { payee, amountTinybars: amount, token: "HBAR", purpose },
    transfer: { payee: transferPayee ?? payee, amountTinybars: transferAmount ?? amount, token: "HBAR" },
    createdAt: new Date().toISOString(),
  };
}

function printScene(n: number, title: string, o: Awaited<ReturnType<typeof processProposal>>): void {
  console.log(`\n--- Scene ${n}: ${title} ---`);
  console.log(`Decision: ${o.decision}`);
  console.log(`Reason: ${o.reason}`);
  console.log(`Mode: ${o.mode}${o.mode === "simulated" ? " (SIMULATED, no real chain ids)" : ""}`);
  console.log(`Check paid via ${o.paidVia}: ${o.paidTxId ?? "none"}${o.paidHashscan ? `  HashScan: ${o.paidHashscan}` : ""}`);
  console.log(`0G verdict [${o.zeroGSource}]: ${o.zeroGVerdictText}`);
  console.log(`0G request id: ${o.zeroGRequestId ?? "none"}`);
  if (o.worldGateReason) console.log(`World ID gate: ${o.worldGateReason}`);
  console.log(`Scheduled tx: ${o.scheduledTxId ?? "none"}${o.scheduleAction ? ` (${o.scheduleAction})` : ""}`);
  console.log(`HCS audit tx: ${o.auditTxId ?? "none"}${o.auditError ? `  (${o.auditError})` : ""}`);
}

async function main(): Promise<void> {
  const env = { ...process.env };
  let server: Server | null = null;
  const real = Boolean(env.HEDERA_ACCOUNT_ID?.trim() && env.HEDERA_PRIVATE_KEY?.trim());
  if (real && !env.CHECK_SERVICE_URL?.trim()) {
    const app = await createApp({ env });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address();
    env.CHECK_SERVICE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/check`;
  }
  const agent = buildAgent(env);
  const mode = agent.mode;
  // Real transfers need payees that exist; default to the fee account.
  const realPayee = (env.DEMO_PAYEE_ACCOUNT_ID ?? "").trim() || agent.payTo;
  const payee = (n: number) => (mode === "real" ? realPayee : `0.0.100${n}`);
  // Schedules are unique by content, so real runs get fresh ids.
  const tag = mode === "real" ? `-${Date.now().toString(36)}` : "";

  console.log(`hedera-council-agent demo rehearsal, mode=${mode}`);
  console.log(`Check price: ${atomicToUsd(agent.priceAtomic)} via ${agent.payer.via}. Spend cap: ${atomicToUsd(agent.budget.remainingAtomic)}.`);
  if (mode === "real") console.log(`Paid check service: ${agent.checkServiceUrl}, fees to ${agent.payTo}. Treasury: ${agent.hedera.config.treasuryAccountId}.`);

  try {
    const s1 = await processProposal(agent, proposal(`P-001${tag}`, payee(1), 10_000_000, "Pay the venue deposit"), null);
    printScene(1, "Routine proposal, paid check, agent signs", s1);

    const s2 = await processProposal(
      agent,
      proposal(`P-002${tag}`, payee(2), 20_000_000, "Pay the caterer", "0.0.9999", 90_000_000),
      null,
    );
    printScene(2, "Mismatched proposal, paid check, agent refuses", s2);

    const s3 = await processProposal(
      agent,
      proposal(`P-003${tag}`, payee(3), 80_000_000, "Pay the main sponsor grant"),
      mockedWorldCheck(`P-003${tag}`, "approved"),
    );
    printScene(3, "Large proposal, World ID approved (MOCKED), agent signs", s3);

    const s4 = await processProposal(
      agent,
      proposal(`P-004${tag}`, payee(4), 80_000_000, "Pay the main sponsor grant"),
      mockedWorldCheck(`P-004${tag}`, "denied"),
    );
    printScene(4, "Large proposal, World ID denied (MOCKED), agent does not sign", s4);

    // Scene 5: an approval is single use. The server deletes it the moment
    // it backs a signature, so the same proposal resubmitted with yesterday's
    // approval finds none, and the World ID gate refuses.
    const approvals = new ApprovalStore();
    approvals.set(mockedWorldCheck(`P-005${tag}`, "approved"));
    const s5a = await processProposal(agent, proposal(`P-005${tag}`, payee(1), 80_000_000, "Pay the main sponsor grant"), approvals.get(`P-005${tag}`));
    if (s5a.usedWorldApproval) approvals.delete(`P-005${tag}`);
    console.log(`\nScene 5 setup: P-005 signed on a World ID approval (MOCKED): ${s5a.decision}. The approval is now spent.`);
    const s5 = await processProposal(agent, s5a.proposal, approvals.get(`P-005${tag}`));
    printScene(5, "Reuse of yesterday's World approval is refused", s5);

    // Scene 6: same amount, same description as scene 1, but the 402 offer
    // names a different recipient than the registered check service.
    const spendBefore = agent.budget.remainingAtomic;
    const checkService = mode === "real" ? agent.payTo : "0.0.7000";
    const swapAgent = {
      ...agent,
      payer: new SimulatedCheckPayer(agent.hedera, agent.priceAtomic, { expectedPayTo: checkService, offeredPayTo: "0.0.6666" }),
    };
    const s6 = await processProposal(swapAgent, proposal(`P-006${tag}`, payee(1), 10_000_000, "Pay the venue deposit"), null);
    printScene(6, "Same amount, same description, swapped recipient in the 402: refused before paying", s6);
    console.log(`Spent on this check: ${atomicToUsd(spendBefore - agent.budget.remainingAtomic)}. The amount was right. The recipient was a lie.`);

    // Scene 7: 0G cannot be reached (nothing listens on port 9). A verdict is
    // part of the decision record, so no verdict means no signature.
    const noZeroG = { ...agent, zeroG: { ...agent.zeroG, apiKey: "demo-unreachable-key", baseUrl: "http://127.0.0.1:9" }, allowNo0G: false };
    const s7 = await processProposal(noZeroG, proposal(`P-007${tag}`, payee(1), 10_000_000, "Pay the venue deposit"), null);
    printScene(7, "0G unavailable: the agent fails closed", s7);

    const passed =
      s1.decision === "SIGNED" && s2.decision === "REFUSED" && s2.checkMatches === false &&
      s3.decision === "SIGNED" && s4.decision === "REFUSED" && s4.worldGateReason !== null &&
      s5a.decision === "SIGNED" && s5a.usedWorldApproval && s5.decision === "REFUSED" && s5.worldGateReason !== null &&
      s6.decision === "REFUSED" && s6.paidTxId === null && /402 offer asks to pay/.test(s6.reason) &&
      s7.decision === "REFUSED" && s7.zeroGSource === "unavailable" && /failing closed/.test(s7.reason);
    console.log(`\nRehearsal: ${passed ? "ALL 7 SCENES CORRECT" : "FAILED, check the scenes above"}`);
    if (!passed) process.exitCode = 1;
  } finally {
    server?.close();
    agent.hedera.close();
  }
}

await main();

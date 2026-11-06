// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Demo rehearsal: 4 scenes, the exact moments the submission video shows.
// Scene 1: routine proposal, paid check, agent signs.
// Scene 2: mismatched proposal, paid check, agent refuses.
// Scene 3: large proposal, World ID approved, agent signs.
// Scene 4: large proposal, World ID denied, agent does not sign.
// In real mode the paid check service (POST /check) is started in-process
// unless CHECK_SERVICE_URL points elsewhere, and the agent pays it via x402.
// World ID approvals in this rehearsal are MOCKED; the real World ID flow
// runs through the server (public/world.html).
import type { Server } from "node:http";
import { atomicToUsd } from "./budget.js";
import { processProposal } from "./council.js";
import { buildAgent, createApp } from "./server.js";
import { mockedWorldCheck } from "./world.js";
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

    const passed =
      s1.decision === "SIGNED" && s2.decision === "REFUSED" && s2.checkMatches === false &&
      s3.decision === "SIGNED" && s4.decision === "REFUSED" && s4.worldGateReason !== null;
    console.log(`\nRehearsal: ${passed ? "ALL 4 SCENES CORRECT" : "FAILED, check the scenes above"}`);
    if (!passed) process.exitCode = 1;
  } finally {
    server?.close();
    agent.hedera.close();
  }
}

await main();

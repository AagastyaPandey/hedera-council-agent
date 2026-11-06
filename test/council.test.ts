// Fresh tests, written 2026-11-06 for ETHGlobal Mumbai.
import test from "node:test";
import assert from "node:assert/strict";
import { SpendingCap } from "../src/budget.js";
import { checkProposal } from "../src/checker.js";
import { processProposal } from "../src/council.js";
import { HederaClient } from "../src/hedera.js";
import { SimulatedCheckPayer, type CheckPayer } from "../src/payment.js";
import { validateProposal } from "../src/proposal.js";
import { loadZeroGConfig, zeroGVerdict } from "../src/zeroG.js";
import { mockedWorldCheck, worldGate } from "../src/world.js";
import type { Proposal } from "../src/proposal.js";

const simHedera = () =>
  new HederaClient(
    { network: "testnet", accountId: "", privateKey: "", topicId: "", treasuryAccountId: "" },
    "simulated",
  );

// Prices are USDC atomic units: $0.01 = 10000, cap $0.10.
function makeAgent() {
  const hedera = simHedera();
  return {
    hedera,
    budget: new SpendingCap(100_000),
    zeroG: loadZeroGConfig({}),
    largeThresholdTinybars: 50_000_000,
    payer: new SimulatedCheckPayer(hedera, 10_000) as CheckPayer,
  };
}

function prop(id: string, amount: number, transferPayee?: string, transferAmount?: number): Proposal {
  return {
    id,
    description: { payee: "0.0.1001", amountTinybars: amount, token: "HBAR", purpose: "test" },
    transfer: { payee: transferPayee ?? "0.0.1001", amountTinybars: transferAmount ?? amount, token: "HBAR" },
    createdAt: new Date().toISOString(),
  };
}

test("matching proposal signs", async () => {
  const o = await processProposal(makeAgent(), prop("T-1", 10_000_000), null);
  assert.equal(o.decision, "SIGNED");
  assert.equal(o.checkMatches, true);
});

test("mismatched payee refuses", async () => {
  const o = await processProposal(makeAgent(), prop("T-2", 10_000_000, "0.0.9999"), null);
  assert.equal(o.decision, "REFUSED");
  assert.equal(o.checkMatches, false);
});

test("mismatched amount refuses", async () => {
  const o = await processProposal(makeAgent(), prop("T-3", 10_000_000, undefined, 90_000_000), null);
  assert.equal(o.decision, "REFUSED");
});

test("checker reports the exact mismatch fields", () => {
  const r = checkProposal(prop("T-4", 10_000_000, "0.0.9999", 90_000_000));
  assert.equal(r.matches, false);
  assert.deepEqual(
    r.mismatches.map((m) => m.field).sort(),
    ["amountTinybars", "payee"],
  );
});

test("large proposal without World ID refuses", async () => {
  const o = await processProposal(makeAgent(), prop("T-5", 80_000_000), null);
  assert.equal(o.decision, "REFUSED");
  assert.match(o.reason, /World ID/);
});

test("large proposal with denied World ID refuses", async () => {
  const o = await processProposal(makeAgent(), prop("T-6", 80_000_000), mockedWorldCheck("T-6", "denied"));
  assert.equal(o.decision, "REFUSED");
});

test("large proposal with expired World ID refuses", async () => {
  const check = mockedWorldCheck("T-7", "approved", -5);
  assert.equal(worldGate(check, "T-7").allowed, false);
  const o = await processProposal(makeAgent(), prop("T-7", 80_000_000), check);
  assert.equal(o.decision, "REFUSED");
});

test("large proposal with approved World ID signs", async () => {
  const o = await processProposal(makeAgent(), prop("T-8", 80_000_000), mockedWorldCheck("T-8", "approved"));
  assert.equal(o.decision, "SIGNED");
});

test("World ID check for a different proposal refuses", async () => {
  const o = await processProposal(makeAgent(), prop("T-9", 80_000_000), mockedWorldCheck("OTHER", "approved"));
  assert.equal(o.decision, "REFUSED");
});

test("spending cap blocks an over-budget payment", async () => {
  const agent = makeAgent();
  agent.budget = new SpendingCap(5_000);
  const o = await processProposal(agent, prop("T-10", 10_000_000), null);
  assert.equal(o.decision, "REFUSED");
  assert.match(o.reason, /Spending cap/);
  assert.equal(o.paidTxId, null);
});

test("x402 payment failure refuses without signing", async () => {
  const agent = makeAgent();
  agent.payer = {
    via: "x402",
    priceAtomic: 10_000,
    payForCheck: async () => ({ ok: false, paymentId: null, via: "x402", error: "facilitator down" }),
  };
  const o = await processProposal(agent, prop("T-11", 10_000_000), null);
  assert.equal(o.decision, "REFUSED");
  assert.match(o.reason, /facilitator down/);
  assert.equal(agent.budget.spentAtomic, 0);
});

test("paid check that disagrees with the local check refuses", async () => {
  const agent = makeAgent();
  agent.payer = {
    via: "simulated",
    priceAtomic: 10_000,
    payForCheck: async (p) => ({
      ok: true,
      paymentId: agent.hedera.simId("PAY"),
      via: "simulated",
      remoteCheck: { proposalId: p.id, matches: false, mismatches: [], verdict: "remote says no" },
    }),
  };
  const o = await processProposal(agent, prop("T-12", 10_000_000), null);
  assert.equal(o.decision, "REFUSED");
  assert.match(o.reason, /disagrees/);
});

test("0G outage is recorded, not fatal", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const v = await zeroGVerdict(loadZeroGConfig({ ZERO_G_API_KEY: "sk-test" }), {
      proposalId: "T-13", checkVerdict: "ok", matches: true, amountTinybars: 1, payee: "0.0.1",
    });
    assert.equal(v.source, "unavailable");
    assert.equal(v.requestId, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("validateProposal rejects malformed input", () => {
  assert.equal(validateProposal(null).ok, false);
  assert.equal(validateProposal({ ...prop("T-14", 1), id: "bad id!" }).ok, false);
  assert.equal(validateProposal({ ...prop("T-14", 1), transfer: { payee: "alice", amountTinybars: 1, token: "HBAR" } }).ok, false);
  assert.equal(validateProposal({ ...prop("T-14", 0) }).ok, false);
  assert.equal(validateProposal(prop("T-14", 5)).ok, true);
});

test("raw hex keys parse as ECDSA, DER keys keep their type", async () => {
  const { PrivateKey } = await import("@hiero-ledger/sdk");
  const { parsePrivateKey } = await import("../src/keys.js");
  const ecdsa = PrivateKey.generateECDSA();
  assert.equal(parsePrivateKey(ecdsa.toStringRaw()).publicKey.toStringRaw(), ecdsa.publicKey.toStringRaw());
  assert.equal(parsePrivateKey(`0x${ecdsa.toStringRaw()}`).publicKey.toStringRaw(), ecdsa.publicKey.toStringRaw());
  const ed = PrivateKey.generateED25519();
  assert.equal(parsePrivateKey(ed.toStringDer()).publicKey.toStringRaw(), ed.publicKey.toStringRaw());
  assert.equal(parsePrivateKey(ed.toStringRaw(), "ed25519").publicKey.toStringRaw(), ed.publicKey.toStringRaw());
});

test("mirror decoder reads the transfer an SDK-built schedule will execute", async () => {
  const sdk = await import("@hiero-ledger/sdk");
  const { decodeScheduledTransfer } = await import("../src/mirror.js");
  const { proto } = await import("@hiero-ledger/proto");
  // The same encoding the network stores for a schedule's transaction_body.
  const body = (tx: InstanceType<typeof sdk.TransferTransaction>) =>
    Buffer.from(proto.SchedulableTransactionBody.encode(tx._getScheduledTransactionBody()).finish()).toString("base64");
  const ok = new sdk.TransferTransaction()
    .addHbarTransfer("0.0.1000", sdk.Hbar.fromTinybars(-5_000))
    .addHbarTransfer("0.0.1001", sdk.Hbar.fromTinybars(5_000));
  const d = decodeScheduledTransfer(body(ok));
  assert.equal(d.problem, null);
  assert.deepEqual(d.transfer, { from: "0.0.1000", payee: "0.0.1001", amountTinybars: 5_000, token: "HBAR" });
  const split = new sdk.TransferTransaction()
    .addHbarTransfer("0.0.1000", sdk.Hbar.fromTinybars(-5_000))
    .addHbarTransfer("0.0.1001", sdk.Hbar.fromTinybars(2_500))
    .addHbarTransfer("0.0.9999", sdk.Hbar.fromTinybars(2_500));
  assert.match(decodeScheduledTransfer(body(split)).problem ?? "", /exactly one sender/);
});

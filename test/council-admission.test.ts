// Council admission by invite, removal by vote, new recipients under a standing
// instruction, rulesHash anchors and the restart audit entry.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import type { AddressInfo } from "node:net";
import { hashSignal } from "@worldcoin/idkit-core";
import type { Proposal } from "../src/proposal.js";
import { createApp, type AppOptions } from "../src/server.js";
import { StateStore } from "../src/store.js";
import { verifyBundle, type EvidenceBundle } from "../src/verify.js";

const HBAR = 100_000_000;
type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(opts: AppOptions, fn: (call: Call) => Promise<void>) {
  const app = await createApp({ statePath: null, ...opts });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call: Call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

const prop = (id: string, hbar: number, payee = "0.0.1001", purpose = "Pay the venue"): Proposal => ({
  id,
  description: { payee, amountTinybars: hbar * HBAR, token: "HBAR", purpose },
  transfer: { payee, amountTinybars: hbar * HBAR, token: "HBAR" },
  createdAt: new Date().toISOString(),
});
const invite = (call: Call, by: string) => call("POST", "/council/invites", { mocked: true, byNullifier: `mock:${by}` });
const join = async (call: Call, n: string, by?: string) => {
  const code = by ? (await invite(call, by)).body.code : undefined;
  return call("POST", "/council/join", { mocked: true, nullifier: n, ...(code ? { invite: code } : {}) });
};
const join3 = async (call: Call) => {
  for (const [n, by] of [["a"], ["b", "a"], ["c", "a"]]) assert.equal((await join(call, n!, by)).status, 200);
};
const ballot = (call: Call, path: string, who: string, choice: "yes" | "no") => call("POST", path, { choice, mocked: true, byNullifier: `mock:${who}` });
const adopt = async (call: Call, text: string) => {
  const d = await call("POST", "/mandate/draft", { text });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  await ballot(call, `/mandate/${d.body.id}/vote`, "a", "yes");
  const r = await ballot(call, `/mandate/${d.body.id}/vote`, "b", "yes");
  assert.equal(r.body.mandate.status, "adopted");
  return r.body.mandate;
};
const entries = async (call: Call) => (await call("GET", "/audit")).body.entries as Array<{ seq: number; event: string; detail: string; proposalId: string; meta?: any }>;

// ---- admission ----

test("admission: the founder joins freely; later seats need a single-use invite from a seat holder", async () => {
  let clock = new Date("2026-11-06T10:00:00Z");
  await withServer({ env: {}, now: () => clock }, async (call) => {
    assert.equal((await call("GET", "/council/seats")).body.admission.startsWith("founder"), true);
    const founder = await join(call, "a");
    assert.deepEqual([founder.body.seat, founder.body.founder, founder.body.invitedBy], ["council-seat:1", true, null]);
    assert.equal((await call("GET", "/council/seats")).body.admission.startsWith("invite"), true);
    const no = await call("POST", "/council/join", { mocked: true, nullifier: "b" });
    assert.equal(no.status, 403);
    assert.match(no.body.error, /needs an invite/);
    assert.equal((await call("POST", "/council/join", { mocked: true, nullifier: "b", invite: "nope" })).status, 403);
    assert.equal((await call("POST", "/council/join", { mocked: true, nullifier: "b", invite: 7 })).status, 400);
    // Only a seat holder may invite.
    assert.equal((await invite(call, "stranger")).status, 403);
    assert.equal((await call("POST", "/council/invites", { mocked: true })).status, 403);
    const inv = await invite(call, "a");
    assert.equal(inv.status, 201);
    assert.equal(inv.body.by, "council-seat:1");
    assert.equal(inv.body.expiresAt, "2026-11-07T10:00:00.000Z");
    assert.equal(inv.body.link, `/council.html?invite=${encodeURIComponent(inv.body.code)}`);
    const b = await call("POST", "/council/join", { mocked: true, nullifier: "b", invite: inv.body.code });
    assert.deepEqual([b.body.joined, b.body.seat, b.body.founder, b.body.invitedBy], [true, "council-seat:2", false, "council-seat:1"]);
    // Single use.
    const reuse = await call("POST", "/council/join", { mocked: true, nullifier: "c", invite: inv.body.code });
    assert.equal(reuse.status, 403);
    assert.match(reuse.body.error, /already used/);
    // An existing member is refused (409) before an invite is spent.
    const spare = await invite(call, "b");
    assert.equal((await call("POST", "/council/join", { mocked: true, nullifier: "b", invite: spare.body.code })).status, 409);
    assert.equal((await call("POST", "/council/join", { mocked: true, nullifier: "c", invite: spare.body.code })).body.seat, "council-seat:3");
    // Expiry: 24 hours.
    const old = await invite(call, "a");
    clock = new Date("2026-11-07T10:00:01Z");
    const expired = await call("POST", "/council/join", { mocked: true, nullifier: "d", invite: old.body.code });
    assert.equal(expired.status, 403);
    assert.match(expired.body.error, /expired/);
    // The member page lists invites by public id, never the code.
    const m = (await call("GET", "/council/members/council-seat:1")).body;
    assert.deepEqual(m.invites.map((i: any) => i.status), ["expired", "used"]);
    assert.equal(m.invites[1].usedBy, "council-seat:2");
    assert.equal(JSON.stringify(m).includes(inv.body.code), false);
    // Audit: SEAT_INVITED and SEAT_JOINED, without nullifiers or codes.
    const log = await entries(call);
    assert.deepEqual(log.filter((e) => e.event === "SEAT_JOINED").map((e) => e.detail.split(" ").slice(0, 2).join(" ")), ["council-seat:1 founded", "council-seat:2 joined", "council-seat:3 joined"]);
    assert.equal(log.filter((e) => e.event === "SEAT_INVITED").length, 3);
    for (const e of log) {
      assert.equal(/mock:|"a"|demo-/.test(e.detail), false, e.detail);
      assert.equal(e.detail.includes(inv.body.code), false);
    }
  });
});

test("admission: an invite is void once its issuer's seat is revoked; a revoked person cannot rejoin with an invite", async () => {
  await withServer({ env: {} }, async (call) => {
    await join3(call);
    const fromC = await invite(call, "c");
    assert.equal((await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:c", nullifier: "mock:c" })).body.by, "self");
    const voided = await call("POST", "/council/join", { mocked: true, nullifier: "d", invite: fromC.body.code });
    assert.equal(voided.status, 403);
    assert.match(voided.body.error, /void/);
    const fresh = await invite(call, "a");
    const back = await call("POST", "/council/join", { mocked: true, nullifier: "c", invite: fresh.body.code });
    assert.deepEqual([back.status, back.body.error], [403, "This seat was revoked"]);
    // The refused rejoin did not spend the invite.
    assert.equal((await call("POST", "/council/join", { mocked: true, nullifier: "d", invite: fresh.body.code })).body.joined, true);
  });
});

test("admission: invites survive a restart", async () => {
  const file = pathJoin(mkdtempSync(pathJoin(tmpdir(), "inv-")), "state.json");
  const a = new StateStore(file);
  const now = new Date("2026-11-06T00:00:00Z");
  assert.equal(a.joinCouncil("n1", "world", null, now).ok, true);
  const inv = a.createInvite("council-seat:1", now);
  const b = new StateStore(file);
  assert.equal(b.inviteProblem(inv.code, now), null);
  const j = b.joinCouncil("n2", "world", inv.code, now);
  assert.equal(j.ok && j.seat.seat, "council-seat:2");
  assert.match(new StateStore(file).inviteProblem(inv.code, now) ?? "", /already used/);
});

test("admission with World ID: invites are proven by the inviter, bound to its seat, one per proof", async () => {
  const WORLD = { WORLD_RP_ID: "rp_test", WORLD_APP_ID: "app_test", WORLD_SIGNING_KEY: "0x" + "11".repeat(32) };
  const world = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, action: b.action, environment: b.environment, results: [{ identifier: "proof_of_human", success: true, nullifier: b.responses[0].nullifier }] }), { status: 200 });
  }) as typeof fetch;
  const proof = (nullifier: string, signal: string, nonce = "0x1") => ({
    protocol_version: "4.0", nonce, action: "join-council", environment: "production",
    responses: [{ identifier: "proof_of_human", issuer_schema_id: 1, nullifier, expires_at_min: 1, signal_hash: hashSignal(signal), proof: ["1", "2", "3", "4", "5"] }],
  });
  await withServer({ env: WORLD, worldFetch: world }, async (call) => {
    assert.equal((await call("POST", "/council/join", { idkitResult: proof("0x1", "council-join") })).body.founder, true);
    assert.equal((await call("POST", "/council/invites", { mocked: true, byNullifier: "0x1" })).status, 403);
    const ctx = (await call("POST", "/world/rp-context", { invite: true, seat: "council-seat:1" })).body;
    assert.deepEqual([ctx.action, ctx.signal], ["join-council", "council-invite:council-seat:1"]);
    assert.equal((await call("POST", "/world/rp-context", { invite: true, seat: "council-seat:9" })).status, 404);
    // A join proof is not an invite proof; a stranger cannot invite as seat 1.
    const wrong = await call("POST", "/council/invites", { seat: "council-seat:1", idkitResult: proof("0x1", "council-join") });
    assert.equal(wrong.status, 403);
    assert.equal((await call("POST", "/council/invites", { seat: "council-seat:1", idkitResult: proof("0x9", ctx.signal) })).status, 403);
    const ok = await call("POST", "/council/invites", { seat: "council-seat:1", idkitResult: proof("0x1", ctx.signal, "0xn1") });
    assert.equal(ok.status, 201);
    const replay = await call("POST", "/council/invites", { seat: "council-seat:1", idkitResult: proof("0x1", ctx.signal, "0xn1") });
    assert.equal(replay.status, 409);
    assert.equal((await call("POST", "/council/join", { idkitResult: proof("0x2", "council-join"), invite: ok.body.code })).body.seat, "council-seat:2");
  });
});

// ---- removal by vote ----

test("removal: another seat is removed only by a majority of the other seats; a failed vote keeps it", async () => {
  await withServer({ env: {} }, async (call) => {
    await join3(call);
    const open = await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:a", seat: "council-seat:3" });
    assert.equal(open.status, 202);
    assert.deepEqual([open.body.subject, open.body.target, open.body.by, open.body.vote.eligible, open.body.vote.needed], ["R-1", "council-seat:3", "council-seat:1", ["council-seat:1", "council-seat:2"], 2]);
    const dup = await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:b", seat: "council-seat:3" });
    assert.deepEqual([dup.status, dup.body.subject], [409, "R-1"]);
    const votes = (await call("GET", "/council/votes")).body;
    const item = votes.open.find((i: any) => i.subject === "R-1");
    assert.deepEqual([item.kind, item.title, item.target, item.openedBy], ["revocation", "Remove council-seat:3", "council-seat:3", "council-seat:1"]);
    assert.deepEqual((await call("GET", "/council/members/council-seat:2")).body.awaiting.map((i: any) => i.subject), ["R-1"]);
    assert.deepEqual((await call("GET", "/council/members/council-seat:3")).body.awaiting, []);
    assert.deepEqual((await call("GET", "/council/members/council-seat:3")).body.removals.map((i: any) => i.subject), ["R-1"]);
    assert.equal((await ballot(call, "/council/revocations/R-1/vote", "c", "no")).status, 403);
    assert.equal((await ballot(call, "/council/revocations/R-1/vote", "z", "no")).status, 403);
    assert.equal((await ballot(call, "/council/revocations/R-9/vote", "a", "no")).status, 404);
    // 1 yes, 1 no of 2 with 2 needed: failed, seat 3 stays.
    assert.equal((await ballot(call, "/council/revocations/R-1/vote", "a", "yes")).body.vote.status, "open");
    const failed = await ballot(call, "/council/revocations/R-1/vote", "b", "no");
    assert.deepEqual([failed.body.vote.status, failed.body.removed], ["failed", false]);
    assert.equal((await call("GET", "/council/seats")).body.count, 3);
    assert.equal((await call("GET", "/council/epoch")).body.epoch, 1);
    assert.equal((await ballot(call, "/council/revocations/R-1/vote", "a", "yes")).status, 409);
    assert.equal((await call("GET", "/council/votes")).body.closed.find((i: any) => i.subject === "R-1").decision, "kept");
    // A second attempt passes 2 of 2 and applies the revocation.
    const again = await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:b", seat: "council-seat:3" });
    assert.equal(again.body.subject, "R-2");
    // An unrelated open vote on seat 2 is closed by the revocation (its ballots are bound to the old epoch).
    assert.equal((await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:c", seat: "council-seat:2" })).body.subject, "R-3");
    await ballot(call, "/council/revocations/R-2/vote", "a", "yes");
    const passed = await ballot(call, "/council/revocations/R-2/vote", "b", "yes");
    assert.equal(passed.body.removed, true);
    assert.deepEqual([passed.body.revocation.seat, passed.body.revocation.epoch, passed.body.revocation.closedRevocationVotes], ["council-seat:3", 2, ["R-3"]]);
    assert.equal((await call("GET", "/council/votes")).body.closed.find((i: any) => i.subject === "R-3").decision, "cancelled");
    assert.equal((await ballot(call, "/council/revocations/R-3/vote", "a", "yes")).status, 409);
    const log = (await entries(call)).map((e) => e.event);
    for (const ev of ["REVOCATION_VOTE_OPENED", "REVOCATION_REJECTED", "REVOKED"]) assert.ok(log.includes(ev), ev);
    assert.equal((await join(call, "c", "a")).body.error, "This seat was revoked");
    // The target's own page shows the votes on its removal; its ballots on R-3 never existed.
    const seat1 = (await call("GET", "/council/members/council-seat:1")).body;
    assert.deepEqual(seat1.ballots.filter((b: any) => b.kind === "revocation").map((b: any) => b.subject).sort(), ["R-1", "R-2"]);
  });
});

test("removal: with two seats the other seat alone decides", async () => {
  await withServer({ env: {} }, async (call) => {
    await join(call, "a");
    await join(call, "b", "a");
    const open = await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:b", seat: "council-seat:1" });
    assert.deepEqual([open.status, open.body.vote.eligible, open.body.vote.needed], [202, ["council-seat:2"], 1]);
    const r = await ballot(call, "/council/revocations/R-1/vote", "b", "yes");
    assert.equal(r.body.revocation.seat, "council-seat:1");
    assert.deepEqual((await call("GET", "/council/seats")).body.seats.map((s: any) => s.seat), ["council-seat:2"]);
  });
});

// ---- new recipients under a standing instruction ----

test("new recipient under an instruction: not refused, it goes to a council vote and signs after a re-check", async () => {
  await withServer({ env: {} }, async (call) => {
    await join3(call);
    // Without an instruction a recipient missing from the registry is refused outright.
    assert.equal((await call("POST", "/proposals", { proposal: prop("NR-0", 5, "0.0.9001") })).body.decision, "REFUSED");
    const m = await adopt(call, "Pay any payee up to 50 HBAR each. Anything else goes to the council.");
    assert.equal(m.rules.payees, "any");
    const r = await call("POST", "/proposals", { proposal: prop("NR-1", 5, "0.0.9001") });
    assert.equal(r.body.decision, "PENDING_VOTE", r.body.reason);
    assert.deepEqual(r.body.mandate.violations, ["0.0.9001 is not a registered payee — new recipient"]);
    await ballot(call, "/proposals/NR-1/vote", "a", "yes");
    const v = await ballot(call, "/proposals/NR-1/vote", "b", "yes");
    assert.equal(v.body.outcome.decision, "SIGNED", v.body.outcome.reason);
    const log = (await entries(call)).filter((e) => e.proposalId === "NR-1");
    assert.deepEqual(log.map((e) => e.event), ["VOTE_OPENED", "VOTE", "VOTE", "VOTE_PASSED", "SIGNED"]);
    assert.ok(log.every((e) => e.meta?.rulesHash === m.rulesHash));
    assert.equal(log.at(-1)!.meta.payeeRegistry, "unregistered");
    // Revoked registry entries stay hard refusals under an instruction.
    assert.equal((await call("POST", "/payees/0.0.1004/revoke")).status, 200);
    const rv = await call("POST", "/proposals", { proposal: prop("NR-2", 5, "0.0.1004") });
    assert.equal(rv.body.decision, "REFUSED");
    assert.equal((await entries(call)).at(-1)!.event, "REFUSED_UNREGISTERED_PAYEE");
    // A payee revoked while its vote is open: the vote passes, the re-check aborts.
    const big = await call("POST", "/proposals", { proposal: prop("NR-3", 60, "0.0.1003") });
    assert.equal(big.body.decision, "PENDING_VOTE");
    await call("POST", "/payees/0.0.1003/revoke");
    await ballot(call, "/proposals/NR-3/vote", "a", "yes");
    const aborted = await ballot(call, "/proposals/NR-3/vote", "b", "yes");
    assert.equal(aborted.body.outcome.decision, "REFUSED");
    assert.match(aborted.body.outcome.reason, /payee revoked, ABORTED/);
  });
});

test("new recipient: refused when the instruction says refuse; signed at execution after a voted challenge window", async () => {
  await withServer({ env: {} }, async (call) => {
    await join3(call);
    await adopt(call, "Up to 10 HBAR per payment. Refuse anything else.");
    const r = await call("POST", "/proposals", { proposal: prop("NF-1", 5, "0.0.9001") });
    assert.equal(r.body.decision, "REFUSED");
    assert.match(r.body.reason, /new recipient/);
    assert.equal((await entries(call)).at(-1)!.event, "REFUSED_OUTSIDE_MANDATE");
  });
  let clock = new Date();
  await withServer({ env: { CHALLENGE_WINDOW_SECONDS: "60" }, now: () => clock }, async (call) => {
    await join3(call);
    await adopt(call, "Up to 50 HBAR each.");
    assert.equal((await call("POST", "/proposals", { proposal: prop("NW-1", 5, "0.0.9001") })).body.decision, "PENDING_VOTE");
    await ballot(call, "/proposals/NW-1/vote", "a", "yes");
    assert.equal((await ballot(call, "/proposals/NW-1/vote", "b", "yes")).body.outcome.decision, "PENDING_CHALLENGE");
    clock = new Date(Date.now() + 90_000);
    const x = await call("POST", "/proposals/NW-1/execute");
    assert.equal(x.body.decision, "SIGNED", x.body.reason);
    assert.equal(typeof (await entries(call)).at(-1)!.meta.rulesHash, "string");
  });
});

// ---- rulesHash anchors in verify ----

test("verify: a decision under an instruction shows its rulesHash and checks it against MANDATE_ADOPTED", async () => {
  await withServer({ env: {} }, async (call) => {
    await join3(call);
    const m = await adopt(call, "Up to 50 HBAR each, at most 200 HBAR a month.");
    const r = await call("POST", "/proposals", { proposal: prop("VR-1", 10) });
    assert.equal(r.body.decision, "SIGNED");
    const bundle: EvidenceBundle = (await call("GET", "/proposals/VR-1/evidence")).body;
    const policy = (await call("GET", "/policy")).body;
    const log = await entries(call);
    const out = verifyBundle(bundle, policy, log, { auditSource: "server" });
    const line = out.find((x) => x.name === "instruction");
    assert.equal(line?.status, "PASS");
    assert.match(line!.detail, new RegExp(`^M-1 rulesHash ${m.rulesHash.slice(0, 16)}… matches MANDATE_ADOPTED entry \\d+$`));
    assert.deepEqual(out.filter((x) => x.status === "FAIL"), []);
    // A log whose MANDATE_ADOPTED entry carries other rules fails the line.
    const forged = log.map((e) => (e.event === "MANDATE_ADOPTED" ? { ...e, meta: { ...e.meta, rulesHash: "0".repeat(64) } } : e));
    assert.equal(verifyBundle(bundle, policy, forged, { auditSource: "server" }).find((x) => x.name === "instruction")?.status, "FAIL");
    // No instruction, no instruction line.
    await call("POST", "/proposals", { proposal: prop("VR-0", 1) });
  });
  await withServer({ env: {} }, async (call) => {
    await call("POST", "/proposals", { proposal: prop("VN-1", 0.1) });
    const bundle: EvidenceBundle = (await call("GET", "/proposals/VN-1/evidence")).body;
    const out = verifyBundle(bundle, (await call("GET", "/policy")).body, await entries(call), { auditSource: "server" });
    assert.equal(out.some((x) => x.name === "instruction"), false);
  });
});

// ---- restart ----

test("restart: an open proposal vote is closed with a VOTE_CANCELLED_RESTART entry", async () => {
  const file = pathJoin(mkdtempSync(pathJoin(tmpdir(), "restart-")), "state.json");
  await withServer({ env: {}, statePath: file }, async (call) => {
    await join3(call);
    await adopt(call, "Up to 50 HBAR each.");
    assert.equal((await call("POST", "/proposals", { proposal: prop("RS-1", 60) })).body.decision, "PENDING_VOTE");
    assert.equal((await call("POST", "/council/revoke", { mocked: true, byNullifier: "mock:a", seat: "council-seat:3" })).status, 202);
  });
  await withServer({ env: {}, statePath: file }, async (call) => {
    const log = await entries(call);
    const e = log.find((x) => x.event === "VOTE_CANCELLED_RESTART");
    assert.equal(e?.proposalId, "RS-1");
    const votes = (await call("GET", "/council/votes")).body;
    assert.equal(votes.closed.find((i: any) => i.subject === "RS-1").decision, "CANCELLED");
    // Revocation votes do not depend on in-memory proposals: they stay open.
    assert.equal(votes.open.find((i: any) => i.subject === "R-1")?.kind, "revocation");
  });
});

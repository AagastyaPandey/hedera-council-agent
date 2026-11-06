// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Express server. Endpoints:
//   GET  /health                -> mode, network, prices, what is real
//   POST /check                 -> x402-protected proposal check (the paid check service).
//     Real mode: @x402/express paymentMiddleware, Official facilitator
//     https://x402.org/facilitator, network hedera:testnet, price $0.01
//     in testnet USDC 0.0.429274, paid to X402_PAY_TO. No payment -> 402.
//     Simulated mode: same route, plain 402 shape from src/x402.ts.
//   POST /proposals             -> full council flow for a proposal
//     (pay via x402, 0G verdict, mismatch check, World ID gate, sign/refuse).
//     Client-supplied World ID "checks" are ignored: only approvals the
//     server verified itself count. A proposal id is bound to its content
//     on first submission, so an approval cannot be reused for a changed transfer.
//   GET  /proposals             -> list of registered proposals
//   GET  /proposals/:id         -> registered proposal, last outcome, approval state
//   GET  /proposals/:id/evidence -> evidence bundle for the decision, with a digest
//   GET  /policy                -> the published agent policy and its hash
//   GET  /audit, /audit/verify  -> the HCS decision log, and a re-check of its hash chain
//   GET  /world/config          -> public World ID config for the approval page
//   POST /world/rp-context      -> RP-signed IDKit request for one server-chosen action
//   POST /world/verify          -> verify the owner's World ID for one proposal,
//     store the approval server-side (5 min, single use)
//   POST /council/join          -> Proof of Human council join, one seat per nullifier
//   GET  /council/seats         -> current seats
//   GET  /                      -> static UI from public/ (see docs/ui-handoff.md)
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { atomicToUsd, SpendingCap, usdcToAtomic } from "./budget.js";
import { processProposal, type CouncilOutcome } from "./council.js";
import { checkProposal } from "./checker.js";
import { HederaClient, loadHederaConfig } from "./hedera.js";
import { canonical, sha256, verifyChain, isChainedEntry } from "./auditlog.js";
import { HederaChain, loadCouncilSetup } from "./chain.js";
import { SimulatedCheckPayer, X402CheckPayer, type CheckPayer } from "./payment.js";
import { isLargeProposal, proposalFingerprint, validateProposal, type Proposal } from "./proposal.js";
import { DEMO_PAYEES, loadPayeeRegistry } from "./payee.js";
import { buildPolicy } from "./policy.js";
import { StateStore } from "./store.js";
import {
  ApprovalStore,
  councilSignAction,
  isWorldConfigured,
  JOIN_ACTION,
  loadWorldConfig,
  proposalSignal,
  mockedAllowed,
  mockedWorldCheck,
  rpContextFor,
  verifiedWorldCheck,
  verifyWorldProof,
} from "./world.js";
import { loadZeroGConfig } from "./zeroG.js";
import { acceptsForCheck, paymentRequiredResponse, X402_FACILITATOR_URL } from "./x402.js";
import { APPROVAL_TTL_MINUTES } from "./world.js";
import { hashscanUrl } from "./hedera.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isSafeInteger(v) && v > 0 ? v : fallback;
}

export function buildAgent(env: NodeJS.ProcessEnv = process.env, port = Number(env.PORT ?? 3000)) {
  const { config, mode } = loadHederaConfig(env);
  const council = mode === "real" ? loadCouncilSetup(env) : null;
  // The treasury comes from setup when not set explicitly.
  if (council?.treasuryAccountId && !env.HEDERA_TREASURY_ACCOUNT_ID?.trim()) config.treasuryAccountId = council.treasuryAccountId;
  const hedera = new HederaClient(config, mode);
  const priceUsd = (env.X402_PRICE_USDC ?? "0.01").trim();
  const priceAtomic = usdcToAtomic(priceUsd);
  const x402Network = config.network === "mainnet" ? ("hedera:mainnet" as const) : ("hedera:testnet" as const);
  const payTo = (env.X402_PAY_TO ?? "").trim() || config.accountId || "0.0.0";
  const checkServiceUrl = (env.CHECK_SERVICE_URL ?? "").trim() || `http://127.0.0.1:${port}/check`;
  const payer: CheckPayer =
    mode === "real"
      ? new X402CheckPayer(
          { url: checkServiceUrl, accountId: config.accountId, privateKey: config.privateKey, network: x402Network, expectedPayTo: payTo },
          priceAtomic,
        )
      : new SimulatedCheckPayer(hedera, priceAtomic, { expectedPayTo: payTo });
  // The demo payees are accepted only in simulated mode, and say so.
  const payees = loadPayeeRegistry(env, mode === "simulated" ? DEMO_PAYEES : []);
  return {
    payees,
    // Real mode fails closed without a 0G verdict; ALLOW_NO_0G=true overrides.
    requireVerdict: mode === "real",
    allowNo0G: (env.ALLOW_NO_0G ?? "").trim().toLowerCase() === "true",
    hedera,
    spendCapUsd: (env.AGENT_SPEND_CAP_USDC ?? "0.10").trim(),
    budget: new SpendingCap(usdcToAtomic((env.AGENT_SPEND_CAP_USDC ?? "0.10").trim())),
    zeroG: loadZeroGConfig(env),
    world: loadWorldConfig(env),
    largeThresholdTinybars: envInt(env, "LARGE_PROPOSAL_TINYBARS", 50_000_000),
    payer,
    chain: mode === "real" ? new HederaChain(hedera, council) : undefined,
    councilProposer: council?.memberAccountId ?? null,
    payTo,
    priceUsd,
    priceAtomic,
    x402Network,
    checkServiceUrl,
    mode,
  };
}

interface RegisteredProposal {
  proposal: Proposal;
  fingerprint: string;
  lastOutcome: CouncilOutcome | null;
}

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  // null keeps seats and spent approvals in memory (tests).
  statePath?: string | null;
  // Injected World verify transport (tests).
  worldFetch?: typeof fetch;
  port?: number;
}

export async function createApp(options: AppOptions = {}): Promise<Express> {
  const env = options.env ?? process.env;
  const agent = buildAgent(env, options.port);
  const store = new StateStore(
    options.statePath === undefined ? (env.STATE_FILE ?? join(ROOT, ".data", "state.json")) : options.statePath,
  );
  const approvals = new ApprovalStore();
  const { policy, hash: policyHash } = buildPolicy({
    network: agent.hedera.config.network,
    mode: agent.mode,
    treasury: agent.hedera.config.treasuryAccountId || "simulated",
    signers: {
      agent: agent.hedera.config.accountId || "simulated",
      proposer: agent.councilProposer,
      threshold: agent.councilProposer ? "2 of 2 (agent and council member)" : agent.mode === "real" ? "set by the treasury key" : "simulated",
    },
    largeThresholdTinybars: agent.largeThresholdTinybars,
    check: { via: agent.payer.via, priceUsdc: agent.priceUsd, spendCapUsdc: agent.spendCapUsd, decidedBy: "deterministic checker", payTo: agent.payTo },
    payees: agent.payees.summary(),
    verdict: { zeroG: agent.zeroG.apiKey ? "configured" : "not configured", requireVerdict: agent.requireVerdict, allowNo0G: agent.allowNo0G },
    worldGate: { requiredForLarge: true, environment: agent.world.environment, approvalTtlMinutes: APPROVAL_TTL_MINUTES, singleUse: true },
    transferSource: agent.mode === "real" ? "hedera-mirror-node" : "request",
  });
  agent.hedera.setPolicy(policyHash);
  const proposals = new Map<string, RegisteredProposal>();
  const worldOn = isWorldConfigured(agent.world);
  const allowMocked = mockedAllowed(agent.world, agent.hedera.config.network);
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  if (agent.mode === "real" && agent.payTo === agent.hedera.config.accountId) {
    console.warn(
      "X402_PAY_TO equals HEDERA_ACCOUNT_ID: the agent would pay its own check fees to itself. " +
        "Set X402_PAY_TO to a separate fee account (npm run preflight -- --create-fee-account).",
    );
  }

  // Real x402 protection for POST /check, when a payee account is set.
  // The resource server must initialize() first: it fetches the
  // facilitator's supported kinds, otherwise every request fails with
  // "Facilitator does not support exact on hedera:testnet". If the
  // facilitator is unreachable at boot, fall back to the plain 402
  // shape and log it honestly.
  let x402Applied = false;
  if (agent.payTo !== "0.0.0") {
    try {
      const { HTTPFacilitatorClient, x402ResourceServer } = await import("@x402/core/server");
      const { paymentMiddleware } = await import("@x402/express");
      const { ExactHederaScheme } = await import("@x402/hedera/exact/server");
      const { bazaarResourceServerExtension, declareDiscoveryExtension } = await import("@x402/extensions/bazaar");
      const resourceServer = new x402ResourceServer(
        new HTTPFacilitatorClient({ url: (env.X402_FACILITATOR_URL ?? "").trim() || X402_FACILITATOR_URL }),
      )
        .register(agent.x402Network, new ExactHederaScheme())
        .registerExtension(bazaarResourceServerExtension);
      await resourceServer.initialize();
      app.use(
        paymentMiddleware(
          {
            "POST /check": {
              accepts: [{ scheme: "exact", price: `$${agent.priceUsd}`, network: agent.x402Network, payTo: agent.payTo }],
              description: "Paid proposal check: one check of one treasury proposal",
              // x402 Bazaar discovery: lets other agents find and call this paid check.
              extensions: {
                ...declareDiscoveryExtension({
                  bodyType: "json",
                  input: {
                    proposal: {
                      id: "P-001",
                      description: { payee: "0.0.1001", amountTinybars: 10000000, token: "HBAR", purpose: "Pay the venue deposit" },
                      transfer: { payee: "0.0.1001", amountTinybars: 10000000, token: "HBAR" },
                    },
                  },
                  inputSchema: { properties: { proposal: { type: "object" } }, required: ["proposal"] },
                  output: {
                    example: { proposalId: "P-001", matches: true, mismatches: [], verdict: "Proposal P-001 matches its description." },
                  },
                }),
              },
            },
          },
          resourceServer,
        ),
      );
      x402Applied = true;
    } catch (err) {
      console.warn("x402 middleware unavailable, falling back to plain 402:", err instanceof Error ? err.message : err);
    }
  }

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: agent.mode,
      network: agent.hedera.config.network,
      x402Seller: x402Applied ? `real (@x402/express, Official facilitator, $${agent.priceUsd} USDC to ${agent.payTo})` : "simulated (plain 402 shape)",
      x402Buyer: agent.payer.via === "x402" ? `real, pays ${agent.checkServiceUrl}` : "simulated (SIM-PAY ids)",
      checkPrice: atomicToUsd(agent.priceAtomic),
      spendCapRemaining: atomicToUsd(agent.budget.remainingAtomic),
      hcsTopic: agent.hedera.config.topicId || (agent.mode === "real" ? "created on first audit" : "simulated"),
      treasury: agent.hedera.config.treasuryAccountId || "simulated",
      councilProposer: agent.councilProposer ?? (agent.mode === "real" ? "none: proposals must name a scheduleId" : "simulated"),
      zeroG: agent.zeroG.apiKey ? "real" : "simulated",
      zeroGFailClosed: agent.allowNo0G ? "off (ALLOW_NO_0G=true)" : agent.requireVerdict || agent.zeroG.apiKey ? "on: no 0G verdict, no signature" : "off in simulated mode with no key (labelled template verdict)",
      payeeRegistry: payeeSummary(),
      world: worldOn ? `real (${agent.world.environment})` : "not configured, MOCKED approvals only",
      councilSeats: store.seats().length,
      note:
        agent.mode === "simulated"
          ? "SIMULATED mode: no Hedera credentials set. Chain ids are SIM- ids, not real."
          : "REAL mode: Hedera credentials set.",
    });
  });

  app.post("/check", (req, res) => {
    const v = validateProposal(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
    if (x402Applied) {
      // The middleware verified the payment before this handler ran and
      // settles it via the facilitator after it.
      res.json({ ...checkProposal(v.proposal), mode: agent.mode });
      return;
    }
    // Simulated / fallback path: plain 402, verify a SIM- payment id.
    const payment = req.headers["x-payment"];
    if (!payment || typeof payment !== "string") {
      const r = paymentRequiredResponse(
        acceptsForCheck({ network: agent.hedera.config.network, payTo: agent.payTo, priceTinybars: 100_000 }),
      );
      res.status(r.status).json(r.body);
      return;
    }
    void agent.hedera.verifyPayment(payment).then((ok) => {
      if (!ok) res.status(402).json({ error: "Payment did not verify as settled on Hedera.", x402Version: 1 });
      else res.json({ ...checkProposal(v.proposal), paidWith: payment, mode: agent.mode });
    });
  });

  app.post("/proposals", async (req, res) => {
    const v = validateProposal((req.body as { proposal?: unknown } | null)?.proposal);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
    const proposal = v.proposal;
    const fingerprint = proposalFingerprint(proposal);
    const known = proposals.get(proposal.id);
    if (known && known.fingerprint !== fingerprint) {
      res.status(409).json({ error: `Proposal ${proposal.id} was already submitted with different content. Use a new id.` });
      return;
    }
    const entry = known ?? { proposal, fingerprint, lastOutcome: null };
    proposals.set(proposal.id, entry);
    // Resubmissions use the proposal as already resolved against Hedera, so
    // the same schedule is checked and signed, not a new one created.
    const outcome = await processProposal(agent, entry.proposal, approvals.get(proposal.id));
    if (outcome.usedWorldApproval) approvals.delete(proposal.id);
    entry.proposal = outcome.proposal;
    entry.lastOutcome = outcome;
    const needsApproval =
      outcome.decision === "REFUSED" && outcome.worldGateReason !== null && outcome.checkMatches;
    res.json(needsApproval ? { ...outcome, approveUrl: `/console.html?proposal=${encodeURIComponent(proposal.id)}` } : outcome);
  });

  app.get("/proposals", (_req, res) => {
    res.json({
      proposals: [...proposals.values()].map((e) => ({
        id: e.proposal.id,
        purpose: e.proposal.description.purpose,
        amountTinybars: e.proposal.transfer.amountTinybars,
        large: isLargeProposal(e.proposal, agent.largeThresholdTinybars),
        matches: checkProposal(e.proposal).matches,
        decision: e.lastOutcome?.decision ?? null,
        scheduledTxId: e.lastOutcome?.scheduledTxId ?? null,
      })),
    });
  });

  app.get("/proposals/:id", (req, res) => {
    const entry = proposals.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Unknown proposal. Submit it to POST /proposals first." });
      return;
    }
    const approval = approvals.get(entry.proposal.id);
    res.json({
      proposal: entry.proposal,
      large: isLargeProposal(entry.proposal, agent.largeThresholdTinybars),
      check: checkProposal(entry.proposal),
      lastOutcome: entry.lastOutcome,
      approval: approval ? { source: approval.source, expiresAt: approval.expiresAt } : null,
    });
  });

  // Link to the original console app (run separately: npm run console).
  app.get("/original-console", (_req, res) => {
    res.redirect((env.ORIGINAL_CONSOLE_URL ?? "").trim() || "http://localhost:3380/council");
  });

  const payeeSummary = () => {
    const sm = agent.payees.summary();
    const name = sm.source === "demo registry" ? "demo registry" : sm.source;
    return `${name}: ${sm.count} payee(s), ${sm.enforce ? "enforced" : "not enforced"}`;
  };

  app.get("/payees", (_req, res) => {
    res.json({ ...agent.payees.summary(), payees: agent.payees.entries });
  });

  app.get("/policy", (_req, res) => {
    res.json({ policy, hash: policyHash, note: "Every HCS audit entry carries this hash." });
  });

  const topicLink = (topicId: string | null) =>
    topicId && agent.mode === "real"
      ? `https://hashscan.io/${agent.hedera.config.network === "mainnet" ? "mainnet" : "testnet"}/topic/${topicId}`
      : null;

  // Re-reads the audit topic and re-checks the hash chain from scratch.
  app.get("/audit/verify", async (_req, res) => {
    try {
      const log = await agent.hedera.readAuditLog();
      const report = verifyChain(log.messages);
      res.json({ source: log.source, topicId: log.topicId, hashscan: topicLink(log.topicId), truncated: log.truncated, ...report, policyHash });
    } catch (err) {
      res.status(502).json({ error: `Could not read the audit topic: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/audit", async (_req, res) => {
    try {
      const log = await agent.hedera.readAuditLog();
      const entries = log.messages.filter(isChainedEntry);
      res.json({
        source: log.source,
        topicId: log.topicId,
        hashscan: topicLink(log.topicId),
        report: verifyChain(log.messages),
        entries: entries.slice(-100),
      });
    } catch (err) {
      res.status(502).json({ error: `Could not read the audit topic: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // Everything a judge needs to check one decision, with a digest over it.
  app.get("/proposals/:id/evidence", (req, res) => {
    const entry = proposals.get(req.params.id);
    const o = entry?.lastOutcome;
    if (!entry || !o) {
      res.status(404).json({ error: "No decision recorded for this proposal yet." });
      return;
    }
    const net = agent.hedera.config.network;
    const real = o.mode === "real";
    const bundle = {
      version: 1,
      proposalId: entry.proposal.id,
      decision: o.decision,
      reason: o.reason,
      mode: o.mode,
      policyHash,
      proposal: entry.proposal,
      transferSource: o.transferSource,
      check: checkProposal(entry.proposal),
      payment: { via: o.paidVia, id: o.paidTxId, hashscan: real && o.paidTxId ? hashscanUrl(net, o.paidTxId) : null },
      zeroG: { source: o.zeroGSource, requestId: o.zeroGRequestId, verdict: o.zeroGVerdictText },
      worldGate: o.worldGateReason,
      schedule: {
        id: o.scheduledTxId,
        action: o.scheduleAction,
        hashscan: real && o.scheduledTxId ? `https://hashscan.io/${net === "mainnet" ? "mainnet" : "testnet"}/schedule/${o.scheduledTxId}` : null,
      },
      audit: { txId: o.auditTxId, seq: o.auditSeq, entryHash: o.auditHash, topicId: agent.hedera.config.topicId || null, hashscan: topicLink(agent.hedera.config.topicId || null) },
    };
    res.json({ ...bundle, digest: sha256(canonical(bundle)), digestOf: "sha256 over the canonical JSON of this bundle without the digest field" });
  });

  app.get("/world/config", (_req, res) => {
    res.json({
      configured: worldOn,
      appId: worldOn ? agent.world.appId : null,
      environment: agent.world.environment,
      mockedAllowed: allowMocked,
    });
  });

  // The action is chosen by the server, never by the client.
  const actionFor = (body: { proposalId?: unknown; join?: unknown }): { action: string; signal?: string } | { error: string; status: number } => {
    if (body.join === true) return { action: JOIN_ACTION };
    if (typeof body.proposalId !== "string" || !proposals.has(body.proposalId)) {
      return { error: "Unknown proposal. Submit it to POST /proposals first.", status: 404 };
    }
    return { action: councilSignAction(body.proposalId), signal: proposalSignal(proposals.get(body.proposalId)!.fingerprint) };
  };

  app.post("/world/rp-context", (req, res) => {
    if (!worldOn) {
      res.status(503).json({ error: "World ID is not configured on this server (WORLD_RP_ID, WORLD_APP_ID, WORLD_SIGNING_KEY)." });
      return;
    }
    const a = actionFor(req.body ?? {});
    if ("error" in a) {
      res.status(a.status).json({ error: a.error });
      return;
    }
    res.json({ action: a.action, signal: a.signal, appId: agent.world.appId, environment: agent.world.environment, rpContext: rpContextFor(agent.world, a.action) });
  });

  app.post("/world/verify", async (req, res) => {
    const body = (req.body ?? {}) as { proposalId?: unknown; idkitResult?: Record<string, unknown>; mocked?: unknown };
    const a = actionFor({ proposalId: body.proposalId });
    if ("error" in a) {
      res.status(a.status).json({ error: a.error });
      return;
    }
    const proposalId = body.proposalId as string;
    if (body.mocked === true) {
      if (!allowMocked) {
        res.status(403).json({ error: "Mocked approvals are disabled: World ID is configured (or this is mainnet)." });
        return;
      }
      const check = mockedWorldCheck(proposalId, "approved");
      approvals.set(check);
      res.json({ approved: true, source: "mocked", expiresAt: check.expiresAt, note: "MOCKED proof, demo only. Not a real World ID verification." });
      return;
    }
    if (!worldOn || !body.idkitResult || typeof body.idkitResult !== "object") {
      res.status(400).json({ error: "World ID is not configured, or no idkitResult was supplied." });
      return;
    }
    const verified = await verifyWorldProof(agent.world, body.idkitResult, a.action, options.worldFetch, a.signal);
    if (!verified.ok || !verified.nullifier) {
      res.status(403).json({ approved: false, error: verified.detail });
      return;
    }
    if (!store.consumeApproval(`${a.action}:${verified.nullifier}`)) {
      res.status(409).json({ approved: false, error: "This World ID approval was already used." });
      return;
    }
    const check = verifiedWorldCheck(proposalId);
    approvals.set(check);
    res.json({ approved: true, source: "world", expiresAt: check.expiresAt, detail: verified.detail });
  });

  app.post("/council/join", async (req, res) => {
    const body = (req.body ?? {}) as { idkitResult?: Record<string, unknown>; mocked?: unknown; nullifier?: unknown };
    if (body.mocked === true) {
      if (!allowMocked) {
        res.status(403).json({ error: "Mocked joins are disabled: World ID is configured (or this is mainnet)." });
        return;
      }
      if (typeof body.nullifier !== "string" || body.nullifier.length === 0 || body.nullifier.length > 80) {
        res.status(400).json({ error: "nullifier (1-80 chars) is required for a mocked join." });
        return;
      }
      const seat = store.addSeat(`mock:${body.nullifier}`, "mocked");
      if (!seat) {
        res.status(409).json({ joined: false, error: "This person already holds a council seat." });
        return;
      }
      res.json({ joined: true, seat: seat.seat, proof: "MOCKED Proof of Human (demo only)" });
      return;
    }
    if (!worldOn || !body.idkitResult || typeof body.idkitResult !== "object") {
      res.status(400).json({ error: "World ID is not configured, or no idkitResult was supplied." });
      return;
    }
    const verified = await verifyWorldProof(agent.world, body.idkitResult, JOIN_ACTION, options.worldFetch);
    if (!verified.ok || !verified.nullifier) {
      res.status(403).json({ joined: false, error: verified.detail });
      return;
    }
    const seat = store.addSeat(verified.nullifier, "world");
    if (!seat) {
      res.status(409).json({ joined: false, error: "This person already holds a council seat." });
      return;
    }
    res.json({ joined: true, seat: seat.seat, proof: "World ID Proof of Human, backend-verified" });
  });

  app.get("/council/seats", (_req, res) => {
    res.json({
      count: store.seats().length,
      seats: store.seats().map((s) => ({ seat: s.seat, source: s.source, joinedAt: s.joinedAt, nullifier: `${s.nullifier.slice(0, 10)}…` })),
    });
  });

  app.get("/world/qr.svg", async (req, res) => {
    const data = typeof req.query.data === "string" ? req.query.data : "";
    if (!data || data.length > 2048) {
      res.status(400).send("data is required");
      return;
    }
    res.type("image/svg+xml").send(await QRCode.toString(data, { type: "svg", margin: 1 }));
  });

  app.get("/vendor/idkit.js", (_req, res) => {
    res.sendFile(join(ROOT, "node_modules", "@worldcoin", "idkit-core", "dist", "idkit.global.js"));
  });
  app.use(express.static(join(ROOT, "public")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: status === 500 ? "Internal error" : String((err as Error).message) });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const app = await createApp({ port });
  app.listen(port, () => {
    console.log(`hedera-council-agent listening on :${port}`);
  });
}

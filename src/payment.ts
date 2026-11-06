// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// How the agent pays for a proposal check.
// Real mode: x402 on Hedera. The agent calls the paid check service
// (CHECK_SERVICE_URL, default this server's own POST /check), pays $0.01
// testnet USDC per check with no human approving, and gets the check
// result back. The settlement tx id is the payment id.
// Simulated mode: a SIM-PAY id, clearly labelled, no chain involved.

import type { CheckResult } from "./checker.js";
import type { HederaClient } from "./hedera.js";
import type { Proposal } from "./proposal.js";
import { x402Check } from "./x402Client.js";

export type PaidCheck =
  | { ok: true; paymentId: string; via: "x402" | "simulated"; remoteCheck: CheckResult | null }
  | { ok: false; paymentId: string | null; via: "x402" | "simulated"; error: string };

export interface CheckPayer {
  readonly via: "x402" | "simulated";
  readonly priceAtomic: number;
  payForCheck(proposal: Proposal): Promise<PaidCheck>;
}

export class SimulatedCheckPayer implements CheckPayer {
  readonly via = "simulated" as const;
  constructor(
    private readonly hedera: HederaClient,
    readonly priceAtomic: number,
  ) {}

  async payForCheck(): Promise<PaidCheck> {
    return { ok: true, paymentId: this.hedera.simId("PAY"), via: this.via, remoteCheck: null };
  }
}

function asCheckResult(body: unknown): CheckResult | null {
  const b = body as Partial<CheckResult> | null;
  if (!b || typeof b.matches !== "boolean" || typeof b.proposalId !== "string" || !Array.isArray(b.mismatches)) {
    return null;
  }
  return { proposalId: b.proposalId, matches: b.matches, mismatches: b.mismatches, verdict: String(b.verdict ?? "") };
}

export class X402CheckPayer implements CheckPayer {
  readonly via = "x402" as const;
  constructor(
    private readonly opts: {
      url: string;
      accountId: string;
      privateKey: string;
      network: "hedera:testnet" | "hedera:mainnet";
    },
    readonly priceAtomic: number,
  ) {}

  async payForCheck(proposal: Proposal): Promise<PaidCheck> {
    try {
      const r = await x402Check(this.opts.url, proposal, { ...this.opts, maxAmountAtomic: this.priceAtomic });
      const paymentId = r.settlement?.transaction || null;
      if (r.status !== 200) {
        return { ok: false, paymentId, via: this.via, error: `Check service returned HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}` };
      }
      if (!r.settlement?.success || !paymentId) {
        return { ok: false, paymentId, via: this.via, error: `x402 payment did not settle: ${r.settlement?.errorReason ?? "no PAYMENT-RESPONSE"}` };
      }
      const remoteCheck = asCheckResult(r.body);
      if (!remoteCheck) return { ok: false, paymentId, via: this.via, error: "Check service returned no check result" };
      return { ok: true, paymentId, via: this.via, remoteCheck };
    } catch (err) {
      return { ok: false, paymentId: null, via: this.via, error: `x402 payment failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

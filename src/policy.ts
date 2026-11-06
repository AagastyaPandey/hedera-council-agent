// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// The agent's published policy: the rules it signs under, as data. Its
// hash is written into every HCS audit entry, so each logged decision
// commits to the exact policy in force when it was made, and anyone can
// fetch GET /policy and check the hash.

import { canonical, sha256 } from "./auditlog.js";

export interface AgentPolicy {
  version: 1;
  network: string;
  mode: "real" | "simulated";
  treasury: string;
  signers: { agent: string; proposer: string | null; threshold: string };
  largeThresholdTinybars: number;
  check: { via: "x402" | "simulated"; priceUsdc: string; spendCapUsdc: string; decidedBy: string };
  worldGate: { requiredForLarge: boolean; environment: string; approvalTtlMinutes: number; singleUse: boolean };
  transferSource: "hedera-mirror-node" | "request";
  rules: string[];
}

export function buildPolicy(p: Omit<AgentPolicy, "version" | "rules">): { policy: AgentPolicy; hash: string } {
  const policy: AgentPolicy = {
    version: 1,
    ...p,
    rules: [
      "Sign only the Scheduled Transaction read back from Hedera, never a transfer supplied with the request.",
      "Refuse when payee, amount or token differ from the description. The deterministic checker decides; no model is in the decision path.",
      "Refuse a schedule that pays out of any account other than the council treasury, or that is deleted or already executed.",
      "Pay for every check over x402 under a spending cap, and never pay above the configured price.",
      `Large proposals need a fresh World ID approval for that exact proposal: single use, ${p.worldGate.approvalTtlMinutes} minutes, verified on the server.`,
      "Log every decision to the HCS audit topic as a hash-chained entry that commits to this policy.",
    ],
  };
  return { policy, hash: sha256(canonical(policy)) };
}

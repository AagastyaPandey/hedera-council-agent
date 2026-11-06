// This project's Hedera council API, read from the original console's own screens.
// Server-side only. Set COUNCIL_API_URL when the council server is not on :3000.
const BASE = (process.env.COUNCIL_API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

export interface CouncilProposal {
  id: string; purpose: string; amountTinybars: number; large: boolean;
  matches: boolean; decision: "SIGNED" | "REFUSED" | null; scheduledTxId: string | null;
}
export interface CouncilData {
  online: boolean;
  base: string;
  health: Record<string, unknown> | null;
  proposals: CouncilProposal[];
  verify: { ok: boolean; checked: number; head: { seq: number; hash: string } | null; reason: string | null } | null;
  policyHash: string | null;
  seats: number;
  detail: Record<string, { check: { verdict: string; mismatches: { field: string; described: string; actual: string }[] }; outcome: Record<string, unknown> | null }>;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function getCouncil(): Promise<CouncilData> {
  const [health, list, verify, policy, seats] = await Promise.all([
    get<Record<string, unknown>>("/health"),
    get<{ proposals: CouncilProposal[] }>("/proposals"),
    get<CouncilData["verify"]>("/audit/verify"),
    get<{ hash: string }>("/policy"),
    get<{ count: number }>("/council/seats"),
  ]);
  const proposals = list?.proposals ?? [];
  const detail: CouncilData["detail"] = {};
  await Promise.all(
    proposals.slice(-6).map(async (p) => {
      const d = await get<{ check: CouncilData["detail"][string]["check"]; lastOutcome: Record<string, unknown> | null }>(
        `/proposals/${encodeURIComponent(p.id)}`,
      );
      if (d) detail[p.id] = { check: d.check, outcome: d.lastOutcome };
    }),
  );
  return { online: health !== null, base: BASE, health, proposals, verify, policyHash: policy?.hash ?? null, seats: seats?.count ?? 0, detail };
}

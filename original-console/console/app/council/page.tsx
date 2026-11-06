import type { Metadata } from "next";
import { HashLine, StatusPill } from "@/components/ui";
import { getCouncil } from "@/lib/council";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Council" };

const hbar = (t: number) => `${(t / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} HBAR`;
const s = (v: unknown) => (v === null || v === undefined || v === "" ? "none yet" : String(v));

export default async function CouncilPage() {
  const c = await getCouncil();
  const h = c.health ?? {};
  const signed = c.proposals.filter((p) => p.decision === "SIGNED").length;
  const refused = c.proposals.filter((p) => p.decision === "REFUSED").length;
  const log = c.verify;

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Council agent</div>
        <div className="doc-folio mt-1">{s(h.mode)}, {s(h.network)}</div>
        <div className="mt-7 border-t border-edge pt-3">
          <div className="doc-note">{c.online ? "Live from the Hedera API" : "Council server offline"}</div>
        </div>
      </aside>

      <div className="doc-body">
        <header className="mb-7 border-b border-edge pb-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="mono-label">Hedera treasury council</span>
            <StatusPill status={c.online ? "OK" : "RED"}>{c.online ? "connected" : "offline"}</StatusPill>
          </div>
          <h1 className="doc-title text-body">One agent. One signing seat.</h1>
          <p className="doc-deck mt-4">
            Every proposal is a transfer plus a description of it. The agent pays for a check, reads the real transfer
            back from Hedera, and signs only when the two agree. {c.proposals.length} proposals, {signed} signed,{" "}
            {refused} refused, {c.seats} council seats.
          </p>
        </header>

        {!c.online ? (
          <p className="panel p-5 text-[12px] text-dim">
            The council server at {c.base} did not answer. Start it with <code className="hash">npm start</code> in the repo
            root, or set COUNCIL_API_URL.
          </p>
        ) : (
          <>
            <section className="mb-10">
              <div className="mb-4"><h2 className="doc-section-title text-body">Proposals</h2></div>
              <div className="panel p-5">
                {c.proposals.length === 0 ? (
                  <p className="text-[12px] text-dim">No proposals yet. Submit one in the project console.</p>
                ) : (
                  c.proposals.map((p) => {
                    const d = c.detail[p.id];
                    const o = d?.outcome ?? {};
                    return (
                      <div key={p.id} className="border-b border-edge/70 py-4 last:border-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="text-[13px] font-medium text-body">{p.id}: {p.purpose}{p.large ? " (large)" : ""}</span>
                          <span className="flex gap-4">
                            <StatusPill status={p.matches ? "PASS" : "FAIL"}>{p.matches ? "matches" : "mismatch"}</StatusPill>
                            <StatusPill status={p.decision === "SIGNED" ? "PASSED" : p.decision === "REFUSED" ? "REJECTED" : "NEUTRAL"}>
                              {p.decision ? p.decision.toLowerCase() : "not submitted"}
                            </StatusPill>
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] text-dim">{hbar(p.amountTinybars)}. {d?.check.verdict}</p>
                        {d?.outcome ? (
                          <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
                            <HashLine label="Schedule" value={s(o.scheduledTxId)} />
                            <HashLine label="Check payment" value={`${s(o.paidTxId)} (${s(o.paidVia)})`} />
                            <HashLine label="HCS audit entry" value={o.auditHash ? `#${s(o.auditSeq)} ${s(o.auditHash)}` : "none yet"} />
                            <HashLine label="0G verdict" value={`${s(o.zeroGSource)} ${o.zeroGRequestId ? s(o.zeroGRequestId) : ""}`.trim()} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="mb-10">
              <div className="mb-4"><h2 className="doc-section-title text-body">Verifiable log</h2></div>
              <div className="panel p-5">
                <div className="mb-2">
                  <StatusPill status={log?.ok ? "PASS" : "FAIL"}>
                    {log?.ok ? `log verified, ${log.checked} entries` : log ? `log broken: ${log.reason}` : "log unavailable"}
                  </StatusPill>
                </div>
                <HashLine label="Policy hash" value={s(c.policyHash)} full />
                <HashLine label="Log head" value={log?.head ? `#${log.head.seq} ${log.head.hash}` : "empty"} full />
                <HashLine label="Audit topic" value={s(h.hcsTopic)} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

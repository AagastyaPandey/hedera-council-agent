"use client";

import { ArrowUpRight, ListOrdered } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import { getAttentionQueue } from "@/lib/data";
import { formatPct } from "@/lib/format";
import { proposalRef } from "@/lib/proposal-naming";
import { useProposal } from "@/lib/proposal-context";
import { useAsync } from "@/lib/useAsync";

export function AttentionQueue() {
  const { data, loading, error, reload } = useAsync(getAttentionQueue, []);
  const { proposal: selected, setProposalId } = useProposal();

  return (
    <Panel
      title="Attention Queue"
      subtitle="Active proposals ranked by execution-gate risk, then COI risk."
      actions={<ListOrdered size={17} className="text-cyan-300" />}
    >
      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && (!data || data.length === 0)}
        emptyMessage="No active proposals require attention."
        loadingLabel="Ranking active proposals"
        onRetry={reload}
      >
        <div className="space-y-3">
          {data?.map((item) => (
            <article key={item.proposal.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex min-w-[82px] items-center gap-2">
                  <span className="font-mono text-2xl font-semibold text-slate-200">#{item.rank}</span>
                  <StatusBadge tone={item.riskScore >= 0.7 ? "danger" : item.riskScore >= 0.35 ? "warning" : "info"}>{formatPct(item.riskScore)}</StatusBadge>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-cyan-300">
                      {proposalRef(item.proposal.id)}
                    </span>
                    <h3 className="text-sm font-medium text-slate-200">{item.proposal.title}</h3>
                    <StatusBadge tone="neutral">{item.state}</StatusBadge>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {item.reasons.map((reason) => <li key={reason} className="text-[11px] leading-relaxed text-slate-400">{reason}</li>)}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setProposalId(item.proposal.id)}
                  disabled={selected.id === item.proposal.id}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-cyan-300 transition-colors hover:border-cyan-800 disabled:opacity-40"
                >
                  {selected.id === item.proposal.id ? "Selected" : "Review"}<ArrowUpRight size={12} />
                </button>
              </div>
              <WhyDrawer className="mt-3" label={`Why rank #${item.rank}`}>
                A red execution gate receives risk 1.0 and sorts first. Otherwise the COI score determines ordering. This item ranks #{item.rank} because its computed priority is {item.riskScore.toFixed(3)} and {item.reasons.length} advisory stage{item.reasons.length === 1 ? " needs" : "s need"} attention.
              </WhyDrawer>
            </article>
          ))}
        </div>
      </DataState>
    </Panel>
  );
}

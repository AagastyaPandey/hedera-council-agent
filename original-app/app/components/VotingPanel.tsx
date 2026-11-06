"use client";

import { useState } from "react";
import { BookOpenCheck, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import { stageTone } from "@/components/StageCard";
import { castVote, getRiskBrief } from "@/lib/data";
import { EffectPreviewPanel } from "@/components/EffectPreview";
import {
  formatDateTime,
  formatPct,
  formatTokenUnits,
} from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type {
  ActionReceipt,
  RiskBrief,
  VoteRecord,
} from "@/lib/types";

const SUPPORT: Record<number, { label: string; tone: StatusTone }> = {
  0: { label: "Against", tone: "danger" },
  1: { label: "For", tone: "success" },
  2: { label: "Abstain", tone: "neutral" },
};

const STATE_TONE: Record<string, StatusTone> = {
  VotingOpen: "warning",
  Passed: "success",
  Queued: "info",
  Executed: "success",
  Defeated: "danger",
  Halted: "danger",
  Cancelled: "neutral",
};

export function VotingPanel({
  govId,
  proposalId,
}: {
  govId: string;
  proposalId: string;
}) {
  const { data, loading, error, reload } = useAsync(
    () => getRiskBrief(govId),
    [govId]
  );
  const [pending, setPending] = useState<"brief" | "without" | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const vote = async (withBrief: boolean) => {
    setPending(withBrief ? "brief" : "without");
    setVoteError(null);
    try {
      setReceipt(await castVote(govId, withBrief));
      reload();
    } catch (cause) {
      setVoteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <Panel
      title="Informed Voting"
      subtitle="Review the risk brief, then vote with or without a cryptographic brief acknowledgment."
      actions={
        data ? (
          <div className="flex items-center gap-2">
            <StatusBadge tone={STATE_TONE[data.state.state] ?? "neutral"}>{data.state.state}</StatusBadge>
            <StatusBadge tone="neutral">gov {data.state.govId}</StatusBadge>
          </div>
        ) : null
      }
    >
      {/* Rendered above the vote controls and independent of the risk brief, so a
          partially available brief (e.g. no live COI endpoint) cannot hide it. */}
      <div className="mb-6">
        <EffectPreviewPanel proposalId={proposalId} />
      </div>

      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && !data}
        emptyMessage="No voting state or risk brief is available for this proposal."
        loadingLabel="Assembling voting risk brief"
        onRetry={reload}
      >
        {data ? (
          <VotingBody
            brief={data}
            pending={pending}
            receipt={receipt}
            voteError={voteError}
            onVote={vote}
          />
        ) : null}
      </DataState>
    </Panel>
  );
}

function VotingBody({
  brief,
  pending,
  receipt,
  voteError,
  onVote,
}: {
  brief: RiskBrief;
  pending: "brief" | "without" | null;
  receipt: ActionReceipt | null;
  voteError: string | null;
  onVote: (withBrief: boolean) => void;
}) {
  const { state } = brief;
  const total = BigInt(state.forVotes) + BigInt(state.againstVotes) + BigInt(state.abstainVotes);
  const share = (value: string) => total === 0n ? 0 : Number((BigInt(value) * 10000n) / total) / 100;
  const forShare = share(state.forVotes);
  const againstShare = share(state.againstVotes);
  const abstainShare = Math.max(0, 100 - forShare - againstShare);
  const quorumProgress = BigInt(state.quorum) === 0n ? 0 : Math.min(100, Number((total * 10000n) / BigInt(state.quorum)) / 100);
  const canVote = state.state === "VotingOpen" && pending === null;
  const previewMismatch = brief.evaluation.stages
    .find((stage) => stage.stage === "CLAIMS")
    ?.factors.find((factor) => factor.label === "Preview mismatches");
  const previewNote = brief.preview
    ? ` The acknowledgment also covers the pre-vote effect preview: ${previewMismatch?.value ?? "?"} effect(s) outside the stated intent, previewHash ${brief.preview.previewHash.slice(0, 12)}…`
    : ` No effect preview is available for this proposal${brief.previewError ? ` (${brief.previewError})` : ""}, so the acknowledgment covers the evaluation chain only.`;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">One-page risk brief</p>
            <p className="mt-1 text-xs text-slate-500">Advisory findings precede the deterministic execution gate.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HashChip label="briefHash" value={brief.briefHash} />
            <HashChip
              label="previewHash"
              value={brief.preview?.previewHash ?? null}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {brief.evaluation.stages.map((stage) => (
            <article key={stage.stage} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{stage.stage}</span>
                <StatusBadge tone={stageTone(stage.status)}>{stage.status}</StatusBadge>
              </div>
              <p className="mt-3 font-mono text-xl text-slate-100">
                {stage.stage === "EXECUTION" ? (stage.status === "GREEN" ? "MATCH" : "MISMATCH") : formatPct(stage.score)}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{stage.reason}</p>
              <WhyDrawer className="mt-2">
                <div className="space-y-2">
                  {stage.factors.map((factor) => <p key={factor.label}><span className="text-slate-300">{factor.label}: {factor.value}</span><br />{factor.detail}</p>)}
                </div>
              </WhyDrawer>
            </article>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <Stat
            label="COI finding"
            value={`${formatPct(brief.assessment.overallRisk, 1)} ${brief.assessment.riskBand}`}
            tone={brief.assessment.overallRisk >= 0.7 ? "danger" : "info"}
            hint={`${brief.assessment.links.filter((link) => !link.disclosed).length} discovered links`}
            why="Noisy-OR combines disclosed and discovered wallet-link strengths. A high score identifies a potential conflict for review, not proof of wrongdoing."
          />
          <Stat
            label="Treasury impact"
            value={`${formatTokenUnits(brief.treasuryImpact.amount, 6)} ${brief.treasuryImpact.asset}`}
            tone="warning"
            hint={`${brief.treasuryImpact.actionCount} compiled action${brief.treasuryImpact.actionCount === 1 ? "" : "s"}`}
            why="Transfer upper bounds are summed in USDC base units and formatted with 6 decimals. Parameter changes do not add a token-transfer amount."
          />
          <Stat
            label="Unresolved items"
            value={brief.intent.unresolved.length}
            tone={brief.intent.unresolved.length > 0 ? "warning" : "success"}
            hint={brief.intent.unresolved.length > 0 ? "human review required" : "intent fully grounded"}
            why="Unresolved count comes directly from the intent draft. These ambiguities remain visible even though this mock ballot is already open."
          />
        </div>

        <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-amber-300">Claims requiring attention</p>
          {brief.intent.unresolved.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">No unresolved claims in the reviewed intent.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">{brief.intent.unresolved.map((item) => <li key={item.question} className="flex gap-2 text-xs leading-relaxed text-amber-200/80"><ShieldAlert size={12} className="mt-0.5 flex-none" />{item.question}</li>)}</ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-200">Cast a for-vote</p>
            <p className="mt-1 text-xs text-slate-500">Only the brief-aware option increases the informed-vote ratio.</p>
          </div>
          <BookOpenCheck size={20} className="text-cyan-300" />
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={!canVote}
            onClick={() => onVote(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 px-4 py-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending === "brief" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Vote with brief
          </button>
          <button
            type="button"
            disabled={!canVote}
            onClick={() => onVote(false)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending === "without" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Vote without brief
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">{state.state === "VotingOpen" ? "The mock wallet casts 100 governance tokens; the brief hash above is acknowledged only by the first option." : `Voting is ${state.state}; controls are disabled.`}</p>
        {receipt ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-300">{receipt.message}{receipt.hash ? <HashChip label="brief" value={receipt.hash} /> : null}</div> : null}
        {voteError ? <p className="mt-3 text-xs text-red-400">{voteError}</p> : null}
      </section>

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="For" value={formatTokenUnits(state.forVotes)} tone="success" why="Total governance weight currently voting for the committed proposal, denominated in 18-decimal token units." />
          <Stat label="Against" value={formatTokenUnits(state.againstVotes)} tone="danger" why="Total governance weight currently voting against the committed proposal." />
          <Stat label="Abstain" value={formatTokenUnits(state.abstainVotes)} why="Weight recorded as abstain. It participates in the displayed vote total but is neither for nor against." />
          <Stat label="Quorum" value={formatTokenUnits(state.quorum)} tone={state.quorumReached ? "success" : "warning"} hint={state.quorumReached ? "reached" : "not reached"} why={`Current total ${formatTokenUnits(total.toString())} is compared with the required ${formatTokenUnits(state.quorum)} governance weight.`} />
          <Stat label="Informed ratio" value={formatPct(state.informedRatio)} tone="info" why={`Informed for-vote weight divided by all for-vote weight. Abstentions and against votes do not enter this ratio.${previewNote}`} />
          <Stat label="Brief acks" value={state.totalBriefAcks} tone="info" why="Number of vote records carrying a non-null briefHash acknowledgment." />
        </div>

        <VoteBar label="Vote distribution" value={`${formatTokenUnits(total.toString())} votes cast`} why="Each segment is its vote weight divided by total for + against + abstain weight.">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
            <span className="h-full bg-[#22ff88]" style={{ width: `${forShare}%` }} />
            <span className="h-full bg-red-500" style={{ width: `${againstShare}%` }} />
            <span className="h-full bg-slate-600" style={{ width: `${abstainShare}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-slate-500"><span>for {forShare.toFixed(1)}%</span><span>against {againstShare.toFixed(1)}%</span><span>abstain {abstainShare.toFixed(1)}%</span></div>
        </VoteBar>

        <VoteBar label="Informed-vote ratio" value={formatPct(state.informedRatio, 1)} why={`The cyan segment is informed for-vote weight divided by all for-vote weight; the remainder voted for without acknowledging the brief.${previewNote}`}>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800"><span className="block h-full rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" style={{ width: `${state.informedRatio * 100}%` }} /></div>
        </VoteBar>

        <VoteBar label="Quorum progress" value={`${quorumProgress.toFixed(1)}%`} why="Total votes cast divided by required quorum, capped at 100% for display.">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800"><span className="block h-full rounded-full bg-cyan-400" style={{ width: `${quorumProgress}%` }} /></div>
        </VoteBar>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-900/70 text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <tr><th className="px-4 py-2.5">Voter</th><th className="px-4 py-2.5">Support</th><th className="px-4 py-2.5 text-right"><span className="inline-flex items-center gap-2">Weight <WhyDrawer>Governance token weight formatted from 18-decimal base units.</WhyDrawer></span></th><th className="px-4 py-2.5">Brief acknowledged</th></tr>
          </thead>
          <tbody>{state.votes.map((vote) => <VoteRow key={vote.voter} vote={vote} />)}</tbody>
        </table>
        {state.votes.length === 0 ? <p className="p-6 text-center text-xs text-slate-500">No votes have been cast.</p> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <HashChip label="commitment" value={state.commitment} />
        <HashChip label="actions" value={state.actionsHash} />
        <HashChip label="intent" value={state.intentHash} />
        <HashChip label="disclosure" value={state.disclosureHash} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-500">
        <span>voting opens {formatDateTime(state.voteStart)}</span><span>closes {formatDateTime(state.voteEnd)}</span>
        <span className="inline-flex items-center gap-2">snapshot block {state.snapshotBlock.toLocaleString("en-US")}<WhyDrawer>Voting weight is measured at this block so later token transfers cannot change a voter&apos;s weight for this proposal.</WhyDrawer></span>
      </div>
    </div>
  );
}

function VoteBar({ label, value, why, children }: { label: string; value: string; why: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-slate-500"><span>{label}</span><span className="ml-auto font-mono text-slate-400">{value}</span><WhyDrawer>{why}</WhyDrawer></div>
      {children}
    </div>
  );
}

function VoteRow({ vote }: { vote: VoteRecord }) {
  const support = SUPPORT[vote.support] ?? SUPPORT[2];
  return (
    <tr className="border-t border-slate-800/80 transition-colors hover:bg-slate-900/40">
      <td className="px-4 py-2.5"><HashChip value={vote.voter} lead={8} tail={4} /></td>
      <td className="px-4 py-2.5"><StatusBadge tone={support.tone}>{support.label}</StatusBadge></td>
      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-slate-300">{formatTokenUnits(vote.weight)}</td>
      <td className="px-4 py-2.5">{vote.briefHash ? <span className="inline-flex items-center gap-1 text-xs text-[#22ff88]"><Check size={13} /> acknowledged</span> : <span className="inline-flex items-center gap-1 text-xs text-slate-500"><X size={13} /> no brief</span>}</td>
    </tr>
  );
}

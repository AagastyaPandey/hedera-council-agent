"use client";

import { Activity, AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { DATA_MODE } from "@/lib/config";
import { getEvaluationChain } from "@/lib/data";
import { proposalRef } from "@/lib/proposal-naming";
import { useAsync } from "@/lib/useAsync";
import type {
  Provenance,
  SentinelEvent,
  Stage,
  StageName,
  StageStatus,
} from "@/lib/types";
import { StageCard } from "./StageCard";
import { EffectPreviewPanel } from "./EffectPreview";

const STAGE_ORDER: StageName[] = ["CLAIMS", "COI", "VOTING", "EXECUTION"];

export function DecisionTrail({
  proposalId,
  liveEvent,
}: {
  proposalId: string;
  liveEvent?: SentinelEvent | null;
}) {
  const { data, loading, error, reload } = useAsync(
    () => getEvaluationChain(proposalId),
    [proposalId]
  );
  const liveGate =
    liveEvent &&
    liveEvent.proposalId === proposalId &&
    (liveEvent.phase === "HALTED" || liveEvent.phase === "VIOLATION")
      ? liveEvent
      : null;
  const gateStatus: StageStatus = liveGate?.phase === "HALTED" ? "RED" : "AMBER";
  const unavailableReason = loading
    ? "Evaluation is still loading."
    : error
      ? "The evaluation source failed; this stage has no verified datum."
      : "No datum is available for this stage.";

  const stages: Stage[] = STAGE_ORDER.map((stageName) => {
    const base = data?.stages.find((stage) => stage.stage === stageName);
    if (stageName === "EXECUTION" && liveGate) {
      const execution = base ?? {
        stage: "EXECUTION" as const,
        score: null,
        status: gateStatus,
        reason: "",
        factors: [],
        drilldown: "live-sentinel",
      };
      return {
        ...execution,
        status: gateStatus,
        reason: liveGateReason(liveGate),
        factors: [
          {
            label: "Live Sentinel phase",
            value: liveGate.phase,
            detail: "Observed by sentinel/watcher.ts from ProposalQueued.",
          },
          {
            label: "commitment",
            value: liveGate.commitment,
            detail: liveGate.report?.violatedConstraint.message ?? liveGate.detail,
          },
          ...(liveGate.reportHash
            ? [{ label: "reportHash", value: liveGate.reportHash }]
            : []),
          ...(liveGate.haltTxHash
            ? [{ label: "haltTx", value: liveGate.haltTxHash }]
            : []),
          ...execution.factors,
        ],
      };
    }
    return base ?? unavailableStage(stageName, unavailableReason);
  });

  const evaluationUnavailable = !loading && Boolean(error);
  const executionProvenance: Provenance = liveGate
    ? "LIVE"
    : DATA_MODE === "live"
      ? "LIVE"
      : "RECORDED";

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Activity size={14} className="text-cyan-300" />
          Execution is a binary gate. Percentages before it are advisory.
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {proposalRef(proposalId)}
        </span>
      </div>

      {loading ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
          <Loader2 size={13} className="animate-spin text-cyan-300" />
          Evaluating pipeline…
        </div>
      ) : null}

      {evaluationUnavailable ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-[11px] text-red-300">
          <span className="flex min-w-0 items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </span>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1 rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-950/50"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      ) : null}

      {liveGate && !data ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/15 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-300" />
          Advisory stage data is unavailable for this proposal. The Execution gate is
          shown from live Sentinel evidence; missing stages stay unavailable.
        </div>
      ) : null}

      <div className="mt-4">
        <EffectPreviewPanel proposalId={proposalId} compact />
      </div>

      <div className="grid grid-cols-[repeat(4,minmax(220px,1fr))] gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => (
          <StageCard
            key={stage.stage}
            stage={stage}
            provenance={
              stage.stage === "EXECUTION" ? executionProvenance : undefined
            }
            dominated={stage.stage === "EXECUTION" && stage.status === "RED"}
          />
        ))}
      </div>

      {stages.some(
        (stage) => stage.stage === "EXECUTION" && stage.status === "RED"
      ) ? (
        <p className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-red-400/80">
          <span className="status-dot text-red-500" />
          Hard gate tripped — advisory stages cannot override execution.
        </p>
      ) : null}
    </section>
  );
}

function unavailableStage(stage: StageName, reason: string): Stage {
  return {
    stage,
    score: null,
    status: "UNAVAILABLE",
    reason,
    factors: [
      {
        label: "Data source",
        value: "Unavailable",
        detail: reason,
      },
    ],
    drilldown: "unavailable",
  };
}

function liveGateReason(event: SentinelEvent): string {
  const detail = event.report?.violatedConstraint.message ?? event.detail;
  if (event.phase === "HALTED") {
    return `Live Sentinel halt: ${detail} The executor is now Halted; forced execution must revert.`;
  }
  return `Live Sentinel violation detected: ${detail} Guardian halt is being processed.`;
}

"use client";

import { FileSearch, Loader2, Play } from "lucide-react";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn, formatDateTime, formatDuration } from "@/lib/format";
import type {
  ArenaRunResult,
  Provenance,
  ScenarioReport,
} from "@/lib/types";

export interface RunState {
  state: "running" | "done" | "error";
  result?: ArenaRunResult;
  finishedAt?: string;
  error?: string;
}

export function ScenarioCard({
  report,
  run,
  selected,
  onRun,
  onSelect,
}: {
  report: ScenarioReport;
  run?: RunState;
  selected: boolean;
  onRun: (id: number) => void;
  onSelect: (id: number) => void;
}) {
  const running = run?.state === "running";
  const liveRun = run?.state === "done" && run.result ? run : null;
  const errorRun = run?.state === "error" ? run : null;
  const provenance: Provenance = liveRun ? "LIVE" : "RECORDED";
  const propertyAddsInformation = !isRedundantDescription(
    report.scenarioName,
    report.property
  );
  const runLabel = report.scenarioId === 0 ? "Run scenario" : "Run attack";

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border bg-slate-900/60 p-4 transition-all duration-150",
        selected
          ? "border-cyan-900/70 shadow-[0_0_35px_-18px_rgba(34,211,238,0.7)]"
          : "border-slate-800 hover:border-slate-700"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-500">
            S{report.scenarioId}
          </span>
          <ProvenanceTag kind={provenance} />
        </div>
        {running ? (
          <StatusBadge tone="warning" pulse>
            RUNNING
          </StatusBadge>
        ) : errorRun ? (
          <StatusBadge tone="danger">RUN FAILED</StatusBadge>
        ) : liveRun?.result ? (
          <StatusBadge status={liveRun.result.status} pulse />
        ) : (
          <StatusBadge tone="neutral">NOT RUN</StatusBadge>
        )}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-slate-100">
        {report.scenarioName}
      </h3>
      {propertyAddsInformation ? (
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {report.property}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <span>expected</span>
        <span className="text-slate-300">{report.outcome}</span>
      </div>

      {liveRun?.result && liveRun.finishedAt ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-cyan-300">
          <span className="rounded border border-cyan-900/70 bg-cyan-950/30 px-1.5 py-0.5">
            LIVE RUN
          </span>
          <time dateTime={liveRun.finishedAt}>
            {formatDateTime(liveRun.finishedAt)}
          </time>
          <span className="font-mono text-slate-400">
            {formatDuration(liveRun.result.durationMs)}
          </span>
        </div>
      ) : report.recordedAt ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span className="rounded border border-slate-700 bg-slate-950/60 px-1.5 py-0.5">
            LAST RECORDED
          </span>
          <time dateTime={report.recordedAt}>
            {formatDateTime(report.recordedAt)}
          </time>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <button
          type="button"
          onClick={() => onRun(report.scenarioId)}
          disabled={running}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
            running
              ? "border-slate-800 text-slate-500"
              : "border-emerald-900/70 bg-emerald-950/30 text-[#22ff88] hover:bg-emerald-950/50"
          )}
        >
          {running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} />
          )}
          {running ? "Running…" : runLabel}
        </button>
        <button
          type="button"
          onClick={() => onSelect(report.scenarioId)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition-colors duration-150 hover:border-cyan-900/70 hover:text-cyan-200"
        >
          <FileSearch size={13} />
          Report
        </button>
      </div>

      {errorRun ? (
        <div className="mt-3 border-t border-slate-800 pt-2 text-[11px]">
          <p className="break-all font-mono text-[10px] text-red-400">
            {errorRun.error}
          </p>
        </div>
      ) : null}
    </article>
  );
}

function isRedundantDescription(name: string, description: string): boolean {
  const nameKey = comparable(name);
  const descriptionKey = comparable(description);
  if (!nameKey || !descriptionKey) return false;
  if (descriptionKey === nameKey || nameKey.startsWith(descriptionKey)) {
    return true;
  }
  const nameWords = new Set(nameKey.split(" "));
  const descriptionWords = new Set(descriptionKey.split(" "));
  const union = new Set([...nameWords, ...descriptionWords]);
  const shared = [...nameWords].filter((word) => descriptionWords.has(word)).length;
  return union.size > 0 && shared / union.size >= 0.75;
}

function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(rejected|succeeds|flagged|failed)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

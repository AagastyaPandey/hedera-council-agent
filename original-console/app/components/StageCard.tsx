"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { cn, formatPct } from "@/lib/format";
import type { Provenance, Stage } from "@/lib/types";

const META: Record<Stage["stage"], { label: string; hint: string }> = {
  CLAIMS: { label: "Claims", hint: "Intent grounding" },
  COI: { label: "COI", hint: "Wallet links" },
  VOTING: { label: "Voting", hint: "Informed consent" },
  EXECUTION: { label: "Execution", hint: "On-chain gate" },
};

const BAR: Record<Stage["status"], string> = {
  GREEN: "bg-[#22ff88] shadow-[0_0_12px_rgba(34,255,136,0.5)]",
  AMBER: "bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.45)]",
  RED: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]",
  UNAVAILABLE: "bg-slate-700",
};

export function stageTone(status: Stage["status"]): StatusTone {
  return status === "GREEN"
    ? "success"
    : status === "AMBER"
      ? "warning"
      : status === "RED"
        ? "danger"
        : "neutral";
}

export function StageCard({
  stage,
  dominated = false,
  provenance,
}: {
  stage: Stage;
  dominated?: boolean;
  provenance?: Provenance;
}) {
  const [open, setOpen] = useState(false);
  const meta = META[stage.stage];
  const tone = stageTone(stage.status);
  const isExecution = stage.stage === "EXECUTION";
  const unavailable = stage.status === "UNAVAILABLE";
  const verdict =
    stage.status === "GREEN"
      ? "MATCH"
      : stage.status === "RED"
        ? "MISMATCH"
        : stage.status === "AMBER"
          ? "REVIEW"
          : "NO DATA";

  return (
    <article
      className={cn(
        "flex min-h-[200px] flex-col rounded-2xl border bg-slate-900/60 p-4 transition-all duration-150",
        unavailable
          ? "border-slate-800/70 bg-slate-950/35 text-slate-500"
          : dominated
            ? "border-red-900/70 bg-red-950/15 shadow-[0_0_55px_-18px_rgba(239,68,68,0.8)] lg:scale-[1.03]"
            : "border-slate-800 hover:border-slate-700"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {meta.hint}
          </p>
          <h3
            className={cn(
              "mt-0.5 text-sm font-semibold",
              unavailable ? "text-slate-500" : "text-slate-100"
            )}
          >
            {meta.label}
          </h3>
        </div>
        <StatusBadge tone={tone} pulse={stage.status === "RED"}>
          {stage.status}
        </StatusBadge>
      </div>

      {provenance ? (
        <div className="mt-2">
          <ProvenanceTag kind={provenance} />
        </div>
      ) : null}

      <div className="mt-4 flex items-end gap-2">
        {isExecution ? (
          <span
            className={cn(
              "font-mono text-2xl font-semibold tracking-tight tabular-nums",
              stage.status === "GREEN"
                ? "text-[#22ff88]"
                : stage.status === "RED"
                  ? "text-red-400"
                  : unavailable
                    ? "text-slate-500"
                    : "text-amber-300"
            )}
          >
            {verdict}
          </span>
        ) : (
          <>
            <span
              className={cn(
                "font-mono text-3xl font-semibold tracking-tight tabular-nums",
                unavailable ? "text-slate-600" : "text-slate-100"
              )}
            >
              {unavailable ? "—" : formatPct(stage.score)}
            </span>
            <span className="pb-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              {unavailable ? "no data" : "confidence"}
            </span>
          </>
        )}
      </div>

      {!isExecution ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              BAR[stage.status]
            )}
            style={{
              width: unavailable
                ? "0%"
                : `${Math.round((stage.score ?? 0) * 100)}%`,
            }}
          />
        </div>
      ) : dominated ? (
        <div className="hard-gate-stamp mt-2 inline-flex w-max items-center gap-1 rounded border border-red-900 px-2 py-0.5 text-[9px] font-bold uppercase text-red-400">
          Hard Gate
        </div>
      ) : null}

      <p
        className={cn(
          "mt-3 text-xs leading-relaxed",
          unavailable ? "text-slate-500" : "text-slate-400"
        )}
      >
        {stage.reason}
      </p>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "mt-auto flex items-center gap-1 pt-3 text-[11px] font-medium transition-colors duration-150",
          unavailable
            ? "text-slate-500 hover:text-slate-400"
            : "text-cyan-300/90 hover:text-cyan-200"
        )}
      >
        <ChevronDown
          size={13}
          className={cn("transition-transform duration-150", open && "rotate-180")}
        />
        Why
      </button>

      {open ? (
        <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          {stage.factors.length === 0 ? (
            <p className="text-[10px] text-slate-500">No factors recorded.</p>
          ) : (
            stage.factors.map((factor) => (
              <div key={factor.label} className="text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-500">{factor.label}</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {factor.value}
                  </span>
                </div>
                {factor.detail ? (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                    {factor.detail}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </article>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, X } from "lucide-react";
import type { StageScore } from "@/packages/shared/schemas";
import { ScoreRing, StatusPill, cn } from "./ui";

const STAGE_META: Record<
  StageScore["stage"],
  { index: string; name: string; scoreLabel: string; drilldownLabel: string }
> = {
  CLAIMS: { index: "01", name: "Claims", scoreLabel: "confidence", drilldownLabel: "Open claims review" },
  COI: { index: "02", name: "Conflict of interest", scoreLabel: "risk", drilldownLabel: "Open wallet graph" },
  VOTING: { index: "03", name: "Voting", scoreLabel: "legitimacy", drilldownLabel: "Open informed vote" },
  EXECUTION: { index: "04", name: "Execution", scoreLabel: "gate", drilldownLabel: "Open violation report" },
};

export function StagePipeline({ stages }: { stages: StageScore[] }) {
  const [selected, setSelected] = useState<StageScore | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  return (
    <>
      <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const meta = STAGE_META[stage.stage];
          const hardGate = stage.stage === "EXECUTION";
          return (
            <button
              key={stage.stage}
              type="button"
              onClick={() => setSelected(stage)}
              className={cn(
                "group border-t border-edge py-3 text-left transition-colors md:px-4 xl:border-l xl:first:border-l-0 xl:pl-4 xl:first:pl-0",
                hardGate && "border-t-danger",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="doc-folio">{String(index + 1).padStart(2, "0")}</span>
                <StatusPill status={stage.status}>
                  {hardGate
                    ? "gate"
                    : stage.status === "RED"
                      ? "attention"
                      : stage.status === "AMBER"
                        ? "review"
                        : "clear"}
                </StatusPill>
              </div>

              <div className="mt-2 text-[14px] font-medium text-body">{meta.name}</div>

              <div className="mt-4">
                <ScoreRing
                  score={stage.score}
                  status={stage.status}
                  label={meta.scoreLabel}
                  hardGate={hardGate}
                />
              </div>

              <p className="mt-3 line-clamp-3 text-[11.5px] leading-snug text-dim">
                {stage.reason}
              </p>

              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-edge/60 pt-2">
                <span className="doc-note">
                  {stage.factors.length} factors
                </span>
                <span className="font-sans text-[10.5px] text-dim underline decoration-danger/40 underline-offset-2 group-hover:text-danger">
                  open notes
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-[90] flex justify-end bg-black/65 backdrop-blur-sm"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${STAGE_META[selected.stage].name} drilldown`}
            onClick={(event) => event.stopPropagation()}
            className="h-full w-full max-w-md overflow-y-auto border-l border-edge bg-panel p-5 shadow-2xl fade-up"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mono-label mb-1">
                  {STAGE_META[selected.stage].index} · stage drilldown
                </div>
                <h2 className="text-[20px] font-medium tracking-[-0.01em] text-body">
                  {STAGE_META[selected.stage].name}
                </h2>
                <div className="mt-2 flex items-center gap-2">
                  <StatusPill status={selected.status} />
                  {selected.stage === "EXECUTION" ? (
                    <span className="chip border-danger/30 text-danger">
                      <Lock size={10} /> hard gate
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-steel">
                      {selected.score === null ? "—" : selected.score.toFixed(3)}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close drilldown"
                className="rounded border border-edge p-1.5 text-dim hover:border-edge2 hover:text-body"
              >
                <X size={14} />
              </button>
            </div>

            <p className="mt-4 border-l border-edge2 pl-3 text-[12.5px] leading-relaxed text-dim">
              {selected.reason}
            </p>

            <div className="mt-5">
              <div className="mono-label mb-2">Factors</div>
              <div className="divide-y divide-edge/70">
                {selected.factors.map((factor, index) => (
                  <div key={`${factor.label}-${index}`} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-medium text-body">{factor.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-steel">{factor.value}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                      {factor.weight ? <span className="chip">{factor.weight}</span> : null}
                      {factor.detail ? <span className="leading-snug">{factor.detail}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selected.stage === "EXECUTION" ? (
              <div className="mt-5 border-l-2 border-danger pl-3 text-[11px] leading-relaxed text-dim">
                A failing execution gate cannot be offset by a good score elsewhere. The transaction
                is rejected by deterministic code, not by an average.
              </div>
            ) : null}

            <Link
              href={selected.drilldown}
              className="btn btn-primary mt-6 w-full"
              onClick={() => setSelected(null)}
            >
              {STAGE_META[selected.stage].drilldownLabel}
            </Link>
          </aside>
        </div>
      ) : null}
    </>
  );
}

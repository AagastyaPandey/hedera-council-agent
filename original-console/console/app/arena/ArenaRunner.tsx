"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Play, X } from "lucide-react";
import { getDemo, type ScenarioRow } from "@/lib/demo";
import type { RunStepStatus, ScenarioLayer } from "@/reference/types";
import {
  LayerBadge,
  Panel,
  StatusPill,
  cn,
  statusTextClass,
  statusTone,
} from "@/components/ui";

const STEP_INTERVAL_MS = 120;

const LAYERS: { key: ScenarioLayer; description: string }[] = [
  {
    key: "executor",
    description: "Calldata attacks checked against the committed rules.",
  },
  {
    key: "sentinel",
    description: "Simulation flags what the executor must never run.",
  },
  {
    key: "disclosure",
    description: "The wallet graph and challenge, outside the calldata.",
  },
];

const STEP_TEXT: Record<RunStepStatus, string> = {
  PASS: "text-safe",
  FAIL: "text-danger",
  FLAG: "text-signal",
  INFO: "text-info",
};

const STEP_MARK: Record<RunStepStatus, string> = {
  PASS: "✓",
  FAIL: "✕",
  FLAG: "!",
  INFO: "·",
};

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

function verdictChipClass(status: "PASSED" | "REJECTED" | "FLAGGED"): string {
  const tone = statusTone(status);
  if (tone === "safe") return "border-safe/30 text-safe";
  if (tone === "warn") return "border-signal/30 text-signal";
  return "border-danger/30 text-danger";
}

function StepGlyph({ status }: { status: RunStepStatus }) {
  return (
    <span
      className={cn(
        "mt-0.5 w-3 shrink-0 text-center font-sans text-[10px]",
        STEP_TEXT[status],
      )}
      aria-hidden="true"
    >
      {STEP_MARK[status]}
    </span>
  );
}

function VerdictBlock({ row }: { row: ScenarioRow }) {
  const run = row.run;
  const tone = statusTone(run.status);
  return (
    <div
      className={cn(
        "mt-3 border-l-2 pl-3",
        tone === "safe"
          ? "border-safe"
          : tone === "warn"
            ? "border-signal"
            : "border-danger",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={run.status} />
        <span className="chip">{run.code}</span>
        <span className={cn("chip", verdictChipClass(run.status))}>{run.layer} layer</span>
      </div>
      <div className="mt-1 text-[11.5px] font-medium leading-snug text-body">{run.label}</div>
      <p className="mt-1 text-[10px] leading-relaxed text-dim">{run.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "chip",
            run.commitmentMatched
              ? "border-safe/30 text-safe"
              : "border-danger/30 text-danger",
          )}
        >
          {run.commitmentMatched ? <Check size={9} /> : <X size={9} />}
          bundle commitment {run.commitmentMatched ? "matched" : "differs"}
        </span>
        <span className="chip">{run.steps.length} gates</span>
        <span className="chip">
          {run.submitted.length} submitted, {run.approved.length} committed
        </span>
      </div>
    </div>
  );
}

export function ArenaRunner() {
  const demo = getDemo();
  const rows = demo.scenarioRows;
  const initialRow = demo.mainRun.scenario.id;
  const [activeId, setActiveId] = useState(initialRow);
  const [revealed, setRevealed] = useState(() => demo.mainRun.steps.length);
  const [running, setRunning] = useState(false);
  const [runToken, setRunToken] = useState(0);

  const activeRow = rows.find((row) => row.scenario.id === activeId) ?? rows[0];
  const activeStepCount = activeRow.run.steps.length;
  const matched = rows.filter((row) => row.matchesExpected).length;

  useEffect(() => {
    if (!running || revealed >= activeStepCount) return;
    const next = revealed + 1;
    const timer = window.setTimeout(() => {
      setRevealed(next);
      if (next >= activeStepCount) setRunning(false);
    }, STEP_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [running, revealed, activeStepCount, runToken]);

  function selectRow(row: ScenarioRow) {
    setActiveId(row.scenario.id);
    setRevealed(row.run.steps.length);
    setRunning(false);
  }

  function startRun(id: string) {
    setActiveId(id);
    setRevealed(0);
    setRunning(true);
    setRunToken((value) => value + 1);
  }

  const revealedSteps = activeRow.run.steps.slice(0, revealed);
  const showVerdict = revealed >= activeStepCount;
  const progress = activeStepCount === 0 ? 0 : (revealed / activeStepCount) * 100;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.42fr)_minmax(0,0.82fr)]">
      <Panel id="scenarios" className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-[12.5px] font-medium text-body">Scenario ledger</span>
              <span className="doc-folio">{rows.length} rows</span>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
              Expected comes from each scenario fixture. Actual is the reference
              executor output, printed next to it, never substituted for it.
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="doc-folio">
              {matched}/{rows.length} expected equals actual
            </span>
            <span className="doc-folio">
              {demo.arenaSummary.mismatches} mismatches
            </span>
          </div>
        </div>

        {LAYERS.map((layer) => {
          const layerRows = rows.filter((row) => row.scenario.layer === layer.key);
          if (layerRows.length === 0) return null;
          return (
            <section key={layer.key} aria-label={`${layer.key} scenarios`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <LayerBadge layer={layer.key} />
                  <span className="hidden text-[10px] leading-relaxed text-faint sm:inline">
                    {layer.description}
                  </span>
                </div>
                <span className="doc-folio">
                  {layerRows.length} scenario{layerRows.length === 1 ? "" : "s"}
                </span>
              </div>

              <ul className="divide-y divide-edge/60">
                {layerRows.map((row) => {
                  const { scenario, run } = row;
                  const active = scenario.id === activeId;
                  const isRunningHere = active && running;
                  return (
                    <li
                      key={scenario.id}
                      className="flex items-stretch gap-1"
                    >
                      <button
                        type="button"
                        onClick={() => selectRow(row)}
                        aria-pressed={active}
                        className={cn(
                          "flex min-w-0 flex-1 items-start gap-3 border-l-2 px-2 py-2 text-left transition-colors",
                          active
                            ? "border-danger"
                            : "border-transparent hover:border-edge2",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 w-6 shrink-0 font-mono text-[10px]",
                            active ? "text-danger" : "text-faint",
                          )}
                        >
                          {pad(scenario.index)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] font-medium leading-snug text-body">
                              {scenario.title}
                            </span>
                            <LayerBadge layer={scenario.layer} />
                          </span>
                          <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">
                            {scenario.subtitle}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[8.5px] text-faint">{scenario.id}</span>
                            <span
                              className={cn(
                                "chip",
                                verdictChipClass(scenario.expected.status),
                              )}
                            >
                              expected {scenario.expected.status}, {scenario.expected.code}
                            </span>
                            <span className={cn("chip", verdictChipClass(run.status))}>
                              actual {run.status}, {run.code}
                            </span>
                            <span
                              className={cn(
                                "chip",
                                row.matchesExpected
                                  ? "border-safe/30 text-safe"
                                  : "border-danger/30 text-danger",
                              )}
                            >
                              {row.matchesExpected ? <Check size={9} /> : <X size={9} />}
                              {row.matchesExpected ? "match" : "mismatch"}
                            </span>
                          </span>
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center px-1">
                        <button
                          type="button"
                          onClick={() => startRun(scenario.id)}
                          disabled={isRunningHere}
                          aria-busy={isRunningHere}
                          aria-label={`Run scenario ${pad(scenario.index)}: ${scenario.title}`}
                          className={cn(
                            "btn btn-sm",
                            active && !isRunningHere && "border-signal/45 text-signal",
                          )}
                        >
                          {isRunningHere ? (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
                          ) : (
                            <Play size={10} />
                          )}
                          {isRunningHere ? "Running" : "Run"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <div className="border-t border-edge px-4 py-2.5">
          <p className="text-[9.5px] leading-relaxed text-faint">
            Clicking Run only paces the display at {STEP_INTERVAL_MS} ms per step. Every verdict is
            precomputed by the TypeScript reference executor; the browser computes nothing and no
            network request is made.
          </p>
        </div>
      </Panel>

      <aside className="self-start space-y-4 xl:sticky xl:top-[86px]" aria-label="Selected scenario">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <span className="mono-label">Selected, {pad(activeRow.scenario.index)}</span>
            <div className="flex items-center gap-1.5">
              <span className="chip">{activeRow.scenario.mode}</span>
              <StatusPill status={activeRow.run.status} />
            </div>
          </div>

          <div className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <LayerBadge layer={activeRow.scenario.layer} />
              <span className="chip">{activeRow.scenario.id}</span>
            </div>
            <h2 className="mt-2 text-[15px] font-medium leading-snug text-body">
              {activeRow.scenario.title}
            </h2>
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
              {activeRow.scenario.subtitle}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="panel-quiet p-2.5">
                <div className="mono-label text-[8.5px]">Expected</div>
                <div
                  className={cn(
                    "mt-1 font-mono text-[10px]",
                    statusTextClass(activeRow.scenario.expected.status),
                  )}
                >
                  {activeRow.scenario.expected.status}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[8.5px] text-faint"
                  title={activeRow.scenario.expected.code}
                >
                  {activeRow.scenario.expected.code}
                </div>
              </div>
              <div className="panel-quiet p-2.5">
                <div className="mono-label text-[8.5px]">Actual</div>
                <div
                  className={cn("mt-1 font-mono text-[10px]", statusTextClass(activeRow.run.status))}
                >
                  {activeRow.run.status}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[8.5px] text-faint"
                  title={activeRow.run.code}
                >
                  {activeRow.run.code}
                </div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.06em]",
                  activeRow.matchesExpected ? "text-safe" : "text-danger",
                )}
              >
                {activeRow.matchesExpected ? <Check size={10} /> : <X size={10} />}
                expected {activeRow.matchesExpected ? "==" : "!="} actual
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.06em]",
                  activeRow.run.commitmentMatched ? "text-safe" : "text-signal",
                )}
              >
                bundle commitment {activeRow.run.commitmentMatched ? "matched" : "differs"}
              </span>
            </div>

            <div className="mt-4 border-t border-edge/70 pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="mono-label">Reference trace</span>
                <span
                  className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint"
                  aria-live="polite"
                >
                  {revealed}/{activeStepCount} steps
                </span>
              </div>
              <div className="mt-1.5 h-px bg-edge">
                <div
                  className="h-px bg-body transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <ol className="mt-2.5 max-h-64 space-y-2 overflow-auto pr-1">
                {revealedSteps.map((step) => (
                  <li
                    key={`${activeRow.scenario.id}-${step.id}`}
                    className="fade-up flex items-start gap-2"
                  >
                    <StepGlyph status={step.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10.5px] font-medium leading-snug text-body">
                          {step.label}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[8px] uppercase tracking-[0.08em]",
                            STEP_TEXT[step.status],
                          )}
                        >
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[9.5px] leading-relaxed text-faint">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {revealed === 0 ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-signal">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
                  Replaying from the first gate.
                </p>
              ) : null}
            </div>

            {showVerdict ? (
              <VerdictBlock row={activeRow} />
            ) : (
              <div className="mt-3 border-l-2 border-signal pl-3">
                <div className="flex items-center gap-2 text-[10.5px] text-signal">
                  Awaiting verdict. {activeStepCount - revealed} step
                  {activeStepCount - revealed === 1 ? "" : "s"} left.
                </div>
              </div>
            )}

            <Link href={`/arena/${activeRow.scenario.id}`} className="btn btn-sm mt-3 w-full">
              Full violation report
            </Link>
            <p className="mt-2 text-[9px] leading-relaxed text-faint">
              Selected report is precomputed. The Run animation is presentational only.
            </p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

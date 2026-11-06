"use client";

import { useEffect, useRef } from "react";
import { Radio, ShieldCheck } from "lucide-react";
import { ActionTree } from "@/components/ActionTree";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import {
  findExplanationForViolation,
  getReport,
} from "@/lib/data";
import { normalizeLegacyAttackText } from "@/lib/proposal-naming";
import { useAsync } from "@/lib/useAsync";
import type {
  DecodedAction,
  ScenarioOutcome,
  ViolationReport,
} from "@/lib/types";

export function ViolationExplainer({
  scenarioId,
  liveReport,
  liveTitle,
  autoOpen = false,
}: {
  scenarioId: number;
  liveReport?: ViolationReport | null;
  liveTitle?: string;
  autoOpen?: boolean;
}) {
  if (liveReport) {
    return (
      <LiveExplainer
        report={liveReport}
        title={liveTitle ?? "Live Sentinel observation"}
        autoOpen={autoOpen}
      />
    );
  }
  return <ScenarioViolationExplainer scenarioId={scenarioId} />;
}

function ScenarioViolationExplainer({ scenarioId }: { scenarioId: number }) {
  const { data, loading, error, reload } = useAsync(
    () => getReport(scenarioId),
    [scenarioId]
  );

  return (
    <DataState
      loading={loading}
      error={error}
      empty={!loading && !error && !data}
      emptyMessage="No report for this scenario."
      loadingLabel="Decoding calldata"
      onRetry={reload}
    >
      {data ? (
        <Explainer
          report={data.violationReport}
          outcome={data.outcome}
          scenarioName={data.scenarioName}
          property={data.property}
          scenarioId={data.scenarioId}
        />
      ) : null}
    </DataState>
  );
}

function LiveExplainer({
  report,
  title,
  autoOpen,
}: {
  report: ViolationReport;
  title: string;
  autoOpen: boolean;
}) {
  const outcome: ScenarioOutcome =
    report.status === "PASSED"
      ? "Success"
      : report.layer === "executor"
        ? "Executor Revert"
        : "Sentinel Halt";

  return (
    <Explainer
      report={report}
      outcome={outcome}
      scenarioName={title}
      property="Live queue-time simulation and guardian halt"
      scenarioId={report.scenarioId}
      autoOpened={autoOpen}
    />
  );
}

function Explainer({
  report,
  outcome,
  scenarioName,
  property,
  scenarioId,
  autoOpened = false,
}: {
  report: ViolationReport;
  outcome: ScenarioOutcome;
  scenarioName: string;
  property: string;
  scenarioId: number | string;
  autoOpened?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const violation = report;
  const explanation = findExplanationForViolation(report);
  const isViolation = report.status !== "PASSED";

  useEffect(() => {
    if (!autoOpened) return;
    const timer = setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(timer);
  }, [autoOpened, report.evidence.commitment]);

  const layer: { tone: StatusTone; label: string } =
    violation.layer === "executor"
      ? { tone: "danger", label: "Rejected by executor" }
      : isViolation
        ? { tone: "warning", label: "Simulation detected" }
        : { tone: "success", label: "Executed on-chain" };

  return (
    <div ref={containerRef}>
      <Panel
        danger={isViolation}
        title={
          <span className="flex items-center gap-2">
            Violation Explainer
            <StatusBadge tone="neutral">{`scenario ${scenarioId}`}</StatusBadge>
          </span>
        }
        subtitle={`${scenarioName} · ${property}`}
        actions={
          <StatusBadge tone={layer.tone} pulse={isViolation}>
            {layer.label}
          </StatusBadge>
        }
      >
        {autoOpened ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-3 py-2 text-[11px] text-cyan-200/85">
            <Radio size={14} className="text-cyan-300" />
            Opened automatically by the Live Sentinel halt event.
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            What the proposal said
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">
            “{normalizeLegacyAttackText(violation.proposalSaid)}”
          </p>

          <div className="mt-4 border-t border-slate-800 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Approved rule
            </p>
            {violation.approved.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {violation.approved.map((action, index) => (
                  <ApprovedRule key={`${action.function}-${index}`} action={action} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No approved intent rules.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              What the calldata actually does
            </p>
            <StatusBadge status={outcome} />
          </div>
          <div className="mt-3">
            <ActionTree
              actions={violation.submitted}
              constraintCode={violation.violatedConstraint.code}
              outcome={outcome}
            />
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Violated constraint
          </p>
          {isViolation ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-red-300">
                  {violation.violatedConstraint.code}
                </span>
                <StatusBadge tone="danger">{violation.status}</StatusBadge>
                <span className="font-mono text-[10px] text-slate-500">
                  {explanation.layer === "sentinel"
                    ? "Sentinel finding"
                    : explanation.contract}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-200">
                {explanation.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {explanation.explanation}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[#22ff88]">
              No violation detected. The executor matched the committed intent.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Evidence
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <HashChip label="commitment" value={violation.evidence.commitment} />
            <HashChip label="calldata" value={violation.evidence.calldataHash} />
            <HashChip label="revert" value={violation.evidence.revertData} />
            {/* Simulation tx hashes come from the fork sandbox, so they are
                deliberately not linked to the live explorer. */}
            <HashChip label="tx" value={violation.evidence.txHash} />
          </div>
        </section>
      </div>
      </Panel>
    </div>
  );
}

function ApprovedRule({ action }: { action: DecodedAction }) {
  const unresolved = action.function.startsWith("UNKNOWN FUNCTION");
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck
          size={13}
          className={unresolved ? "text-amber-400" : "text-[#22ff88]"}
        />
        <span className="text-xs text-slate-300">{action.humanText}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-slate-500">
          {action.targetLabel}
        </span>
        {action.args.selector ? (
          <span className="font-mono text-[10px] text-slate-500">
            {action.args.selector}
          </span>
        ) : null}
        {unresolved ? (
          <StatusBadge tone="warning">UNRESOLVED SELECTOR</StatusBadge>
        ) : null}
      </div>
    </li>
  );
}

"use client";

import { useState } from "react";
import { Swords } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getAllReports, getScorecard, runScenario } from "@/lib/data";
import { useAsync } from "@/lib/useAsync";
import type { ScorecardEntry } from "@/lib/types";
import { ScorecardView } from "./Scorecard";
import { ScenarioCard, type RunState } from "./ScenarioCard";
import { ViolationExplainer } from "./ViolationExplainer";

export function ArenaControl() {
  const reportsAsync = useAsync(() => getAllReports(), []);
  const scorecardAsync = useAsync(() => getScorecard(), []);
  const [runs, setRuns] = useState<Record<number, RunState>>({});
  const [liveScorecard, setLiveScorecard] = useState<ScorecardEntry[] | null>(
    null
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const reports = reportsAsync.data ?? [];
  const completed = Object.values(runs).filter(
    (run) => run.state === "done" && run.result
  );
  const passed = completed.filter((run) => run.result?.passed).length;

  async function handleRun(id: number) {
    setRuns((prev) => ({ ...prev, [id]: { state: "running" } }));
    try {
      const result = await runScenario(id);
      setRuns((prev) => ({
        ...prev,
        [id]: {
          state: "done",
          result,
          finishedAt: new Date().toISOString(),
        },
      }));
      setSelected(id);

      try {
        const fresh = await getScorecard();
        setLiveScorecard(fresh);
        setRefreshError(null);
      } catch (error) {
        setRefreshError(messageOf(error));
      }
    } catch (error) {
      setRuns((prev) => ({
        ...prev,
        [id]: { state: "error", error: messageOf(error) },
      }));
    }
  }

  const scorecardEntries = liveScorecard ?? scorecardAsync.data ?? [];
  const scorecardLoading = !liveScorecard && scorecardAsync.loading;
  const scorecardError = refreshError ?? scorecardAsync.error;

  return (
    <div className="space-y-6">
      <Panel
        title="Red-Team Arena"
        subtitle="Each run executes the scenario end-to-end; the scorecard updates from the result."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone="info">
              <Swords size={12} /> {reports.length} scenarios
            </StatusBadge>
          </div>
        }
      >
        <DataState
          loading={reportsAsync.loading}
          error={reportsAsync.error}
          empty={!reportsAsync.loading && !reportsAsync.error && reports.length === 0}
          emptyMessage="No scenarios available."
          loadingLabel="Loading scenarios"
          onRetry={reportsAsync.reload}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <ScenarioCard
                key={report.scenarioId}
                report={report}
                run={runs[report.scenarioId]}
                selected={selected === report.scenarioId}
                onRun={handleRun}
                onSelect={setSelected}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
            <span>
              Completed this session:{" "}
              <span className="font-mono tabular-nums text-slate-300">
                {completed.length}
              </span>
            </span>
            <span>
              Passed:{" "}
              <span className="font-mono tabular-nums text-[#22ff88]">
                {passed}
              </span>
            </span>
            <span className="text-slate-600">
              Mock runs are deterministic and update the in-session scorecard.
            </span>
          </div>
        </DataState>
      </Panel>

      {selected !== null ? (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Selected scenario report
          </h2>
          <ViolationExplainer scenarioId={selected} />
        </section>
      ) : (
        <p className="text-xs text-slate-500">
          Run a scenario or choose Report to inspect its decoded evidence here.
        </p>
      )}

      <ScorecardView
        entries={scorecardEntries}
        loading={scorecardLoading}
        error={scorecardError}
        onRetry={scorecardAsync.reload}
      />
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

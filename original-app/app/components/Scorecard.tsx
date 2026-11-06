"use client";

import { ClipboardCheck, Clock3 } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { Panel } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getScorecard } from "@/lib/data";
import { formatDuration, truncateMiddle } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { ScorecardEntry } from "@/lib/types";

export function Scorecard() {
  const { data, loading, error, reload } = useAsync(() => getScorecard(), []);
  return (
    <ScorecardView
      entries={data ?? []}
      loading={loading}
      error={error}
      onRetry={reload}
    />
  );
}

export function ScorecardView({
  entries,
  loading = false,
  error = null,
  onRetry,
}: {
  entries: ScorecardEntry[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const passed = entries.filter((entry) => entry.status === "PASS").length;
  const failed = entries.filter((entry) => entry.status === "FAIL").length;
  const required = entries.filter(
    (entry) => entry.status === "TEST_REQUIRED"
  ).length;

  return (
    <Panel
      title="Security Scorecard"
      subtitle="Emitted by the Red-Team runner. TEST_REQUIRED is amber, never green."
      actions={
        <StatusBadge tone="info">
          <ClipboardCheck size={12} /> {entries.length} properties
        </StatusBadge>
      }
    >
      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && entries.length === 0}
        emptyMessage="No scorecard entries."
        loadingLabel="Loading scorecard"
        onRetry={onRetry}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Properties" value={entries.length} />
          <Stat label="Passed" value={passed} tone="success" />
          <Stat
            label="Failed"
            value={failed}
            tone={failed > 0 ? "danger" : "neutral"}
          />
          <Stat
            label="Test required"
            value={required}
            tone={required > 0 ? "warning" : "neutral"}
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-900/70 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">ID</th>
                <th className="px-4 py-2.5 font-semibold">Property</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Test file</th>
                <th className="px-4 py-2.5 text-right font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-slate-800/80 transition-colors duration-150 hover:bg-slate-900/40"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                    {entry.id}
                  </td>
                  <td className="px-4 py-2.5 text-slate-200">
                    {entry.property}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td
                    className="px-4 py-2.5 font-mono text-[11px] text-slate-500"
                    title={entry.testFile}
                  >
                    {truncateMiddle(entry.testFile, 22, 14)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] tabular-nums text-slate-400">
                    <Clock3
                      size={11}
                      className="mr-1 inline text-slate-600"
                    />
                    {formatDuration(entry.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
    </Panel>
  );
}

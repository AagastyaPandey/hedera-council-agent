"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import { DATA_MODE } from "@/lib/config";
import { getEffectPreview } from "@/lib/data";
import { cn } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { EffectEntry, EffectSeverity, EffectPreview } from "@/lib/types";

const SEVERITY: Record<EffectSeverity, { tone: StatusTone; label: string }> = {
  EXPECTED: { tone: "success", label: "EXPECTED" },
  UNEXPECTED: { tone: "warning", label: "UNEXPECTED" },
  CRITICAL: { tone: "danger", label: "CRITICAL" },
};

const KIND_LABEL: Record<string, string> = {
  TOKEN_BALANCE: "Token balance",
  ETH_BALANCE: "ETH balance",
  ALLOWANCE: "Allowance",
  OWNERSHIP: "Ownership",
  IMPLEMENTATION: "Implementation",
  ADMIN: "Owner / admin",
  CODEHASH: "Code hash",
  STORAGE: "Storage slot",
  CALL_TRACE: "Execution trace",
};

export function EffectPreviewPanel({
  proposalId,
  compact = false,
}: {
  proposalId: string;
  compact?: boolean;
}) {
  const { data, loading, error, reload } = useAsync(
    () => getEffectPreview(proposalId),
    [proposalId]
  );
  const provenance = DATA_MODE === "live" ? "LIVE" : "RECORDED";

  if (compact) {
    return (
      <CompactPreview
        preview={data}
        loading={loading}
        error={error}
        provenance={provenance}
        onRetry={reload}
      />
    );
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Play size={16} className="text-cyan-300" />
          If this passes
        </span>
      }
      subtitle="Simulation of the exact committed calldata. Early warning for voters; the executor remains the on-chain guarantee."
      danger={Boolean(data && data.statedVsSimulated.mismatchCount > 0)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <>
              <StatusBadge tone="neutral">{data.network}</StatusBadge>
              <StatusBadge tone="neutral">
                block {data.blockNumber.toLocaleString("en-US")}
              </StatusBadge>
            </>
          ) : null}
          <ProvenanceTag
            kind={provenance}
            detail={
              provenance === "LIVE"
                ? "Simulated just now against the running chain, in a reverted snapshot."
                : "Recorded from a completed preview run (packages/shared/fixtures/previews.json)."
            }
          />
        </div>
      }
    >
      {loading && !data ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin text-cyan-300" />
          Simulating the committed calldata in a sandbox snapshot…
        </div>
      ) : error && !data ? (
        <UnavailableState error={error} onRetry={reload} />
      ) : data ? (
        <PreviewBody preview={data} />
      ) : null}
    </Panel>
  );
}

function UnavailableState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-900/60 bg-amber-950/15 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
        <AlertTriangle size={16} />
        No effect preview is available
      </div>
      <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-amber-300/80">
        {error}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-amber-900/70 px-2 py-1 text-[11px] text-amber-200 transition-colors hover:bg-amber-950/40"
      >
        Retry
      </button>
    </div>
  );
}

function PreviewBody({ preview }: { preview: EffectPreview }) {
  const [showUnobserved, setShowUnobserved] = useState(false);
  const mismatches = preview.statedVsSimulated.mismatchCount;
  const maxAbsDelta = preview.effects.reduce((max, effect) => {
    const value = Math.abs(Number(effect.delta ?? 0));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return (
    <div className="space-y-5">
      <VerdictBanner
        status={preview.status}
        mismatches={mismatches}
        effectCount={preview.effects.length}
        reason={preview.reason}
      />

      {preview.status === "FAILED_SIMULATION" && preview.revert ? (
        <section className="rounded-xl border border-red-900/70 bg-red-950/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert size={15} className="text-red-400" />
            <p className="text-sm font-semibold text-red-200">
              The committed calldata reverts in the sandbox
            </p>
            <StatusBadge tone="danger">{preview.revert.code}</StatusBadge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            {preview.revert.title} — {preview.revert.explanation}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <HashChip label="revert" value={preview.revert.revertData} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Effects below cover only the actions that executed before the revert.
          </p>
        </section>
      ) : null}

      {preview.effects.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-5 text-sm text-slate-400">
          No watched value changes: the simulation left every observed balance,
          allowance, owner, slot and code hash untouched.
        </p>
      ) : (
        <EffectsTable preview={preview} maxAbsDelta={maxAbsDelta} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            What the proposal says
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">
            {preview.statedVsSimulated.statedSummary || "No committed rules were recorded."}
          </p>
          {preview.statedVsSimulated.mismatches.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              {preview.statedVsSimulated.mismatches.map((line) => (
                <li
                  key={line}
                  className="flex gap-2 text-[11px] leading-relaxed text-red-300/90"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-400" />
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            What the simulation shows
          </p>
          {preview.actions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No committed actions were decoded.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {preview.actions.map((action, index) => (
                <li
                  key={`${action.target}-${index}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
                >
                  <p className="break-words font-mono text-[11px] leading-relaxed text-cyan-300">
                    {action.humanText}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {action.targetLabel} · {action.function}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {preview.traceFindings.length > 0 ? (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Trace findings
              </p>
              <ul className="mt-2 space-y-1.5">
                {preview.traceFindings.map((finding) => (
                  <li key={finding} className="text-[11px] leading-relaxed text-slate-400">
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-950/40">
        <button
          type="button"
          onClick={() => setShowUnobserved((current) => !current)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          {showUnobserved ? (
            <ChevronDown size={14} className="text-slate-400" />
          ) : (
            <ChevronRight size={14} className="text-slate-400" />
          )}
          <EyeOff size={14} className="text-amber-300" />
          <span className="text-xs font-medium text-slate-200">
            What we could not observe ({preview.unobserved.length})
          </span>
          <span className="ml-auto text-[10px] text-slate-500">
            reads that failed or could not be interpreted
          </span>
        </button>
        {showUnobserved ? (
          preview.unobserved.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-slate-500">
              Every watched read succeeded: <Eye size={12} className="inline" /> balances,
              allowances, owner/admin, the three EIP-1967 slots and extcodehash were all observed.
            </p>
          ) : (
            <ul className="space-y-1.5 px-4 pb-4">
              {preview.unobserved.map((item) => (
                <li key={item} className="text-[11px] leading-relaxed text-amber-200/80">
                  {item}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <HashChip label="previewHash" value={preview.previewHash} />
        {preview.status === "UNAVAILABLE" ? (
          <StatusBadge tone="warning">UNAVAILABLE</StatusBadge>
        ) : (
          <StatusBadge tone={preview.status === "OK" ? "info" : "danger"}>
            {preview.status}
          </StatusBadge>
        )}
        <span className="text-[10px] text-slate-500">
          simulated {new Date(preview.simulatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
        </span>
      </div>
    </div>
  );
}

function VerdictBanner({
  status,
  mismatches,
  effectCount,
  reason,
}: {
  status: EffectPreview["status"];
  mismatches: number;
  effectCount: number;
  reason?: string;
}) {
  if (status === "UNAVAILABLE") {
    return (
      <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle size={16} className="text-amber-300" />
          <span className="text-sm font-semibold text-amber-200">
            Preview unavailable — no verdict
          </span>
          <StatusBadge tone="warning">UNAVAILABLE</StatusBadge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
          {reason ?? "The committed calldata could not be simulated."}
        </p>
      </div>
    );
  }

  if (mismatches > 0) {
    return (
      <div className="rounded-xl border border-red-800/80 bg-red-950/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert size={16} className="text-red-400" />
          <span className="text-sm font-semibold text-red-200">
            {mismatches} effect{mismatches === 1 ? "" : "s"} outside the stated intent
          </span>
          <StatusBadge tone="danger">MISMATCH</StatusBadge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-red-200/80">
          {effectCount} watched change{effectCount === 1 ? "" : "s"} were simulated. The
          executor would still refuse anything outside the commitment; this warning exists
          so nobody votes for a description that does not match the calldata.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-800/70 bg-emerald-950/25 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={16} className="text-[#22ff88]" />
        <span className="text-sm font-semibold text-emerald-200">
          Matches the stated intent
        </span>
        <StatusBadge tone="success">NO MISMATCH</StatusBadge>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-emerald-200/70">
        {effectCount} watched change{effectCount === 1 ? "" : "s"} were simulated and every
        one of them is covered by a committed rule.
      </p>
    </div>
  );
}

function EffectsTable({
  preview,
  maxAbsDelta,
}: {
  preview: EffectPreview;
  maxAbsDelta: number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-900/70 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="px-3 py-2.5">Effect</th>
            <th className="px-3 py-2.5">Subject</th>
            <th className="px-3 py-2.5">Before → after</th>
            <th className="px-3 py-2.5">Delta</th>
            <th className="px-3 py-2.5">Severity</th>
            <th className="px-3 py-2.5">Why</th>
          </tr>
        </thead>
        <tbody>
          {preview.effects.map((effect, index) => (
            <EffectRow
              key={`${effect.kind}-${effect.subject}-${index}`}
              effect={effect}
              maxAbsDelta={maxAbsDelta}
              rulesRendered={preview.statedVsSimulated.statedSummary}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EffectRow({
  effect,
  maxAbsDelta,
  rulesRendered,
}: {
  effect: EffectEntry;
  maxAbsDelta: number;
  rulesRendered: string;
}) {
  const meta = SEVERITY[effect.severity];
  const width =
    effect.delta !== null && maxAbsDelta > 0
      ? Math.max(4, Math.round((Math.abs(Number(effect.delta)) / maxAbsDelta) * 100))
      : 0;

  return (
    <tr
      className={cn(
        "border-t border-slate-800/80 transition-colors hover:bg-slate-900/40",
        effect.severity === "CRITICAL" && "bg-red-950/10"
      )}
    >
      <td className="px-3 py-2.5 text-[11px] text-slate-400">
        {KIND_LABEL[effect.kind] ?? effect.kind}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-200">{effect.label}</td>
      <td className="px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
        <span className="break-all">{shorten(effect.before)}</span>
        <span className="px-1 text-slate-600">→</span>
        <span className="break-all text-slate-200">{shorten(effect.after)}</span>
      </td>
      <td className="px-3 py-2.5">
        {effect.delta === null ? (
          <span className="font-mono text-[10px] text-slate-600">—</span>
        ) : (
          <div className="w-28">
            <span
              className={cn(
                "font-mono text-[11px] tabular-nums",
                effect.severity === "EXPECTED" ? "text-[#22ff88]" : "text-amber-300"
              )}
            >
              {formatBaseUnits(effect.delta)}
            </span>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
              <span
                className={cn(
                  "block h-full rounded-full",
                  effect.severity === "EXPECTED"
                    ? "bg-[#22ff88]"
                    : effect.severity === "UNEXPECTED"
                      ? "bg-amber-400"
                      : "bg-red-500"
                )}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      </td>
      <td className="px-3 py-2.5">
        <WhyDrawer label={effect.matchedRuleIndex !== null ? "rule" : "why"}>
          {effect.matchedRuleIndex !== null ? (
            <span>
              Matched committed rule {effect.matchedRuleIndex}. {effect.explanation}
              {rulesRendered ? (
                <>
                  <br />
                  Stated intent: {rulesRendered}
                </>
              ) : null}
            </span>
          ) : (
            effect.explanation
          )}
        </WhyDrawer>
      </td>
    </tr>
  );
}

function CompactPreview({
  preview,
  loading,
  error,
  provenance,
  onRetry,
}: {
  preview: EffectPreview | null;
  loading: boolean;
  error: string | null;
  provenance: "LIVE" | "RECORDED";
  onRetry: () => void;
}) {
  if (loading && !preview) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-[11px] text-slate-400">
        <Loader2 size={13} className="mr-2 inline animate-spin text-cyan-300" />
        Simulating the committed calldata…
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-xl border border-amber-900/50 bg-amber-950/15 px-4 py-3 text-[11px] text-amber-200/80">
        <AlertTriangle size={13} className="mr-2 inline" />
        Effect preview unavailable — {error ?? "no data"}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 underline decoration-amber-700 underline-offset-2"
        >
          retry
        </button>
      </div>
    );
  }

  const top = [...preview.effects]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Play size={13} className="text-cyan-300" />
          If this passes
        </span>
        <StatusBadge tone="neutral">{preview.network}</StatusBadge>
        <StatusBadge tone="neutral">block {preview.blockNumber.toLocaleString("en-US")}</StatusBadge>
        <ProvenanceTag kind={provenance} />
        <span className="ml-auto text-[10px] text-slate-500">
          top {top.length} of {preview.effects.length} effect(s)
        </span>
      </div>

      <VerdictBannerCompact preview={preview} />

      <ul className="mt-2 space-y-1.5">
        {top.map((effect, index) => (
          <li
            key={`${effect.kind}-${effect.subject}-${index}`}
            className="flex flex-wrap items-center gap-2 text-[11px]"
          >
            <StatusBadge tone={SEVERITY[effect.severity].tone}>
              {SEVERITY[effect.severity].label}
            </StatusBadge>
            <span className="text-slate-300">{effect.label}</span>
            <span className="font-mono text-[10px] text-slate-500">
              {shorten(effect.before)} → {shorten(effect.after)}
            </span>
          </li>
        ))}
        {top.length === 0 ? (
          <li className="text-[11px] text-slate-500">No watched value changed.</li>
        ) : null}
      </ul>
      <p className="mt-2 text-[10px] text-slate-500">
        Full table, stated-vs-simulated comparison and the unobserved list are on the Voting page.
      </p>
    </div>
  );
}

function VerdictBannerCompact({ preview }: { preview: EffectPreview }) {
  const mismatches = preview.statedVsSimulated.mismatchCount;
  if (preview.status === "UNAVAILABLE") {
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
        <AlertTriangle size={12} className="mr-1.5 inline" />
        No verdict: {preview.reason ?? "the calldata could not be simulated"}
      </div>
    );
  }
  if (mismatches > 0) {
    return (
      <div className="rounded-lg border border-red-800/80 bg-red-950/30 px-3 py-2 text-[11px] font-medium text-red-200">
        <ShieldAlert size={12} className="mr-1.5 inline" />
        {mismatches} effect{mismatches === 1 ? "" : "s"} outside the stated intent
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/25 px-3 py-2 text-[11px] font-medium text-emerald-200">
      <ShieldCheck size={12} className="mr-1.5 inline" />
      Matches the stated intent
    </div>
  );
}

function severityRank(severity: EffectSeverity): number {
  return severity === "CRITICAL" ? 3 : severity === "UNEXPECTED" ? 2 : 1;
}

function shorten(value: string): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/** Thousands-separated base units; deltas keep their sign. */
function formatBaseUnits(value: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(/^\+/, "");
  return `${negative ? "-" : "+"}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { forceExecute } from "@/lib/data";
import { explorerAddressUrl } from "@/lib/explorer";
import { cn, truncateMiddle } from "@/lib/format";
import {
  normalizeProposalTitle,
  proposalRef,
} from "@/lib/proposal-naming";
import type {
  ForcedExecutionResult,
  SentinelEvent,
  SentinelFeed,
  SentinelPhase,
} from "@/lib/types";

const PHASE: Record<SentinelPhase, { label: string; tone: StatusTone }> = {
  QUEUED: { label: "Queued", tone: "info" },
  DECODING: { label: "Decoding", tone: "info" },
  SIMULATING: { label: "Simulating", tone: "warning" },
  CLEAN: { label: "Clean", tone: "success" },
  VIOLATION: { label: "Violation", tone: "warning" },
  HALTED: { label: "Halted", tone: "danger" },
  ERROR: { label: "Error", tone: "danger" },
};

export function LiveSentinel({
  feed,
  loading,
  error,
  currentProposalId,
  onSelectProposal,
}: {
  feed: SentinelFeed | null;
  loading: boolean;
  error: string | null;
  currentProposalId: string;
  onSelectProposal: (event: SentinelEvent) => void;
}) {
  const events = [...(feed?.events ?? [])].reverse();
  const halted = (feed?.events ?? []).filter((event) => event.phase === "HALTED").length;
  const watcher = feed?.watcher;
  const online = Boolean(watcher?.online && watcher.status === "running");

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Radar size={16} className="text-cyan-300" />
          Live Sentinel
        </span>
      }
      subtitle="Queue → decode → sandbox simulate → clean or guardian halt."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">halt-only</StatusBadge>
          <StatusBadge
            tone={online ? "success" : watcher ? "warning" : "neutral"}
            pulse={online}
          >
            {online ? "watching" : watcher ? "offline" : "idle"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric
          label="Watcher"
          value={
            watcher ? (
              <AddressLink address={watcher.executor} />
            ) : (
              "not started"
            )
          }
          hint={
            watcher
              ? `Last heartbeat ${formatClock(watcher.lastHeartbeat)} UTC`
              : "Run npm run sentinel:watch"
          }
        />
        <Metric
          label="Last block"
          value={watcher?.lastBlock?.toString() ?? "—"}
          hint="Most recent block polled by the Sentinel"
        />
        <Metric
          label="Guardian halts"
          value={halted.toString()}
          hint="Only the guardian key can halt; the Sentinel cannot execute"
        />
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-900/40 bg-cyan-950/15 px-3 py-2 text-[11px] leading-relaxed text-cyan-200/80">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-cyan-300" />
        The Sentinel observes and flags. It runs proposals only inside snapshots that are
        reverted, and its sole on-chain authority is the guardian halt.
      </div>

      <div className="mt-4">
        {loading && !feed ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin text-cyan-300" />
            Reading Sentinel events…
          </div>
        ) : error && !feed ? (
          <div className="rounded-xl border border-red-900/70 bg-red-950/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-red-300">
              <AlertTriangle size={16} />
              Sentinel feed unavailable
            </div>
            <p className="mt-1 break-all font-mono text-xs text-red-400/80">{error}</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center">
            <Terminal size={20} className="text-slate-600" />
            <p className="text-sm text-slate-400">No queued proposals observed yet.</p>
            {!online ? (
              <p className="font-mono text-[11px] text-slate-500">
                npm run sentinel:watch
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                Watching for ProposalQueued events.
              </p>
            )}
          </div>
        ) : (
          <ol className="space-y-2">
            {events.slice(0, 24).map((event) => (
              <EventRow
                key={event.id}
                event={event}
                selected={event.proposalId === currentProposalId}
                onSelect={() => onSelectProposal(event)}
              />
            ))}
          </ol>
        )}
      </div>

      {error && feed ? (
        <p className="mt-2 break-all font-mono text-[10px] text-amber-400/80">
          Feed refresh failed; showing the last snapshot. {error}
        </p>
      ) : null}
    </Panel>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm tabular-nums text-slate-200">{value}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{hint}</p>
    </div>
  );
}

function AddressLink({ address }: { address: string }) {
  const href = explorerAddressUrl(address);
  const label = truncateMiddle(address, 8, 6);
  if (!href) return <>{label}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="transition-colors duration-150 hover:text-cyan-200"
      title={address}
    >
      {label}
    </a>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: SentinelEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = PHASE[event.phase];
  const halted = event.phase === "HALTED";
  const violation = halted || event.phase === "VIOLATION";

  return (
    <li
      className={cn(
        "rounded-xl border bg-slate-950/35 px-3 py-2.5 transition-colors duration-150",
        halted
          ? "border-red-900/70 bg-red-950/15"
          : selected
            ? "border-cyan-900/60"
            : "border-slate-800"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex w-16 shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-slate-500">
          <Clock3 size={11} />
          {formatClock(event.at)}
        </span>
        <StatusBadge tone={meta.tone} pulse={event.phase === "SIMULATING"}>
          {meta.label}
        </StatusBadge>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-150",
            selected
              ? "border-cyan-800 text-cyan-200"
              : "border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
          )}
          title="Select this proposal"
        >
          {proposalRef(event.proposalId)}
        </button>
        {violation ? (
          <StatusBadge tone="warning">
            {halted ? "Simulation detected" : "Violation"}
          </StatusBadge>
        ) : null}
        {event.phase === "CLEAN" ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-[#22ff88]">
            <CheckCircle2 size={12} /> no halt
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs font-medium text-slate-200">
        {normalizeProposalTitle(event.title, "LIVE")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{event.detail}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <HashChip label="commitment" value={event.commitment} />
        {event.txHash ? <HashChip label="queued tx" value={event.txHash} kind="tx" /> : null}
        {event.reportHash ? <HashChip label="report" value={event.reportHash} /> : null}
        {event.haltTxHash ? (
          <HashChip label="halt tx" value={event.haltTxHash} kind="tx" />
        ) : null}
        {event.haltBlockNumber ? (
          <span className="font-mono text-[10px] text-slate-500">
            block {event.haltBlockNumber}
          </span>
        ) : null}
      </div>

      {halted ? <ForcedExecution event={event} /> : null}
    </li>
  );
}

function ForcedExecution({ event }: { event: SentinelEvent }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ForcedExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await forceExecute(event.commitment));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/10 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-slate-400">
          <ShieldAlert size={13} className="text-red-400" />
          The hard gate is separate from the Sentinel. Force execution to see the
          executor refuse on its own.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-900/80 bg-red-950/40 px-2.5 py-1 text-[11px] font-medium text-red-300 transition-colors duration-150 hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
          {running ? "Submitting…" : "Try to execute anyway"}
        </button>
      </div>

      {result ? (
        <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/25 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">{result.label}</StatusBadge>
            <span className="font-mono text-[10px] text-red-300/80">{result.signature}</span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-200">{result.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
            {result.explanation}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <HashChip label="revert" value={result.revertData} />
            <HashChip label="tx" value={result.txHash} kind="tx" />
          </div>
          {result.explorerUrl ? (
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan-300 underline decoration-cyan-900 underline-offset-2 transition-colors duration-150 hover:text-cyan-200"
            >
              View the mined failure on Sepolia Etherscan
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 break-all text-[11px] text-red-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toISOString().slice(11, 19);
}

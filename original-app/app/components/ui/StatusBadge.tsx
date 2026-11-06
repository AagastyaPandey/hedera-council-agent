import { cn } from "@/lib/format";
import type { ReactNode } from "react";

export type StatusTone = "success" | "danger" | "warning" | "info" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  success:
    "border-emerald-900/70 bg-emerald-950/40 text-[#22ff88]",
  danger: "border-red-900/80 bg-red-950/40 text-red-400",
  warning: "border-amber-900/70 bg-amber-950/30 text-amber-300",
  info: "border-cyan-900/70 bg-cyan-950/30 text-cyan-300",
  neutral: "border-slate-800 bg-slate-900/60 text-slate-300",
};

const STATUS_TONE: Record<string, StatusTone> = {
  PASS: "success",
  PASSED: "success",
  SUCCESS: "success",
  MATCH: "success",
  GREEN: "success",
  FAIL: "danger",
  REJECTED: "danger",
  MISMATCH: "danger",
  RED: "danger",
  "EXECUTOR REVERT": "danger",
  TEST_REQUIRED: "warning",
  FLAGGED: "warning",
  UNRESOLVED: "warning",
  RUNNING: "warning",
  AMBER: "warning",
  "SENTINEL HALT": "warning",
  SIMULATED: "info",
  INFO: "info",
  IDLE: "neutral",
  UNAVAILABLE: "neutral",
};

export function StatusBadge({
  status,
  tone,
  children,
  dot = true,
  pulse = false,
  className,
}: {
  status?: string;
  tone?: StatusTone;
  children?: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const label = children ?? status ?? "";
  const resolved =
    tone ?? (status ? STATUS_TONE[status.toUpperCase()] : undefined) ?? "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        TONE_CLASS[resolved],
        className
      )}
    >
      {dot ? (
        <span className={cn("status-dot", pulse && "status-dot-pulse")} />
      ) : null}
      {label}
    </span>
  );
}

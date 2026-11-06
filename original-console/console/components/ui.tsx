import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export type StatusLike =
  | "GREEN"
  | "AMBER"
  | "RED"
  | "PASS"
  | "FAIL"
  | "PASSED"
  | "REJECTED"
  | "FLAGGED"
  | "TEST_REQUIRED"
  | "OK"
  | "NEUTRAL";

export function statusTone(status: StatusLike): "safe" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "GREEN":
    case "PASS":
    case "PASSED":
    case "OK":
      return "safe";
    case "AMBER":
    case "FLAGGED":
    case "TEST_REQUIRED":
      return "warn";
    case "RED":
    case "FAIL":
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

const STATUS_MARKS = {
  safe: "✓",
  warn: "!",
  danger: "✕",
  neutral: "—",
} as const;

const STATUS_LABELS: Record<StatusLike, string> = {
  GREEN: "clear",
  AMBER: "review",
  RED: "attention",
  PASS: "pass",
  FAIL: "fail",
  PASSED: "passed",
  REJECTED: "rejected",
  FLAGGED: "flagged",
  TEST_REQUIRED: "required",
  OK: "ok",
  NEUTRAL: "—",
};

export function StatusPill({
  status,
  children,
  className,
}: {
  status: StatusLike;
  children?: ReactNode;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 font-sans text-[10.5px] leading-none",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="text-[9px]">
        {STATUS_MARKS[tone]}
      </span>
      <span>{children ?? STATUS_LABELS[status]}</span>
    </span>
  );
}

const TONE_TEXT = {
  safe: "text-safe",
  warn: "text-signal",
  danger: "text-danger",
  neutral: "text-dim",
} as const;

export function statusTextClass(status: StatusLike): string {
  return TONE_TEXT[statusTone(status)];
}

export function LayerBadge({ layer }: { layer: "executor" | "sentinel" | "disclosure" }) {
  return (
    <span className="font-sans text-[10.5px] text-faint">
      Layer: {layer}
    </span>
  );
}

export function ModelBadge({ className }: { className?: string }) {
  return (
    <span className={cn("doc-stamp leading-tight", className)}>
      Reference model
      <br />
      Solidity pending
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-7 border-b border-edge pb-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          {meta ? <div className="mb-3 flex flex-wrap items-center gap-3">{meta}</div> : null}
          <h1 className="doc-title text-body">{title}</h1>
          {description ? (
            <p className="doc-deck mt-4">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="doc-section-title text-body">{title}</h2>
        {description ? <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-dim">{description}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Panel({
  children,
  className,
  accent = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
  id?: string;
}) {
  return (
    <div id={id} className={cn("panel", accent && "panel-accent", className)}>
      {children}
    </div>
  );
}

export function ScoreRing({
  score,
  status,
  label,
  hardGate = false,
}: {
  score: number | null;
  status: StatusLike;
  size?: number;
  label?: string;
  hardGate?: boolean;
}) {
  const tone = statusTone(status);
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-signal"
        : tone === "safe"
          ? "text-body"
          : "text-dim";
  const value = score === null ? 0 : Math.max(0, Math.min(1, score));

  if (hardGate) {
    return (
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="doc-score text-danger">—</span>
          <span className="font-sans text-[10px] text-faint">hard gate</span>
        </div>
        <div className="mt-2 h-px w-full bg-edge">
          <div className="h-px w-1/12 bg-danger" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={cn("doc-score", toneClass)}>
          {score === null ? "—" : score.toFixed(2)}
        </span>
        {label ? <span className="font-sans text-[10px] text-faint">{label}</span> : null}
      </div>
      <div className="mt-2 h-px w-full bg-edge">
        <div
          className={cn("h-px", tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-signal" : "bg-ink")}
          style={{ width: `${value * 100}%`, transition: "width 400ms ease" }}
        />
      </div>
    </div>
  );
}

export function RiskMeter({
  value,
  status,
  threshold = 0.65,
  className,
}: {
  value: number;
  status: StatusLike;
  threshold?: number;
  className?: string;
}) {
  const color = statusTone(status) === "danger" ? "var(--color-danger)" : statusTone(status) === "warn" ? "var(--color-signal)" : "var(--color-body)";
  return (
    <div className={cn("relative h-px w-full bg-edge", className)}>
      <div
        className="h-px"
        style={{ width: `${Math.min(100, value * 100)}%`, background: color, transition: "width 400ms ease" }}
      />
      <div
        className="absolute -top-1 h-2.5 w-px bg-body/60"
        style={{ left: `${Math.min(100, threshold * 100)}%` }}
        title={`Red threshold ${(threshold * 100).toFixed(0)}%`}
      />
    </div>
  );
}

export function HashLine({
  label,
  value,
  full = false,
  className,
}: {
  label: string;
  value: string;
  full?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 border-b border-edge/70 py-2.5 last:border-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="mono-label">{label}</span>
        <CopyButton value={value} compact />
      </div>
      <code className={cn("hash block min-w-0 max-w-full", !full && "truncate")}>{value}</code>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "safe" | "warn" | "danger";
}) {
  const toneClass =
    tone === "safe" ? "text-safe" : tone === "warn" ? "text-signal" : tone === "danger" ? "text-danger" : "text-body";
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-x-4 border-t border-edge/70 py-2.5">
      <span className="mono-label">{label}</span>
      <span className={cn("min-w-0 text-[13px] leading-snug", toneClass)}>{value}</span>
      {sub ? <span className="col-start-2 text-[10.5px] leading-snug text-faint">{sub}</span> : null}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: "safe" | "warn" | "danger" | "info" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    safe: "border-safe",
    warn: "border-signal",
    danger: "border-danger",
    info: "border-edge2",
    neutral: "border-edge2",
  } as const;
  return (
    <div className={cn("border-l-2 pl-3", styles[tone], className)}>
      {title ? <div className="mb-1 text-[12.5px] font-medium text-body">{title}</div> : null}
      <div className="text-[12px] leading-relaxed text-dim">{children}</div>
    </div>
  );
}

export function ArrowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("arrow-link", className)}>
      {children}
    </Link>
  );
}

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("mono-label", className)}>{children}</span>;
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-edge/60 py-2 last:border-0">
      <span className="mono-label shrink-0">{label}</span>
      <span className="min-w-0 text-right text-[12px] text-body">{children}</span>
    </div>
  );
}

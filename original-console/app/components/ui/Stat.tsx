import { cn } from "@/lib/format";
import type { ReactNode } from "react";
import { WhyDrawer } from "./WhyDrawer";

export type StatTone = "neutral" | "success" | "danger" | "warning" | "info";

const TONE: Record<StatTone, string> = {
  neutral: "text-slate-100",
  success: "text-[#22ff88]",
  danger: "text-red-400",
  warning: "text-amber-300",
  info: "text-cyan-300",
};

export function Stat({
  label,
  value,
  hint,
  why,
  tone = "neutral",
  mono = true,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  why?: ReactNode;
  tone?: StatTone;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3",
        className
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight",
          mono && "font-mono tabular-nums",
          TONE[tone]
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
      {why ? <WhyDrawer className="mt-2">{why}</WhyDrawer> : null}
    </div>
  );
}

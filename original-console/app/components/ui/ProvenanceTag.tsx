import { cn } from "@/lib/format";
import type { Provenance } from "@/lib/types";

const META: Record<Provenance, { className: string; description: string }> = {
  LIVE: {
    className: "border-emerald-900/70 bg-emerald-950/35 text-[#22ff88]",
    description: "Read from the running local chain.",
  },
  RECORDED: {
    className: "border-cyan-900/70 bg-cyan-950/30 text-cyan-300",
    description: "Captured from a completed scenario run or recorded report.",
  },
  SIMULATED: {
    className: "border-violet-900/70 bg-violet-950/30 text-violet-300",
    description: "Computed by a simulation, not read directly from chain state.",
  },
  MOCK: {
    className: "border-slate-700 bg-slate-900/70 text-slate-300",
    description: "Static demonstration fixture.",
  },
};

export function ProvenanceTag({
  kind,
  detail,
  className,
}: {
  kind: Provenance;
  detail?: string;
  className?: string;
}) {
  const meta = META[kind];
  return (
    <span
      title={detail ?? meta.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]",
        meta.className,
        className
      )}
    >
      <span className="h-1 w-1 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
      {kind}
    </span>
  );
}

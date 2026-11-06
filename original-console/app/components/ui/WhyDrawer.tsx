"use client";

import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function WhyDrawer({
  children,
  label = "Why",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <details className={cn("group/why relative", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-cyan-300/80 transition-colors hover:text-cyan-200">
        <CircleHelp size={11} /> {label}
      </summary>
      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-[11px] leading-relaxed text-slate-400 shadow-xl">
        {children}
      </div>
    </details>
  );
}

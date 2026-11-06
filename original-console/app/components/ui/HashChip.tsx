"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import {
  explorerAddressUrl,
  explorerBlockUrl,
  explorerTxUrl,
} from "@/lib/explorer";
import { cn, truncateMiddle } from "@/lib/format";

export type HashKind = "tx" | "address" | "block";

function explorerHref(kind: HashKind | undefined, value: string): string | null {
  if (kind === "tx") return explorerTxUrl(value);
  if (kind === "address") return explorerAddressUrl(value);
  if (kind === "block") return explorerBlockUrl(value);
  return null;
}

export function HashChip({
  value,
  label,
  lead = 12,
  tail = 8,
  className,
  kind,
}: {
  value?: string | null;
  label?: string;
  lead?: number;
  tail?: number;
  className?: string;
  /** Link the value to the configured block explorer (Sepolia). */
  kind?: HashKind;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return (
      <span className={cn("font-mono text-[11px] text-slate-500", className)}>
        —
      </span>
    );
  }

  const full = value;
  const display = truncateMiddle(full, lead, tail);
  const href = explorerHref(kind, full);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be blocked; the full value remains in the tooltip.
    }
  };

  return (
    <span
      className={cn(
        "group relative inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/70 px-2 py-1 font-mono text-[11px] tabular-nums text-cyan-300 transition-colors duration-150 hover:border-cyan-900/70",
        className
      )}
    >
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
          {label}
        </span>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 truncate transition-colors duration-150 hover:text-cyan-200"
          title={`${full} — open in explorer`}
        >
          <span className="truncate">{display}</span>
          <ExternalLink size={10} className="shrink-0 text-slate-500" />
        </a>
      ) : (
        <span className="truncate">{display}</span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? "value"}`}
        className="text-slate-500 transition-colors duration-150 hover:text-cyan-300"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[360px] -translate-x-1/2 break-all rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-left font-mono text-[10px] leading-relaxed text-slate-300 shadow-xl group-hover:block group-focus-within:block"
      >
        {full}
      </span>
    </span>
  );
}

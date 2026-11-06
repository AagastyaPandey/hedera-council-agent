"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  value,
  label,
  compact = false,
  className = "",
}: {
  value: string;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("done");
      window.setTimeout(() => setCopied("idle"), 1400);
    } catch {
      setCopied("failed");
      window.setTimeout(() => setCopied("idle"), 1800);
    }
  }

  const Icon = copied === "done" ? Check : Copy;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `${label}: copy` : "Copy value"}
      title={copied === "done" ? "Copied" : copied === "failed" ? "Clipboard unavailable" : "Copy"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border border-edge bg-white/2 px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-dim transition-colors hover:border-edge2 hover:text-body ${
        compact ? "px-1.5" : "px-2"
      } ${copied === "done" ? "border-safe/40 text-safe" : ""} ${
        copied === "failed" ? "border-danger/40 text-danger" : ""
      } ${className}`}
    >
      <Icon size={11} strokeWidth={1.8} />
      {compact ? null : <span>{copied === "done" ? "copied" : copied === "failed" ? "failed" : "copy"}</span>}
    </button>
  );
}

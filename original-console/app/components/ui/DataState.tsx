"use client";

import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function DataState({
  loading,
  error,
  empty = false,
  emptyMessage = "No data available.",
  loadingLabel = "Loading",
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyMessage?: string;
  loadingLabel?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-6 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin text-cyan-300" />
        {loadingLabel}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/70 bg-red-950/30 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-red-300">
          <AlertTriangle size={16} />
          Could not load data
        </div>
        <p className="mt-1 break-all font-mono text-xs text-red-400/80">
          {error}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md border border-red-900 px-2.5 py-1 text-xs text-red-300 transition-colors duration-150 hover:bg-red-950/50"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
        <Inbox size={20} />
        {emptyMessage}
      </div>
    );
  }

  return <>{children}</>;
}

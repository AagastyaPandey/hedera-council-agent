"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Re-reads the council server every few seconds so a decision made elsewhere appears here without a reload.
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { router.refresh(); setTick((t) => t + 1); }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return (
    <span className="doc-folio inline-flex items-center gap-1.5" aria-live="off">
      <span key={tick} className="inline-block h-1.5 w-1.5 rounded-full bg-danger pulse-danger" />
      live, refreshes every {Math.round(everyMs / 1000)}s
    </span>
  );
}

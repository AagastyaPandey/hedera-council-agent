"use client";

import { useEffect, useState } from "react";
import { getSentinelFeed } from "./data";
import type { SentinelFeed } from "./types";

export function useSentinelFeed(intervalMs = 1500) {
  const [feed, setFeed] = useState<SentinelFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await getSentinelFeed();
        if (!active) return;
        setFeed(next);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
        if (!active) return;
        setLoading(false);
        timer = setTimeout(poll, intervalMs);
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void poll();
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [intervalMs]);

  return { feed, error, loading };
}

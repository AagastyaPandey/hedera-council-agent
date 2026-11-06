"use client";

import { useEffect, useState } from "react";
import { Panel, StatusPill } from "@/components/ui";

type LiveEvent = {
  id: string;
  at: string;
  phase: string;
  proposalId: string;
  govId: string | null;
  title: string;
  detail: string;
  blockNumber: number | null;
  txHash: string | null;
};

type WatcherState = {
  status: string;
  lastHeartbeat: string;
  lastBlock: number | null;
  online: boolean;
};

type Payload = {
  watcher: WatcherState | null;
  events: LiveEvent[];
};

function short(value: string | null, head = 8, tail = 6): string {
  if (!value) return "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function LiveWatcher() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/watcher/events", { cache: "no-store" });
        const json = (await response.json()) as Payload & { error?: string };
        if (!response.ok) throw new Error(json.error ?? response.statusText);
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    load();
    const timer = window.setInterval(load, 12_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <Panel className="border-danger/30 p-4">
        <div className="mono-label text-danger">Watcher unavailable</div>
        <p className="mt-2 text-[12px] leading-relaxed text-dim">{error}</p>
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel className="p-4">
        <div className="mono-label">Reading watcher store…</div>
        <div className="mt-3 h-2 w-2/3 bg-edge/60" />
        <div className="mt-2 h-2 w-1/2 bg-edge/40" />
      </Panel>
    );
  }

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`status-dot ${
              data.watcher?.online ? "text-safe" : "text-danger"
            }`}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
            {data.watcher
              ? data.watcher.online
                ? "watcher online"
                : "watcher stale"
              : "watcher not started"}
          </span>
        </div>
        <span className="font-mono text-[9px] text-faint">
          block {data.watcher?.lastBlock ?? "—"}, {data.events.length} events
        </span>
      </div>

      {data.events.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          No watcher events yet. The seed performed its halts directly; run{" "}
          <code className="font-mono text-[10.5px] text-body">
            npm run sentinel:watch
          </code>{" "}
          to stream new events into this panel.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {data.events.slice(0, 6).map((event) => (
            <li key={event.id} className="border-b border-edge/60 pb-2 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
                  {event.phase}, {event.proposalId}
                </span>
                <StatusPill
                  status={
                    event.phase === "HALTED"
                      ? "RED"
                      : event.phase === "VIOLATION"
                        ? "AMBER"
                        : "OK"
                  }
                >
                  {event.phase}
                </StatusPill>
              </div>
              <div className="mt-1 text-[11.5px] text-body">{event.title}</div>
              <div className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                {event.detail}
              </div>
              <div className="mt-1 font-mono text-[9px] text-faint">
                {new Date(event.at).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
               , tx {short(event.txHash)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

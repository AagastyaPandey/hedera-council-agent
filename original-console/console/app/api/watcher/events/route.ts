import { NextResponse } from "next/server";
import { readLiveReports } from "../../../../../sentinel/live-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const reports = readLiveReports();
    const watcher = reports.watcher;
    const heartbeatAge = watcher
      ? Date.now() - new Date(watcher.lastHeartbeat).getTime()
      : Number.POSITIVE_INFINITY;
    const staleAfter = watcher
      ? Math.max(15_000, watcher.pollIntervalMs * 5)
      : 15_000;

    return NextResponse.json(
      {
        ...reports,
        watcher: watcher
          ? { ...watcher, online: heartbeatAge <= staleAfter }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

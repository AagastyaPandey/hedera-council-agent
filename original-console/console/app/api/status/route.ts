import { NextResponse } from "next/server";
import { getChainDiagnostics } from "../../../lib/chain";
import { repoRoot } from "../../../lib/backend";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics = await getChainDiagnostics();
  let scorecardFreshMs: number | null = null;
  try {
    const sc = path.join(repoRoot(), "packages", "shared", "scorecard.json");
    if (fs.existsSync(sc)) {
      scorecardFreshMs = Date.now() - fs.statSync(sc).mtimeMs;
    }
  } catch { /* ignore */ }
  return NextResponse.json({ ...diagnostics, scorecardFreshMs });
}

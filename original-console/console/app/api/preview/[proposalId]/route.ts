import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorMessage, repoRoot } from "@/lib/backend";
import { DATA_MODE } from "@/lib/config";
import type { EffectPreview } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIMEOUT_MS = 180_000;

function previewsFile(): string {
  return path.join(repoRoot(), "packages", "shared", "fixtures", "previews.json");
}

/** Recorded mode: the committed fixtures, never a silent live fallback. */
function recordedPreview(proposalId: string): EffectPreview {
  const file = previewsFile();
  if (!existsSync(file)) {
    throw new Error(
      `Recorded previews are unavailable: ${file} does not exist. ` +
        `Generate it with "npm run previews:record" against a seeded local chain.`
    );
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, EffectPreview>;
  const entry = parsed[proposalId];
  if (!entry) {
    throw new Error(
      `No recorded preview for proposal ${proposalId} in packages/shared/fixtures/previews.json.`
    );
  }
  return entry;
}

/** Live mode: same shell-out mechanism the arena route uses, to the preview CLI. */
async function livePreview(proposalId: string): Promise<EffectPreview> {
  const root = repoRoot();
  const tsNode = path.join(root, "node_modules", "ts-node", "dist", "bin.js");
  if (!existsSync(tsNode)) {
    throw new Error(`ts-node CLI not found at ${tsNode}. Run npm install.`);
  }

  const { stdout, stderr, exitCode, timedOut } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(
      process.execPath,
      [tsNode, path.join("sentinel", "preview-cli.ts"), proposalId],
      {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      }
    );

    let out = "";
    let err = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      resolve({ stdout: out, stderr: err, exitCode: null, timedOut: true });
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout: out, stderr: `${err}${errorMessage(error)}`, exitCode: 1, timedOut: false });
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, exitCode: code, timedOut: false });
    });
  });

  if (timedOut) {
    throw new Error(
      `The preview CLI did not finish within ${TIMEOUT_MS / 1000}s. ` +
        `Is the snapshot lock held by another run?`
    );
  }
  if (exitCode !== 0) {
    throw new Error(
      `The preview CLI exited with code ${exitCode}. ${stderr.trim().slice(0, 800)}`
    );
  }

  try {
    return JSON.parse(stdout) as EffectPreview;
  } catch {
    throw new Error(
      `The preview CLI did not return JSON. stdout: ${stdout.slice(0, 400)}`
    );
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await context.params;
  if (!/^\d+$/.test(proposalId)) {
    return NextResponse.json(
      { error: `Proposal id must be an integer (received "${proposalId}")` },
      { status: 400 }
    );
  }

  try {
    const preview =
      DATA_MODE === "live"
        ? await livePreview(proposalId)
        : recordedPreview(proposalId);
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
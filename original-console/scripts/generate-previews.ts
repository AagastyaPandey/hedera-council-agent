/**
 * scripts/generate-previews.ts
 *
 * Records the Pre-vote Effect Preview for every seeded demo proposal into
 * packages/shared/fixtures/previews.json. The console serves that file in
 * recorded mode; live mode always calls the CLI instead.
 *
 * Run against a seeded chain:
 *   npm run previews:record                 # local node
 *   FORK=1 SENTINEL_NETWORK=sepolia npm run previews:record:sepolia
 *
 * The preview never mutates chain state (it reverts its snapshot), so this is
 * safe to run against a live demo deployment.
 */

import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { previewProposal } from "../sentinel/preview";
import type { EffectPreview } from "../packages/shared/schemas/effect-preview";

async function main(): Promise<void> {
  const demoPath = path.join(
    __dirname,
    "..",
    "packages",
    "shared",
    "fixtures",
    "demo-state.json"
  );
  if (!fs.existsSync(demoPath)) {
    throw new Error(`No demo state at ${demoPath}. Run npm run seed first.`);
  }

  const demo = JSON.parse(fs.readFileSync(demoPath, "utf8")) as Record<
    string,
    { title: string }
  >;
  const ids = Object.keys(demo).sort((a, b) => Number(a) - Number(b));
  const out: Record<string, EffectPreview> = {};

  console.log(`\nRecording effect previews for ${ids.length} demo proposals...`);
  for (const proposalId of ids) {
    const preview = await previewProposal(proposalId, {
      provider: ethers.provider,
      noCache: true,
    });
    out[proposalId] = preview;
    console.log(
      `  ✔ proposal ${proposalId.padEnd(3)} ${preview.status.padEnd(18)} ` +
        `mismatches=${preview.statedVsSimulated.mismatchCount} ` +
        `effects=${preview.effects.length} hash=${preview.previewHash.slice(0, 12)}…`
    );
  }

  const outPath = path.join(
    __dirname,
    "..",
    "packages",
    "shared",
    "fixtures",
    "previews.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n💾 Wrote ${ids.length} recorded previews to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
/**
 * sentinel/preview-cli.ts
 *
 * CLI boundary for the Pre-vote Effect Preview, used by the Next.js API.
 *
 *   ts-node sentinel/preview-cli.ts <proposalId> [--no-cache]
 *
 * Prints the EffectPreview JSON on stdout (nothing else), so the caller can
 * parse it directly. Diagnostics go to stderr.
 *
 * Runs against the RPC in the environment, not the public Sepolia endpoint by
 * default: set RPC_URL (or NEXT_PUBLIC_RPC_URL / SEPOLIA_RPC_URL), and use
 * FORK=1 Hardhat both for Sepolia previews and for the local node.
 */

import { ethers } from "ethers";
import { previewProposal } from "./preview";

function rpcUrl(): string {
  return (
    process.env.PREVIEW_RPC_URL ??
    process.env.RPC_URL ??
    process.env.SENTINEL_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    "http://127.0.0.1:8545"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const proposalId = args.find((value) => /^\d+$/.test(value));
  if (!proposalId) {
    console.error("usage: ts-node sentinel/preview-cli.ts <proposalId> [--no-cache]");
    process.exit(2);
  }

  const noCache = args.includes("--no-cache");
  const url = rpcUrl();
  const provider = new ethers.JsonRpcProvider(url);

  try {
    const preview = await previewProposal(proposalId, { provider, noCache });
    process.stdout.write(JSON.stringify(preview));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`preview failed: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
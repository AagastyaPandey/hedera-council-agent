/**
 * scripts/verify-all.ts
 *
 * Verifies every contract in deployments/<network>.json on Etherscan using the
 * constructor arguments recorded at deploy time.
 *
 * Run: npx hardhat run scripts/verify-all.ts --network sepolia
 */

import hre, { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

interface ManifestArg {
  type: string;
  value: string;
}

interface ManifestEntry {
  address: string;
  args?: ManifestArg[];
}

interface Manifest {
  network?: string;
  contracts: Record<string, ManifestEntry>;
}

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
};

function networkName(): string {
  const arg = process.argv.slice(2).find((value) => !value.startsWith("-"));
  if (arg) return arg;
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    return "local";
  }
  return hre.network.name;
}

function decodeArg(arg: ManifestArg): unknown {
  switch (arg.type) {
    case "address":
      return ethers.getAddress(arg.value);
    case "bool":
      return arg.value === "true";
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
      return Number(arg.value);
    case "uint256":
    case "uint128":
    case "int256":
      return BigInt(arg.value);
    default:
      return arg.value;
  }
}

function explorerUrl(chainId: number, address: string): string {
  const base = EXPLORERS[chainId];
  return base ? `${base}/address/${address}#code` : address;
}

async function main(): Promise<void> {
  const name = networkName();
  const manifestPath = path.join(__dirname, "..", "deployments", `${name}.json`);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Deployment manifest not found: ${manifestPath}. Deploy first with ` +
        `"npx hardhat run scripts/deploy.ts --network ${name}".`
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  if (!EXPLORERS[chainId]) {
    throw new Error(`No Etherscan explorer configured for chain ${chainId}.`);
  }
  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn("⚠ ETHERSCAN_API_KEY is not set; verification will fail.");
  }

  console.log(`\n🔎 Verifying ${Object.keys(manifest.contracts).length} contracts on ${name} (chain ${chainId})`);

  let verified = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];

  for (const [contractName, entry] of Object.entries(manifest.contracts)) {
    if (!entry.address) {
      console.log(`  ⚠ ${contractName}: no address in manifest, skipping`);
      skipped++;
      continue;
    }

    const constructorArguments = (entry.args ?? []).map(decodeArg);
    process.stdout.write(`  … ${contractName} (${entry.address}) `);

    try {
      await hre.run("verify:verify", {
        address: entry.address,
        constructorArguments,
      });
      console.log("✔ verified");
      verified++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already verified/i.test(message)) {
        console.log("✔ already verified");
        verified++;
      } else {
        console.log("✖ failed");
        failed++;
        failures.push({ name: contractName, error: message });
      }
    }

    // Etherscan rate-limits verification bursts.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("\nEtherscan links:");
  for (const [contractName, entry] of Object.entries(manifest.contracts)) {
    console.log(`  ${contractName.padEnd(20)} ${explorerUrl(chainId, entry.address)}`);
  }

  console.log(
    `\nSummary: ${verified} verified, ${failed} failed, ${skipped} skipped.`
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  ${failure.name}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

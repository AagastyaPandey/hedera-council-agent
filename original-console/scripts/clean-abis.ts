/**
 * scripts/clean-abis.ts
 *
 * Rebuilds deployments/local.json from Hardhat compilation artifacts.
 * Addresses and deployment metadata come from the existing manifest; ABIs
 * come from artifacts/contracts (never from ethers Interface.formatJson,
 * which emits malformed "stateMutability": "undefined" values).
 *
 * Run: npx ts-node scripts/clean-abis.ts
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts", "contracts");
const MANIFEST_PATH = path.join(
  ROOT,
  "deployments",
  `${process.argv[2] ?? "local"}.json`
);

// Manifest keys that were deployed from another contract's artifact.
const ARTIFACT_ALIASES: Record<string, string> = {
  GovernanceToken: "MockUSDC",
};

interface Artifact {
  contractName: string;
  abi: unknown[];
}

interface ManifestContract {
  address: string;
  abi: unknown;
  [key: string]: unknown;
}

interface Manifest {
  network: string;
  chainId: number;
  deployedAt: string;
  contracts: Record<string, ManifestContract>;
  [key: string]: unknown;
}

function findArtifacts(dir: string): Map<string, Artifact> {
  const artifacts = new Map<string, Artifact>();

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, artifact] of findArtifacts(fullPath)) {
        artifacts.set(name, artifact);
      }
      continue;
    }
    if (!entry.name.endsWith(".json") || entry.name.endsWith(".dbg.json")) {
      continue;
    }

    const artifact = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Artifact;
    if (!artifact.contractName || !Array.isArray(artifact.abi)) {
      throw new Error(`Artifact is missing contractName/abi: ${fullPath}`);
    }
    if (artifacts.has(artifact.contractName)) {
      throw new Error(`Duplicate artifact for contract ${artifact.contractName}`);
    }
    artifacts.set(artifact.contractName, artifact);
  }

  return artifacts;
}

/**
 * Replace legacy/malformed mutability with a valid ABI value and drop the
 * pre-v0.5 payable/constant flags. Artifacts are already clean, but this
 * guards against stale or hand-edited inputs.
 */
function sanitizeAbi(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(sanitizeAbi);
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }

  const entry = node as Record<string, unknown>;
  if (entry.type === "function" || entry.type === "constructor") {
    if (typeof entry.stateMutability !== "string" || entry.stateMutability === "undefined") {
      if (entry.payable === true) {
        entry.stateMutability = "payable";
      } else if (entry.constant === true) {
        entry.stateMutability = "view";
      } else {
        entry.stateMutability = "nonpayable";
      }
    }
  } else if (entry.stateMutability === "undefined") {
    delete entry.stateMutability;
  }
  delete entry.payable;
  delete entry.constant;

  for (const value of Object.values(entry)) {
    sanitizeAbi(value);
  }
}

export function cleanAbis(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    throw new Error(`Artifacts directory not found: ${ARTIFACTS_DIR}. Run "npx hardhat compile" first.`);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Deployment manifest not found: ${MANIFEST_PATH}. Run the deployment script first.`);
  }

  const artifacts = findArtifacts(ARTIFACTS_DIR);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

  if (!manifest.contracts || typeof manifest.contracts !== "object") {
    throw new Error(`Manifest has no contracts object: ${MANIFEST_PATH}`);
  }

  const cleanContracts: Record<string, ManifestContract> = {};
  const usedArtifacts = new Set<string>();

  for (const [name, deployed] of Object.entries(manifest.contracts)) {
    const artifactName = ARTIFACT_ALIASES[name] ?? name;
    const artifact = artifacts.get(artifactName);
    if (!artifact) {
      throw new Error(`No artifact found for contract ${name} (looked for ${artifactName})`);
    }
    if (!deployed.address || !ethers.isAddress(deployed.address)) {
      throw new Error(`Invalid address for ${name}: ${String(deployed.address)}`);
    }
    if (deployed.address === ethers.ZeroAddress) {
      throw new Error(`Zero address for ${name}`);
    }

    const abi = JSON.parse(JSON.stringify(artifact.abi)) as unknown[];
    sanitizeAbi(abi);

    if (abi.some((fragment) => JSON.stringify(fragment).includes('"stateMutability":"undefined"'))) {
      throw new Error(`Malformed stateMutability survived sanitization for ${name}`);
    }

    cleanContracts[name] = {
      ...deployed,
      address: ethers.getAddress(deployed.address),
      abi,
    };
    usedArtifacts.add(artifactName);
    console.log(
      `  ✔ ${name.padEnd(20)} ${cleanContracts[name].address}  ${abi.length} ABI entries` +
        (artifactName === name ? "" : `  (artifact: ${artifactName})`)
    );
  }

  const unused = [...artifacts.keys()].filter((name) => !usedArtifacts.has(name));
  if (unused.length > 0) {
    console.log(`  ℹ Not deployed, omitted: ${unused.sort().join(", ")}`);
  }

  const output: Manifest = {
    ...manifest,
    contracts: cleanContracts,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  const total = Object.values(cleanContracts).reduce(
    (sum, c) => sum + (c.abi as unknown[]).length,
    0
  );
  console.log(
    `\n✅ Wrote ${Object.keys(cleanContracts).length} contracts (${total} ABI fragments) to ${MANIFEST_PATH}`
  );
}

if (require.main === module) {
  cleanAbis();
}

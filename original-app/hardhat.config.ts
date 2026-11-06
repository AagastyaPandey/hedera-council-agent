import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import path from "node:path";

// Load a root .env without adding a dependency (Node 20.12+ has loadEnvFile).
function loadRootEnv(): void {
  const file = path.join(__dirname, ".env");
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void })
    .loadEnvFile;
  try {
    if (typeof loadEnvFile === "function") {
      loadEnvFile.call(process, file);
    }
  } catch {
    // No .env file: rely on the process environment.
  }
}

loadRootEnv();

const normalizeKey = (key: string): string =>
  key.startsWith("0x") ? key : `0x${key}`;

function parseKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map(normalizeKey);
}

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const sepoliaAccounts = parseKeys(process.env.DEPLOYER_KEY);
const forkEnabled = process.env.FORK === "1";
const forkBlockNumber = Number(process.env.FORK_BLOCK_NUMBER);

if (forkEnabled && !SEPOLIA_RPC_URL) {
  throw new Error("FORK=1 requires SEPOLIA_RPC_URL to be set (see .env.example).");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      ...(forkEnabled
        ? {
            forking: {
              url: SEPOLIA_RPC_URL,
              ...(Number.isFinite(forkBlockNumber) && forkBlockNumber > 0
                ? { blockNumber: forkBlockNumber }
                : {}),
            },
          }
        : {}),
    },
    localhost: {
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: sepoliaAccounts,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
};

export default config;

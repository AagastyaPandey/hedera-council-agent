/**
 * app/lib/chain.ts
 *
 * Server-side ethers v6 provider + typed contract instances loaded from
 * deployments/<network>.json, where <network> is derived from
 * NEXT_PUBLIC_CHAIN_ID (11155111 -> sepolia, 31337 -> local).
 *
 * Rules:
 *  - Fail loudly (never silently swallow) if RPC or contract addresses are missing.
 *  - All contract state enums mirrored from Solidity source — no guessed numbers.
 *  - Server-side only (Node); never imported by client components directly.
 *    Private keys are read from env here and never returned to the client.
 */

import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./backend";

export {
  chainLabel,
  explorerAddressUrl,
  explorerBaseUrl,
  explorerBlockUrl,
  explorerTxUrl,
} from "./explorer";

export const APP_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

export function deploymentName(): string {
  if (APP_CHAIN_ID === 11155111) return "sepolia";
  if (APP_CHAIN_ID === 1) return "mainnet";
  return process.env.AEGIS_DEPLOYMENT ?? "local";
}

// ─────────────────────────────────────────────────────────────────────────────
// ProposalState enum — mirrors IntentLockExecutor.sol exactly
// ─────────────────────────────────────────────────────────────────────────────
export const ProposalState = {
  Empty:     0,   // not queued
  Queued:    1,   // waiting for timelock
  Executed:  2,   // successfully executed
  Halted:    3,   // cancelled by guardian
  Cancelled: 4,   // cancelled by governor
} as const;
export type ProposalStateValue = (typeof ProposalState)[keyof typeof ProposalState];

// GovProposalState — mirrors IntentGovernor.sol exactly
export const GovProposalState = {
  Draft:              0,
  DisclosurePending:  1,
  VotingOpen:         2,
  Defeated:           3,
  Passed:             4,
  Queued:             5,
  Executed:           6,
  Halted:             7,
  Cancelled:          8,
} as const;
export type GovProposalStateValue = (typeof GovProposalState)[keyof typeof GovProposalState];

export const GOV_STATE_LABEL: Record<number, string> = {
  0: "Draft",
  1: "DisclosurePending",
  2: "VotingOpen",
  3: "Defeated",
  4: "Passed",
  5: "Queued",
  6: "Executed",
  7: "Halted",
  8: "Cancelled",
};

// ─────────────────────────────────────────────────────────────────────────────
// Deployment manifest loader
// ─────────────────────────────────────────────────────────────────────────────

interface ContractEntry {
  address: string;
  abi: ethers.InterfaceAbi;
}

interface Manifest {
  network: string;
  chainId: number;
  deploymentBlock?: number;
  contracts: Record<string, ContractEntry>;
}

let _manifest: Manifest | null = null;
function loadManifest(): Manifest {
  if (_manifest) return _manifest;
  const name = deploymentName();
  const manifestPath = path.join(repoRoot(), "deployments", `${name}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `deployments/${name}.json not found at ${manifestPath}. ` +
        `Run \`npm run deploy\` for local, or deploy to Sepolia first.`
    );
  }
  _manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  return _manifest;
}

export function getManifestChainId(): number {
  return loadManifest().chainId;
}

export function getDeploymentBlock(): number {
  return loadManifest().deploymentBlock ?? 0;
}

function contractEntry(name: string): ContractEntry {
  const m = loadManifest();
  const entry = m.contracts[name];
  if (!entry?.address || entry.address === ethers.ZeroAddress) {
    throw new Error(
      `Contract "${name}" has no deployed address in deployments/${deploymentName()}.json. ` +
        `Re-deploy with \`npm run deploy\`.`
    );
  }
  return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider (read-only JsonRpc)
// ─────────────────────────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;

export function getRpcUrl(): string {
  const explicit = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  if (explicit) return explicit;
  if (APP_CHAIN_ID === 11155111) {
    if (!process.env.SEPOLIA_RPC_URL) {
      throw new Error(
        "SEPOLIA_RPC_URL (or NEXT_PUBLIC_RPC_URL) is required when NEXT_PUBLIC_CHAIN_ID=11155111."
      );
    }
    return process.env.SEPOLIA_RPC_URL;
  }
  return "http://127.0.0.1:8545";
}

export function getProvider(): ethers.JsonRpcProvider {
  if (_provider) return _provider;
  _provider = new ethers.JsonRpcProvider(getRpcUrl());
  return _provider;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signers
//
// On Sepolia the server signs with wallets derived from env keys. The Hardhat
// eth_accounts signer remains available for local development only, behind
// ALLOW_DEV_SIGNER (default on for chain 31337, never on a testnet).
// Keys never leave this module; callers only receive a Signer instance.
// ─────────────────────────────────────────────────────────────────────────────

export type SignerRole =
  | "deployer"
  | "guardian"
  | "verifier"
  | "proposer"
  | "voter1"
  | "voter2"
  | "voter3"
  | "challenger";

const ROLE_KEY_ENV: Record<SignerRole, string> = {
  deployer: "DEPLOYER_KEY",
  guardian: "GUARDIAN_KEY",
  verifier: "VERIFIER_KEY",
  proposer: "PROPOSER_KEY",
  voter1: "VOTER1_KEY",
  voter2: "VOTER2_KEY",
  voter3: "VOTER3_KEY",
  challenger: "CHALLENGER_KEY",
};

const ROLE_DEV_INDEX: Record<SignerRole, number> = {
  deployer: 0,
  guardian: 1,
  verifier: 2,
  proposer: 3,
  voter1: 4,
  voter2: 5,
  voter3: 6,
  challenger: 8,
};

function normalizeKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

/** The eth_accounts signer is local-only; never enabled on Sepolia. */
export function devSignerAllowed(): boolean {
  if (APP_CHAIN_ID !== 31337) return false;
  return process.env.ALLOW_DEV_SIGNER !== "0";
}

/**
 * Return a JsonRpcSigner for Hardhat account at index `accountIndex`.
 * Works only against a local Hardhat node (accounts are pre-funded).
 */
export async function getDevSigner(
  accountIndex = 0
): Promise<ethers.JsonRpcSigner> {
  if (!devSignerAllowed()) {
    throw new Error(
      "Dev signer is disabled. Configure server-side keys (DEPLOYER_KEY, " +
        "PROPOSER_KEY, VOTER*_KEY, ...) or set ALLOW_DEV_SIGNER=1 on a local " +
        "Hardhat chain only."
    );
  }
  const provider = getProvider();
  const accounts = await provider.send("eth_accounts", []);
  if (!accounts[accountIndex]) {
    throw new Error(
      `No Hardhat account at index ${accountIndex}. Is the node running?`
    );
  }
  return provider.getSigner(accounts[accountIndex] as string);
}

/**
 * Server-side signer for a demo role. Prefers the env key; falls back to a
 * local Hardhat account only when dev signing is allowed.
 */
export async function getServerSigner(
  role: SignerRole,
  accountIndex?: number
): Promise<ethers.Signer> {
  const key = process.env[ROLE_KEY_ENV[role]];
  if (key) {
    return new ethers.Wallet(normalizeKey(key.trim()), getProvider());
  }
  return getDevSigner(accountIndex ?? ROLE_DEV_INDEX[role]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract instances (read-only)
// ─────────────────────────────────────────────────────────────────────────────

export function getProposalRegistry(): ethers.Contract {
  const { address, abi } = contractEntry("ProposalRegistry");
  return new ethers.Contract(address, abi, getProvider());
}

export function getIntentGovernor(): ethers.Contract {
  const { address, abi } = contractEntry("IntentGovernor");
  return new ethers.Contract(address, abi, getProvider());
}

export function getDisclosureRegistry(): ethers.Contract {
  const { address, abi } = contractEntry("DisclosureRegistry");
  return new ethers.Contract(address, abi, getProvider());
}

export function getIntentLockExecutor(): ethers.Contract {
  const { address, abi } = contractEntry("IntentLockExecutor");
  return new ethers.Contract(address, abi, getProvider());
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface ContractDiagnostic {
  name: string;
  address: string;
  hasCode: boolean;
}

export interface DemoProposalCheck {
  proposalId: string;
  title: string;
  govId: string | null;
  state: string;
  expectedCommitment: string | null;
  actualCommitment: string | null;
  commitmentMatch: boolean;
  expectedVersionCount: number;
  actualVersionCount: number;
  versionChainMatch: boolean;
  matched: boolean;
  reason?: string;
}

export interface DemoStateDiagnostics {
  checked: boolean;
  allMatched: boolean;
  proposals: DemoProposalCheck[];
  reason?: string;
}

export interface ChainDiagnostics {
  rpcReachable: boolean;
  chainId: number | null;
  chainIdMatch: boolean;
  contracts: ContractDiagnostic[];
  manifestChainId: number;
  rpcUrl: string;
  demoState: DemoStateDiagnostics;
}

export async function checkDemoStateMatchesChain(): Promise<DemoStateDiagnostics> {
  const demoPath = path.join(repoRoot(), "packages", "shared", "fixtures", "demo-state.json");
  if (!fs.existsSync(demoPath)) {
    return { checked: false, allMatched: false, proposals: [], reason: "demo-state.json not found" };
  }

  let demoState: Record<
    string,
    {
      title: string;
      govId: string | null;
      state: string;
      commitment: string | null;
      versionChain: string[];
      notes: string;
    }
  >;

  try {
    demoState = JSON.parse(fs.readFileSync(demoPath, "utf8"));
  } catch (err) {
    return {
      checked: false,
      allMatched: false,
      proposals: [],
      reason: `Failed to parse demo-state.json: ${String(err)}`,
    };
  }

  const checks: DemoProposalCheck[] = [];
  let allMatched = true;

  const reg = getProposalRegistry();
  const gov = getIntentGovernor();

  for (const [pidStr, entry] of Object.entries(demoState)) {
    const pid = BigInt(pidStr);
    let actualVersions: string[] = [];
    let actualCommitment: string | null = null;
    let versionChainMatch = false;
    let commitmentMatch = false;
    let reason: string | undefined;

    try {
      actualVersions = await reg.getVersionChain(pid);
      versionChainMatch =
        actualVersions.length === entry.versionChain.length &&
        actualVersions.every((v, i) => v.toLowerCase() === entry.versionChain[i]?.toLowerCase());
    } catch (err) {
      reason = `Failed reading version chain: ${String(err)}`;
    }

    if (entry.govId !== null) {
      try {
        const gid = BigInt(entry.govId);
        const p = await gov.getGovProposal(gid);
        actualCommitment = p.commitment;
        commitmentMatch =
          actualCommitment !== null &&
          entry.commitment !== null &&
          actualCommitment.toLowerCase() === entry.commitment.toLowerCase();
      } catch (err) {
        reason = (reason ? reason + "; " : "") + `Failed reading gov proposal: ${String(err)}`;
      }
    } else {
      commitmentMatch = entry.commitment === null;
    }

    const matched = versionChainMatch && commitmentMatch;
    if (!matched) allMatched = false;

    checks.push({
      proposalId: pidStr,
      title: entry.title,
      govId: entry.govId,
      state: entry.state,
      expectedCommitment: entry.commitment,
      actualCommitment,
      commitmentMatch,
      expectedVersionCount: entry.versionChain.length,
      actualVersionCount: actualVersions.length,
      versionChainMatch,
      matched,
      reason,
    });
  }

  return { checked: true, allMatched, proposals: checks };
}

export async function getChainDiagnostics(): Promise<ChainDiagnostics> {
  let rpcUrl = "";
  try {
    rpcUrl = getRpcUrl();
  } catch {
    rpcUrl = "(unconfigured)";
  }
  let rpcReachable = false;
  let chainId: number | null = null;

  try {
    const provider = getProvider();
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
    rpcReachable = true;
  } catch {
    // fall through — rpcReachable stays false
  }

  let manifest: Manifest | null = null;
  let contracts: ContractDiagnostic[] = [];
  let manifestChainId = 0;

  try {
    manifest = loadManifest();
    manifestChainId = manifest.chainId;
    if (rpcReachable) {
      contracts = await Promise.all(
        Object.entries(manifest.contracts).map(async ([name, entry]) => {
          let hasCode = false;
          try {
            const code = await getProvider().getCode(entry.address);
            hasCode = code !== "0x";
          } catch {
            // leave false
          }
          return { name, address: entry.address, hasCode };
        })
      );
    } else {
      contracts = Object.entries(manifest.contracts).map(([name, entry]) => ({
        name,
        address: entry.address,
        hasCode: false,
      }));
    }
  } catch {
    // manifest missing
  }

  let demoState: DemoStateDiagnostics = {
    checked: false,
    allMatched: false,
    proposals: [],
    reason: "RPC not reachable",
  };

  if (rpcReachable) {
    try {
      demoState = await checkDemoStateMatchesChain();
    } catch (err) {
      demoState = { checked: false, allMatched: false, proposals: [], reason: String(err) };
    }
  }

  return {
    rpcReachable,
    chainId,
    chainIdMatch: chainId !== null && chainId === manifestChainId,
    contracts,
    manifestChainId,
    rpcUrl,
    demoState,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error decoding
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedError {
  selector: string;
  title: string;
  explanation: string;
  signature: string;
}

type ErrorCatalog = Record<string, { title: string; explanation: string; signature: string; contract: string }>;

let _errorCatalog: ErrorCatalog | null = null;
function errorCatalog(): ErrorCatalog {
  if (_errorCatalog) return _errorCatalog;
  try {
    const errPath = path.join(repoRoot(), "app", "lib", "mocks", "errors.json");
    _errorCatalog = JSON.parse(fs.readFileSync(errPath, "utf8")) as ErrorCatalog;
  } catch {
    _errorCatalog = {};
  }
  return _errorCatalog;
}

/**
 * Decode a revert data hex string to a human-readable error.
 * Falls back to "UNKNOWN ERROR 0x..." — never swallows.
 */
export function decodeRevert(revertData: string): DecodedError {
  const selector = revertData.slice(0, 10).toLowerCase();
  const catalog = errorCatalog();
  const known = catalog[selector];
  if (known) {
    return {
      selector,
      title: known.title,
      explanation: known.explanation,
      signature: known.signature,
    };
  }

  // Try executor ABI error fragments
  try {
    const { abi } = contractEntry("IntentLockExecutor");
    const iface = new ethers.Interface(abi);
    const parsed = iface.parseError(revertData);
    if (parsed) {
      return {
        selector,
        title: parsed.name,
        explanation: `Args: ${parsed.args.join(", ")}`,
        signature: parsed.signature,
      };
    }
  } catch {
    // ignore
  }

  return {
    selector,
    title: `UNKNOWN ERROR ${selector}`,
    explanation: `Raw revert data: ${revertData}`,
    signature: selector,
  };
}

/**
 * app/lib/explorer.ts
 *
 * Client-safe chain display helpers. Contains no Node imports, so both server
 * routes and client components can use it. NEXT_PUBLIC_CHAIN_ID is inlined by
 * Next.js at build time.
 */

const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337";

const EXPLORERS: Record<string, string> = {
  "1": "https://etherscan.io",
  "11155111": "https://sepolia.etherscan.io",
};

export const APP_CHAIN_ID = Number(CHAIN_ID);

export function explorerBaseUrl(): string | null {
  return EXPLORERS[CHAIN_ID] ?? null;
}

export function chainLabel(): string {
  if (CHAIN_ID === "11155111") return "Sepolia testnet";
  if (CHAIN_ID === "31337") return "Local Hardhat";
  if (CHAIN_ID === "1") return "Ethereum mainnet";
  return `Chain ${CHAIN_ID}`;
}

export function explorerTxUrl(hash?: string | null): string | null {
  if (!hash) return null;
  const base = explorerBaseUrl() ?? "https://sepolia.etherscan.io";
  return `${base}/tx/${hash}`;
}

export function explorerAddressUrl(address?: string | null): string | null {
  const base = explorerBaseUrl();
  if (!base || !address) return null;
  if (/^0x0{40}$/i.test(address)) return null;
  return `${base}/address/${address}`;
}

export function explorerBlockUrl(block?: number | string | null): string | null {
  const base = explorerBaseUrl();
  return base && block !== null && block !== undefined && block !== ""
    ? `${base}/block/${block}`
    : null;
}

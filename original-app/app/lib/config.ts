import type { DataMode } from "./types";

export const DATA_MODE: DataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";

export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337";

/** Human-readable chain tag shown in the console shell. */
export const CHAIN_NAME =
  CHAIN_ID === "11155111"
    ? "Sepolia testnet"
    : CHAIN_ID === "31337"
      ? "Local Hardhat"
      : `Chain ${CHAIN_ID}`;

export const IS_SEPOLIA = CHAIN_ID === "11155111";

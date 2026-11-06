import { formatUnits } from "viem";

const USDC_DECIMALS = 6;
const UNLIMITED_THRESHOLD = 10n ** 15n;

export function formatTokenAmount(value: string | bigint): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount >= UNLIMITED_THRESHOLD) return "unlimited";
  const asNumber = Number(formatUnits(amount, USDC_DECIMALS));
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(asNumber);
}

export function formatUsdc(value: string | bigint): string {
  return `${formatTokenAmount(value)} USDC`;
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function shortHex(value: string, visible = 6): string {
  if (!value) return "";
  if (value.length <= visible * 2 + 2) return value;
  return `${value.slice(0, visible + 2)}…${value.slice(-visible)}`;
}

export function shortAddress(value: string): string {
  return shortHex(value, 4);
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

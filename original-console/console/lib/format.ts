export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function truncateMiddle(value: string, lead = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function shortAddress(value: string): string {
  return truncateMiddle(value, 8, 4);
}

export function formatDuration(ms: number): string {
  return `${ms.toLocaleString("en-US")} ms`;
}

export function formatPct(score: number | null, digits = 0): string {
  if (score === null || !Number.isFinite(score)) return "—";
  return `${(score * 100).toFixed(digits)}%`;
}

export function formatTokenUnits(value: string, decimals = 18): string {
  try {
    const n = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = n % base;
    if (frac === 0n) return whole.toLocaleString("en-US");
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toLocaleString("en-US")}.${fracStr}`;
  } catch {
    return value;
  }
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function ratioPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

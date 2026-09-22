/** Presentation helpers. Every amount stays a string of raw integer units end to end; nothing here parses one
 * into a JavaScript number, so a display value can never silently lose precision. */

/** Exact 6-decimal display of a raw USDC amount, from a decimal-string raw value. */
export function usdc(rawRaw: string): string {
  const v = BigInt(rawRaw);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** A raw/display pair as the API returns it, or one built locally from a raw string. */
export interface AmountPair {
  readonly raw: string;
  readonly usdc: string;
}
export const amountPair = (raw: string): AmountPair => ({ raw, usdc: usdc(raw) });

const SHORT_LEN = 4;
/** `Ab3d…Xy9z`. Always paired with the full address (title attribute, copy button) where it appears. */
export function shortAddress(address: string): string {
  if (address.length <= SHORT_LEN * 2 + 1) return address;
  return `${address.slice(0, SHORT_LEN)}…${address.slice(-SHORT_LEN)}`;
}

/** Unix seconds (as a string, since chain timestamps are i64) to a locale date-time string. */
export function formatUnixSeconds(seconds: string | number | bigint): string {
  const n = typeof seconds === "bigint" ? seconds : BigInt(seconds);
  return new Date(Number(n) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A short "in 2h 30m" / "3d ago" style label for a unix-seconds instant, relative to now. */
export function relativeToNow(seconds: string | number | bigint, now: Date = new Date()): string {
  const n = typeof seconds === "bigint" ? seconds : BigInt(seconds);
  const deltaSeconds = n - BigInt(Math.floor(now.getTime() / 1000));
  const future = deltaSeconds >= 0n;
  const abs = future ? deltaSeconds : -deltaSeconds;
  const units: readonly [string, bigint][] = [
    ["d", 86_400n],
    ["h", 3_600n],
    ["m", 60n],
  ];
  const parts: string[] = [];
  let remaining = abs;
  for (const [label, size] of units) {
    if (remaining >= size && parts.length < 2) {
      parts.push(`${(remaining / size).toString()}${label}`);
      remaining %= size;
    }
  }
  const text = parts.length > 0 ? parts.join(" ") : "<1m";
  return future ? `in ${text}` : `${text} ago`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDurationSeconds(seconds: string | number | bigint): string {
  const n = typeof seconds === "bigint" ? seconds : BigInt(seconds);
  const days = n / 86_400n;
  const hours = (n % 86_400n) / 3_600n;
  const minutes = (n % 3_600n) / 60n;
  const parts: string[] = [];
  if (days > 0n) parts.push(`${days.toString()}d`);
  if (hours > 0n) parts.push(`${hours.toString()}h`);
  if (minutes > 0n || parts.length === 0) parts.push(`${minutes.toString()}m`);
  return parts.join(" ");
}

export const EPOCH_OUTCOME_LABEL: Record<string, string> = {
  Compliant: "Compliant",
  NonCompliant: "Non-compliant",
  Unavailable: "Unavailable (not measured)",
  Pending: "Pending",
};

export const MANDATE_STATUS_LABEL: Record<string, string> = {
  Bidding: "Open for bids",
  Awarded: "Awarded, not yet started",
  Active: "Active",
  AwaitingFinalization: "Awaiting final settlement",
  Closed: "Closed",
  Cancelled: "Cancelled",
};

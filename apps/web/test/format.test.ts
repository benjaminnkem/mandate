import { describe, expect, it } from "vitest";

import {
  amountPair,
  formatBps,
  formatDurationSeconds,
  formatUnixSeconds,
  relativeToNow,
  shortAddress,
  usdc,
} from "../lib/format.ts";

describe("usdc", () => {
  it("renders exact 6-decimal amounts from raw integer strings, never through a float", () => {
    expect(usdc("0")).toBe("0.000000");
    expect(usdc("1000000")).toBe("1.000000");
    expect(usdc("1")).toBe("0.000001");
    expect(usdc("18446744073709551615")).toBe("18446744073709.551615"); // u64::MAX, exact
  });

  it("handles negative amounts", () => {
    expect(usdc("-1500000")).toBe("-1.500000");
  });

  it("amountPair carries both the raw string and the display value", () => {
    expect(amountPair("12500000")).toEqual({ raw: "12500000", usdc: "12.500000" });
  });
});

describe("shortAddress", () => {
  it("shortens a long address to its first and last four characters", () => {
    expect(shortAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("EPjF…Dt1v");
    expect(shortAddress("abc")).toBe("abc");
  });

  it("never drops characters for an address at the shortening boundary", () => {
    const nineChars = "123456789";
    expect(shortAddress(nineChars)).toBe(nineChars);
  });
});

describe("formatBps", () => {
  it("converts basis points to a percentage", () => {
    expect(formatBps(0)).toBe("0.00%");
    expect(formatBps(400)).toBe("4.00%");
    expect(formatBps(20_000)).toBe("200.00%");
  });
});

describe("formatDurationSeconds", () => {
  it("shows the coarsest useful units", () => {
    expect(formatDurationSeconds(90)).toBe("1m");
    expect(formatDurationSeconds(3_660)).toBe("1h 1m");
    expect(formatDurationSeconds(90_000)).toBe("1d 1h");
    expect(formatDurationSeconds(0)).toBe("0m");
  });
});

describe("formatUnixSeconds / relativeToNow", () => {
  it("formats an absolute instant", () => {
    expect(formatUnixSeconds(0)).toContain("1970");
  });

  it("describes future and past instants relative to a fixed now", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nowSeconds = Math.floor(now.getTime() / 1000);
    expect(relativeToNow(nowSeconds + 3_600, now)).toBe("in 1h");
    expect(relativeToNow(nowSeconds - 3_600, now)).toBe("1h ago");
    expect(relativeToNow(nowSeconds + 30, now)).toBe("in <1m");
    expect(relativeToNow(nowSeconds, now)).toBe("in <1m");
  });
});

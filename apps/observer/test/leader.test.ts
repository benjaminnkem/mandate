import { describe, expect, it } from "vitest";

import { leaderActsAt, leaderOrder, leaderRank, timingFits } from "../src/leader.ts";

const SET = ["A", "B", "C"] as const;

describe("leader rotation", () => {
  it("rotates the observer-set order by epoch and is a permutation each time", () => {
    expect(leaderOrder(0, SET)).toEqual(["A", "B", "C"]);
    expect(leaderOrder(1, SET)).toEqual(["B", "C", "A"]);
    expect(leaderOrder(2, SET)).toEqual(["C", "A", "B"]);
    expect(leaderOrder(3, SET)).toEqual(["A", "B", "C"]);
    for (let epoch = 0; epoch < 50; epoch += 1)
      expect([...leaderOrder(epoch, SET)].sort()).toEqual(["A", "B", "C"]);
  });

  it("gives every observer the same primary-leader share over time", () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let epoch = 0; epoch < 300; epoch += 1)
      counts[leaderOrder(epoch, SET)[0] ?? ""] =
        (counts[leaderOrder(epoch, SET)[0] ?? ""] ?? 0) + 1;
    expect(counts).toEqual({ A: 100, B: 100, C: 100 });
  });

  it("has exactly one primary leader and unique ranks, so observers never both act first", () => {
    for (let epoch = 0; epoch < 20; epoch += 1) {
      const ranks = SET.map((o) => leaderRank(epoch, SET, o));
      expect([...ranks].sort()).toEqual([0, 1, 2]);
    }
  });

  it("agrees across observers because it depends only on the epoch and the set", () => {
    const seenByEach = SET.map(() => leaderOrder(7, SET).join(","));
    expect(new Set(seenByEach).size).toBe(1);
  });

  it("handles single-observer sets and rejects empty ones and strangers", () => {
    expect(leaderOrder(5, ["ONLY"])).toEqual(["ONLY"]);
    expect(() => leaderOrder(0, [])).toThrow(RangeError);
    expect(() => leaderRank(0, SET, "Z")).toThrow(/not in the observer set/);
  });
});

describe("leader timing", () => {
  const timing = { observeLeadSeconds: 60, leaderTimeoutSeconds: 15 };

  it("schedules each rank one timeout after the previous, starting before the epoch ends", () => {
    const end = 1_000_000;
    expect([0, 1, 2].map((r) => leaderActsAt(end, r, timing))).toEqual([
      end - 60,
      end - 45,
      end - 30,
    ]);
  });

  it("accepts only timings where the last rank still acts before the epoch ends", () => {
    expect(timingFits(3, timing)).toBe(true);
    expect(timingFits(4, timing)).toBe(true); // last rank acts 15s before the end
    expect(timingFits(5, timing)).toBe(false); // last rank would act exactly at the end: too late
    expect(timingFits(1, timing)).toBe(true);
    expect(timingFits(3, { observeLeadSeconds: 30, leaderTimeoutSeconds: 15 })).toBe(false);
    expect(timingFits(2, { observeLeadSeconds: 30, leaderTimeoutSeconds: 15 })).toBe(true);
    expect(timingFits(3, { observeLeadSeconds: 0, leaderTimeoutSeconds: 1 })).toBe(false);
    expect(timingFits(3, { observeLeadSeconds: 60, leaderTimeoutSeconds: 0 })).toBe(false);
  });
});

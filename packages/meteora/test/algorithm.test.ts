import { describe, expect, it } from "vitest";

import {
  MeasurementError,
  SEARCH_CAP_QUOTE_RAW,
  bandBinRange,
  baseToQuoteEquivalent,
  computeProviderContribution,
  effectiveSpreadBps,
  evaluateBuy,
  evaluateSell,
  measureQuality,
  type PositionInput,
} from "../src/index.ts";
import { constantProductEngine, counting } from "./synthetic-engine.ts";

// Every fixture in this file is labelled TEST FIXTURE: synthetic numbers, never market data.

describe("effective spread", () => {
  it("matches hand-calculated values", () => {
    // Real probe from docs/research/current-market.md (10 USDC buy, sell back): 2*247702*10000/19752298 = 250.8 -> 251
    expect(effectiveSpreadBps(10_000_000n, 9_752_298n)).toBe(251n);
    expect(effectiveSpreadBps(100n, 99n)).toBe(101n); // 2*1*10000/199 = 100.5 -> ceil 101
    expect(effectiveSpreadBps(100n, 100n)).toBe(0n);
    expect(effectiveSpreadBps(1n, 1n)).toBe(0n);
    expect(effectiveSpreadBps(3n, 1n)).toBe(10_000n); // 2*2*10000/4
  });

  it("is symmetric in its arguments and rounds up on any remainder", () => {
    expect(effectiveSpreadBps(9_752_298n, 10_000_000n)).toBe(251n);
    // exact division: 2*5*10000/(100+100-...)? use Q0=1000,S0=950 -> 2*50*10000/1950 = 512.82 -> 513
    expect(effectiveSpreadBps(1000n, 950n)).toBe(513n);
    // exactly divisible case: Q0=300,S0=100 -> 2*200*10000/400 = 10000
    expect(effectiveSpreadBps(300n, 100n)).toBe(10_000n);
  });

  it("uses widened arithmetic for u64-sized inputs", () => {
    const max = 18_446_744_073_709_551_615n;
    expect(effectiveSpreadBps(max, max)).toBe(0n);
    expect(effectiveSpreadBps(max, 1n)).toBe(20_000n); // 20000 * (1 - 2/(max+1)) rounds up to exactly 20000
  });

  it("rejects non-positive probes", () => {
    expect(() => effectiveSpreadBps(0n, 5n)).toThrow(MeasurementError);
    expect(() => effectiveSpreadBps(5n, 0n)).toThrow(MeasurementError);
  });
});

describe("band to bin range", () => {
  it("matches hand-calculated ranges", () => {
    // step 50 bps, band 500 bps: 1.005^9 = 1.0458 <= 1.05 < 1.005^10 ; 1.005^-10 = 0.9514 >= 0.95 > 1.005^-11
    expect(bandBinRange(100, 50, 500n)).toMatchObject({
      binsAbove: 9,
      binsBelow: 10,
      lowerBinId: 90,
      upperBinId: 109,
    });
  });

  it("includes a bin sitting exactly on the boundary", () => {
    // 1% step, 1% band: 1.01^1 == 1.01 exactly -> included above
    expect(bandBinRange(0, 100, 100n).binsAbove).toBe(1);
    // 1 bps step, 1 bps band
    expect(bandBinRange(0, 1, 1n).binsAbove).toBe(1);
    expect(bandBinRange(0, 1, 1n).binsBelow).toBe(1); // 1/1.0001 = 0.99990001 >= 0.9999, but 1/1.0001^2 = 0.99980003 < 0.9999
  });

  it("handles negative and large active ids", () => {
    const r = bandBinRange(-500, 25, 200n);
    expect(r.lowerBinId).toBe(-500 - r.binsBelow);
    expect(r.upperBinId).toBe(-500 + r.binsAbove);
  });

  it("agrees with an independent power-based check across many parameters", () => {
    const b = 10_000n;
    for (const step of [1, 2, 5, 10, 15, 20, 25, 50, 80, 100, 125, 160, 200, 400]) {
      for (const band of [1n, 5n, 25n, 100n, 250n, 500n, 1000n, 2000n]) {
        const s = BigInt(step);
        const r = bandBinRange(0, step, band);
        const ok = (k: number, up: boolean): boolean =>
          up
            ? (b + s) ** BigInt(k) * b <= (b + band) * b ** BigInt(k)
            : b ** BigInt(k) * b >= (b - band) * (b + s) ** BigInt(k);
        expect(ok(r.binsAbove, true)).toBe(true);
        expect(ok(r.binsAbove + 1, true)).toBe(false);
        expect(ok(r.binsBelow, false)).toBe(true);
        expect(ok(r.binsBelow + 1, false)).toBe(false);
      }
    }
  });

  it("rejects degenerate parameters", () => {
    expect(() => bandBinRange(0, 0, 100n)).toThrow(MeasurementError);
    expect(() => bandBinRange(0, 50, 0n)).toThrow(MeasurementError);
    expect(() => bandBinRange(0, 50, 10_000n)).toThrow(MeasurementError);
    expect(() => bandBinRange(0.5, 50, 100n)).toThrow(MeasurementError);
  });
});

describe("depth evaluation", () => {
  const engine = constantProductEngine({
    baseReserve: 1_000_000n,
    quoteReserve: 1_000_000n,
    feeBps: 30n,
  });
  const q0 = 1_000n;
  const b0 = engine.buy(q0)?.out ?? 0n;

  it("passes the baseline probe itself and fails once impact exceeds the band", () => {
    expect(evaluateBuy(engine, q0, b0, 100n, q0).pass).toBe(true);
    expect(evaluateBuy(engine, q0, b0, 100n, 500_000n)).toMatchObject({
      pass: false,
      reason: "ImpactExceeded",
    });
  });

  it("rejects partial fills as non-consumable even if the partial fill price is fine", () => {
    const limited = constantProductEngine({
      baseReserve: 1_000_000n,
      quoteReserve: 1_000_000n,
      feeBps: 30n,
      maxQuoteIn: 5_000n,
    });
    expect(evaluateBuy(limited, q0, b0, 10_000n, 6_000n)).toMatchObject({
      pass: false,
      reason: "NotFullyConsumed",
    });
    expect(evaluateBuy(limited, q0, b0, 10_000n, 5_000n).pass).toBe(true);
  });

  it("treats an unquotable size as a failure", () => {
    const none = { buy: () => null, sell: () => null };
    expect(evaluateBuy(none, q0, b0, 100n, 10n)).toMatchObject({
      pass: false,
      reason: "Unquotable",
    });
    expect(evaluateSell(none, b0, 1n, 100n, 10n)).toMatchObject({
      pass: false,
      reason: "Unquotable",
    });
  });

  it("sell evaluation is exact at the boundary: equality passes, one unit worse fails", () => {
    // Fake sell engine with a fixed price: out = floor(baseIn * 9 / 10). Baseline S0/B0 = 9/10.
    const fixed = {
      buy: () => null,
      sell: (b: bigint) => ({ consumedIn: b, out: (b * 9n) / 10n }),
    };
    expect(evaluateSell(fixed, 10n, 9n, 0n, 100n).pass).toBe(true); // equal price, 0 bps band
    const worse = {
      buy: () => null,
      sell: (b: bigint) => ({ consumedIn: b, out: (b * 9n) / 10n - 1n }),
    };
    expect(evaluateSell(worse, 10n, 9n, 0n, 100n)).toMatchObject({
      pass: false,
      reason: "ImpactExceeded",
    });
    // out = 89 for base 100 versus a baseline of 90: 0.89 / 0.90 is 111.1 bps worse.
    expect(evaluateSell(worse, 10n, 9n, 112n, 100n).pass).toBe(true);
    expect(evaluateSell(worse, 10n, 9n, 111n, 100n).pass).toBe(false);
  });
});

describe("full measurement on a synthetic venue", () => {
  const baseInputs = {
    pool: "POOL",
    provider: "PROVIDER",
    baseIsX: true,
    activeId: 100,
    binStep: 50,
    positions: [] as PositionInput[],
  };

  it("finds a true pass/fail boundary for buy and sell across venues and bands", () => {
    // Realistic raw-unit scales, where floor rounding is far below the impact band. At tiny scales
    // rounding can exceed the band and make the predicate non-monotone; the procedure still returns a
    // bracket with pass(x) and fail(x + 1), which is what the first two assertions check.
    for (const reserve of [10_000_000n, 1_000_000_000n, 100_000_000_000n]) {
      for (const fee of [0n, 30n, 100n]) {
        for (const band of [100n, 500n, 2000n]) {
          const engine = constantProductEngine({
            baseReserve: reserve,
            quoteReserve: reserve,
            feeBps: fee,
          });
          const q0 = reserve / 500n;
          const result = measureQuality({
            ...baseInputs,
            engine,
            probeQuoteRaw: q0,
            depthBandBps: band,
          });
          const { b0, s0 } = result.probe;
          const buy = result.buyDepth.passingInput;
          const sell = result.sellDepth.passingInput;

          expect(evaluateBuy(engine, q0, b0, band, buy).pass).toBe(true);
          expect(evaluateBuy(engine, q0, b0, band, buy + 1n).pass).toBe(false);
          expect(evaluateSell(engine, b0, s0, band, sell).pass).toBe(true);
          expect(evaluateSell(engine, b0, s0, band, sell + 1n).pass).toBe(false);

          // coarse monotonicity around the boundary, far above rounding noise
          expect(evaluateBuy(engine, q0, b0, band, (buy * 9n) / 10n).pass).toBe(true);
          expect(evaluateBuy(engine, q0, b0, band, (buy * 11n) / 10n).pass).toBe(false);
          expect(evaluateSell(engine, b0, s0, band, (sell * 9n) / 10n).pass).toBe(true);
          expect(evaluateSell(engine, b0, s0, band, (sell * 11n) / 10n).pass).toBe(false);

          expect(result.metrics.poolBuyDepthQuoteRaw).toBe(buy);
          expect(result.metrics.poolSellDepthQuoteRaw).toBe(result.sellDepth.passingOut);
          expect(result.buyDepth.capReached).toBe(false);
        }
      }
    }
  });

  it("matches the closed-form boundary of a zero-fee constant-product venue", () => {
    // Zero fee, reserves R: buying Q of quote gives out = R*Q/(R+Q), average price (R+Q)/R.
    // Baseline probe Q0 has average price 1 + Q0/R, so impact within `band` of it means
    // 1 + Q/R <= (1 + Q0/R)(1 + band/10_000), i.e. Q <= (R + Q0)(10_000 + band)/10_000 - R (up to rounding of out).
    const reserve = 1_000_000_000_000n;
    const band = 250n;
    const engine = constantProductEngine({
      baseReserve: reserve,
      quoteReserve: reserve,
      feeBps: 0n,
    });
    const r = measureQuality({
      ...baseInputs,
      engine,
      probeQuoteRaw: 1_000_000n,
      depthBandBps: band,
    });
    const closedForm = ((reserve + 1_000_000n) * (10_000n + band)) / 10_000n - reserve;
    const diff =
      r.metrics.poolBuyDepthQuoteRaw > closedForm
        ? r.metrics.poolBuyDepthQuoteRaw - closedForm
        : closedForm - r.metrics.poolBuyDepthQuoteRaw;
    expect(diff * 1_000_000n).toBeLessThan(closedForm); // within 0.0001%
  });

  it("reports the depth boundary proof", () => {
    const engine = constantProductEngine({
      baseReserve: 100_000n,
      quoteReserve: 100_000n,
      feeBps: 30n,
    });
    const r = measureQuality({ ...baseInputs, engine, probeQuoteRaw: 200n, depthBandBps: 100n });
    expect(r.buyDepth.passingOut).toBeGreaterThan(0n);
    expect(r.buyDepth.failingReason).toBe("ImpactExceeded");
    expect(r.sellDepth.failingReason).toBe("ImpactExceeded");
  });

  it("stops at a partial-fill limit: depth equals the largest fully consumable size", () => {
    const engine = constantProductEngine({
      baseReserve: 1_000_000n,
      quoteReserve: 1_000_000n,
      feeBps: 30n,
      maxQuoteIn: 7_777n,
    });
    const r = measureQuality({ ...baseInputs, engine, probeQuoteRaw: 100n, depthBandBps: 5000n });
    expect(r.metrics.poolBuyDepthQuoteRaw).toBe(7_777n);
    expect(r.buyDepth.failingReason).toBe("NotFullyConsumed");
  });

  it("reports the search cap when liquidity never runs out", () => {
    const huge = 10n ** 40n;
    const engine = constantProductEngine({ baseReserve: huge, quoteReserve: huge, feeBps: 0n });
    const r = measureQuality({
      ...baseInputs,
      engine,
      probeQuoteRaw: 1_000n,
      depthBandBps: 9_000n,
    });
    expect(r.buyDepth.capReached).toBe(true);
    expect(r.metrics.poolBuyDepthQuoteRaw).toBe(SEARCH_CAP_QUOTE_RAW);
    expect(r.buyDepth.failingInput).toBeNull();
  });

  it("bounds the number of venue calls", () => {
    const counted = counting(
      constantProductEngine({ baseReserve: 10n ** 12n, quoteReserve: 10n ** 12n, feeBps: 30n }),
    );
    measureQuality({ ...baseInputs, engine: counted, probeQuoteRaw: 1_000n, depthBandBps: 500n });
    expect(counted.calls()).toBeLessThan(2 + 2 * (48 + 64 + 2));
  });

  it("throws probe errors instead of producing a metric when the venue cannot quote", () => {
    const noBuy = { buy: () => null, sell: () => null };
    expect(() =>
      measureQuality({ ...baseInputs, engine: noBuy, probeQuoteRaw: 100n, depthBandBps: 100n }),
    ).toThrow(/BuyProbeUnavailable/);
    const partialBuy = { buy: (q: bigint) => ({ consumedIn: q - 1n, out: 5n }), sell: () => null };
    expect(() =>
      measureQuality({
        ...baseInputs,
        engine: partialBuy,
        probeQuoteRaw: 100n,
        depthBandBps: 100n,
      }),
    ).toThrow(/BuyProbeUnavailable/);
    const noSell = { buy: (q: bigint) => ({ consumedIn: q, out: 5n }), sell: () => null };
    expect(() =>
      measureQuality({ ...baseInputs, engine: noSell, probeQuoteRaw: 100n, depthBandBps: 100n }),
    ).toThrow(/SellProbeUnavailable/);
    const zeroBuy = { buy: (q: bigint) => ({ consumedIn: q, out: 0n }), sell: () => null };
    expect(() =>
      measureQuality({ ...baseInputs, engine: zeroBuy, probeQuoteRaw: 100n, depthBandBps: 100n }),
    ).toThrow(/BuyProbeUnavailable/);
  });

  it("is deterministic: 150 repeated runs produce identical output", () => {
    const engine = constantProductEngine({
      baseReserve: 5_000_000n,
      quoteReserve: 7_000_000n,
      feeBps: 45n,
    });
    const render = (): string =>
      JSON.stringify(
        measureQuality({ ...baseInputs, engine, probeQuoteRaw: 12_345n, depthBandBps: 300n }),
        (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
      );
    const first = render();
    for (let i = 0; i < 150; i += 1) expect(render()).toBe(first);
  });
});

describe("provider contribution", () => {
  const band = { lowerBinId: 95, upperBinId: 105 };
  const common = { pool: "POOL", provider: "ME", baseIsX: true, activeId: 100, ...band };
  const pos = (
    address: string,
    bins: [number, bigint, bigint][],
    over: Partial<Extract<PositionInput, { kind: "loaded" }>> = {},
  ): PositionInput => ({
    kind: "loaded",
    address,
    lbPair: "POOL",
    owner: "ME",
    operator: "ME",
    feeOwner: "ME",
    lowerBinId: Math.min(...bins.map((b) => b[0])),
    upperBinId: Math.max(...bins.map((b) => b[0])),
    bins: bins.map(([binId, xAmount, yAmount]) => ({ binId, xAmount, yAmount })),
    ...over,
  });

  it("sums quote and base inside the band for one position", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [
        pos("P1", [
          [95, 0n, 10n],
          [100, 5n, 7n],
          [105, 9n, 0n],
        ]),
      ],
    });
    expect(r.quoteInBandRaw).toBe(17n);
    expect(r.baseInBandRaw).toBe(14n);
    expect(r.perPosition[0]).toMatchObject({
      verdict: "Counted",
      binsInBand: 3,
      coversActiveBin: true,
    });
  });

  it("includes bins exactly on the boundary and excludes bins one step outside", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [
        pos("P1", [
          [94, 100n, 100n],
          [95, 1n, 1n],
          [105, 2n, 2n],
          [106, 100n, 100n],
        ]),
      ],
    });
    expect(r.quoteInBandRaw).toBe(3n);
    expect(r.baseInBandRaw).toBe(3n);
  });

  it("adds several positions together", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [
        pos("P1", [[100, 1n, 2n]]),
        pos("P2", [[101, 3n, 4n]]),
        pos("P3", [[102, 5n, 6n]]),
      ],
    });
    expect(r.baseInBandRaw).toBe(9n);
    expect(r.quoteInBandRaw).toBe(12n);
  });

  it("handles one-sided positions: only quote, only base", () => {
    const quoteOnly = computeProviderContribution({
      ...common,
      positions: [pos("Q", [[97, 0n, 50n]])],
    });
    expect(quoteOnly).toMatchObject({ quoteInBandRaw: 50n, baseInBandRaw: 0n });
    const baseOnly = computeProviderContribution({
      ...common,
      positions: [pos("B", [[103, 50n, 0n]])],
    });
    expect(baseOnly).toMatchObject({ quoteInBandRaw: 0n, baseInBandRaw: 50n });
  });

  it("gives identical economic results when token X and Y are swapped (orientation)", () => {
    const xy = computeProviderContribution({
      ...common,
      baseIsX: true,
      positions: [
        pos("P", [
          [99, 7n, 11n],
          [101, 13n, 17n],
        ]),
      ],
    });
    const yx = computeProviderContribution({
      ...common,
      baseIsX: false,
      positions: [
        pos("P", [
          [99, 11n, 7n],
          [101, 17n, 13n],
        ]),
      ],
    });
    expect(yx.quoteInBandRaw).toBe(xy.quoteInBandRaw);
    expect(yx.baseInBandRaw).toBe(xy.baseInBandRaw);
  });

  it("counts a missing (closed) position as zero and says why", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [{ kind: "missing", address: "GONE" }, pos("P", [[100, 1n, 1n]])],
    });
    expect(r.baseInBandRaw).toBe(1n);
    expect(r.perPosition[0]).toMatchObject({ verdict: "ExcludedMissing", quoteInBandRaw: 0n });
  });

  it("excludes positions on the wrong pool", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [pos("W", [[100, 99n, 99n]], { lbPair: "OTHER" })],
    });
    expect(r.perPosition[0]?.verdict).toBe("ExcludedWrongPool");
    expect(r.baseInBandRaw).toBe(0n);
  });

  it("excludes positions owned by someone else, even when the provider is the fee owner", () => {
    const r = computeProviderContribution({
      ...common,
      positions: [pos("O", [[100, 99n, 99n]], { owner: "THEM", feeOwner: "ME" })],
    });
    expect(r.perPosition[0]?.verdict).toBe("ExcludedOwnerMismatch");
    expect(r.quoteInBandRaw).toBe(0n);
  });

  it("rejects a duplicated registered position outright", () => {
    expect(() =>
      computeProviderContribution({
        ...common,
        positions: [pos("D", [[100, 1n, 1n]]), pos("D", [[100, 1n, 1n]])],
      }),
    ).toThrow(/DuplicatePosition/);
  });

  it("reports an empty position set as zero, not an error", () => {
    const r = computeProviderContribution({ ...common, positions: [] });
    expect(r).toMatchObject({ quoteInBandRaw: 0n, baseInBandRaw: 0n, perPosition: [] });
  });

  it("does not credit a broad position for bins outside the band", () => {
    const bins: [number, bigint, bigint][] = Array.from({ length: 200 }, (_, i) => [i, 1n, 1n]);
    const r = computeProviderContribution({ ...common, positions: [pos("WIDE", bins)] });
    expect(r.baseInBandRaw).toBe(11n); // bins 95..105
  });
});

describe("base to quote-equivalent conversion", () => {
  it("floors exactly", () => {
    expect(baseToQuoteEquivalent(1n, 10n, 9n, 2n)).toBe(4n); // floor(1*19/4)
    expect(baseToQuoteEquivalent(0n, 10n, 9n, 2n)).toBe(0n);
    expect(baseToQuoteEquivalent(4n, 10n, 10n, 2n)).toBe(20n); // 4 * 20 / 4, exact
  });

  it("does not overflow on u64-sized inputs", () => {
    const max = 18_446_744_073_709_551_615n;
    expect(baseToQuoteEquivalent(max, max, max, 1n)).toBe((max * 2n * max) / 2n);
  });

  it("rejects a zero base probe", () => {
    expect(() => baseToQuoteEquivalent(1n, 1n, 1n, 0n)).toThrow(MeasurementError);
  });
});

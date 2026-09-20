import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ReplaySource,
  assessPosition,
  assessSet,
  inspectPositionsForRegistration,
  type AccountSnapshot,
  type AssessContext,
  type PositionInput,
  UnobservableError,
} from "../src/index.ts";

// REAL mainnet-beta account state, captured atomically at one slot. See test/fixtures/README.md.
const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/openai-usdc-mainnet.snapshot.json", import.meta.url), "utf8"),
) as AccountSnapshot;

const POOL = "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH";
const BASE = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PROVIDER = "2KmmUnQ6nscD7j6siUjZMbDoT1u6jnjfZWF386CcRjak";
const OWN = [
  "2Ymo1bMvEQsTcErk5tEEYRZ8kKG5wNCRBbWvP8YnixNU",
  "7UXQYfYALyUDKQPaPSTj7kuRdbPyc3oNkxyVtTEFqjhR",
  "B8BhNDnc6HePLdjn6grmYpoM7AiCsKzQqVjbtrpSztdE",
];
const OTHER_OWNERS = "3gRmvT4D9viEtEbFo4QDnDk7THnTXaLstYFBoffkc1qn";
const NONEXISTENT = "Fz1XcAr1fxKcJZsJpHfj8sXpXnBz5L9m6z3Zy1xq2vQp";

const base = {
  pool: POOL,
  baseMint: BASE,
  quoteMint: USDC,
  provider: PROVIDER,
  maxPositions: 8,
  depthBandBps: 500n,
};
const inspect = (
  positions: string[],
  over: Partial<Parameters<typeof inspectPositionsForRegistration>[0]> = {},
) =>
  inspectPositionsForRegistration({
    ...base,
    connection: new ReplaySource(snapshot).connection,
    positions,
    ...over,
  });

describe("inspection against real mainnet accounts", () => {
  it("accepts the provider's own positions and reports what they hold in the band", async () => {
    const report = await inspect(OWN);
    expect(report.ok).toBe(true);
    expect(report.setErrors).toEqual([]);
    for (const p of report.positions) {
      expect(p.severity).not.toBe("reject");
      expect(p.details.owner).toBe(PROVIDER);
      expect(p.details.coversActiveBin).toBe(true);
    }
    const quote = report.positions.reduce((sum, p) => sum + (p.details.quoteInBandRaw ?? 0n), 0n);
    const baseRaw = report.positions.reduce((sum, p) => sum + (p.details.baseInBandRaw ?? 0n), 0n);
    // These equal the measurement engine's provider totals for the same snapshot (see real-state.test.ts).
    expect(quote).toBe(91_107_867n);
    expect(baseRaw).toBe(48_887_131n);
  });

  it("rejects a position another wallet owns, and says so", async () => {
    const report = await inspect([OWN[0] ?? "", OTHER_OWNERS]);
    expect(report.ok).toBe(false);
    const rejected = report.positions.find((p) => p.address === OTHER_OWNERS);
    expect(rejected?.severity).toBe("reject");
    expect(rejected?.findings[0]?.code).toBe("NotOwner");
    expect(rejected?.details.owner).not.toBe(PROVIDER);
  });

  it("rejects an account that does not exist", async () => {
    const report = await inspect([NONEXISTENT]);
    expect(report.ok).toBe(false);
    expect(report.positions[0]?.findings[0]?.code).toBe("PositionNotFound");
  });

  it("rejects accounts that are not supported positions", async () => {
    // the pool itself: owned by the DLMM program but an LbPair, not a PositionV2
    const pool = await inspect([POOL]);
    expect(pool.ok).toBe(false);
    expect(pool.positions[0]?.findings[0]).toMatchObject({
      severity: "reject",
      code: "UnsupportedPositionType",
    });
    expect(pool.positions[0]?.findings[0]?.message).toMatch(/PositionV2/);
    // a token mint: not owned by the DLMM program at all
    const mint = await inspect([BASE]);
    expect(mint.positions[0]?.findings[0]?.code).toBe("UnsupportedPositionType");
  });

  it("applies the set-level rules exactly as the program does", async () => {
    expect((await inspect([])).setErrors[0]?.code).toBe("EmptySet");
    const nine = [...OWN, ...OWN, ...OWN];
    const dup = await inspect(nine);
    expect(dup.ok).toBe(false);
    expect(dup.setErrors.map((f) => f.code)).toEqual(
      expect.arrayContaining(["DuplicatePosition", "TooManyPositions"]),
    );
    expect((await inspect(OWN, { maxPositions: 2 })).setErrors[0]?.code).toBe("TooManyPositions");
  });

  it("refuses to inspect against the wrong pool or mints", async () => {
    await expect(
      inspect(OWN, { baseMint: "So11111111111111111111111111111111111111112" }),
    ).rejects.toThrow(UnobservableError);
  });

  it("reports the market as measurable today", async () => {
    expect((await inspect(OWN)).marketWarnings).toEqual([]);
  });
});

describe("assessment rules", () => {
  const ctx: AssessContext = {
    pool: "POOL",
    provider: "ME",
    baseIsX: true,
    activeId: 100,
    band: { lowerBinId: 95, upperBinId: 105 },
  };
  const NONE = "11111111111111111111111111111111";
  const loaded = (
    over: Partial<Extract<PositionInput, { kind: "loaded" }>> = {},
  ): PositionInput => ({
    kind: "loaded",
    address: "P",
    lbPair: "POOL",
    owner: "ME",
    operator: NONE,
    feeOwner: "ME",
    lowerBinId: 90,
    upperBinId: 110,
    bins: [{ binId: 100, xAmount: 5n, yAmount: 7n }],
    ...over,
  });
  const codes = (p: PositionInput): string[] => assessPosition(p, ctx).findings.map((f) => f.code);

  it("accepts a clean owned position and totals its in-band holdings", () => {
    const a = assessPosition(loaded(), ctx);
    expect(a.severity).toBe("ok");
    expect(a.details).toMatchObject({
      quoteInBandRaw: 7n,
      baseInBandRaw: 5n,
      coversActiveBin: true,
    });
  });

  it("rejects every position that would count as zero, with the specific reason", () => {
    expect(codes({ kind: "missing", address: "P" })).toEqual(["PositionNotFound"]);
    expect(codes({ kind: "invalid", address: "P", reason: "x" })).toEqual([
      "UnsupportedPositionType",
    ]);
    expect(codes(loaded({ lbPair: "OTHER" }))).toEqual(["WrongPool"]);
    expect(codes(loaded({ owner: "THEM", feeOwner: "THEM" }))).toEqual(["NotOwner"]);
    expect(codes(loaded({ owner: "THEM", operator: "ME" }))).toEqual(["OperatorOnly"]);
    expect(codes(loaded({ owner: "THEM", feeOwner: "ME" }))).toEqual(["FeeOwnerOnly"]);
    for (const p of [
      { kind: "missing" as const, address: "P" },
      loaded({ owner: "THEM" }),
      loaded({ lbPair: "OTHER" }),
    ]) {
      expect(assessPosition(p, ctx).severity).toBe("reject");
    }
  });

  it("warns, but allows, when the position is registerable with a caveat", () => {
    expect(codes(loaded({ operator: "SOMEONE_ELSE" }))).toEqual(["OperatorSet"]);
    expect(codes(loaded({ bins: [] }))).toContain("EmptyPosition");
    expect(codes(loaded({ lowerBinId: 101, upperBinId: 110 }))).toContain("OutOfRange");
    expect(
      codes(
        loaded({
          bins: [{ binId: 200, xAmount: 1n, yAmount: 1n }],
          lowerBinId: 150,
          upperBinId: 250,
        }),
      ),
    ).toEqual(expect.arrayContaining(["NothingInBand", "OutOfRange"]));
    expect(assessPosition(loaded({ operator: "SOMEONE_ELSE" }), ctx).severity).toBe("warn");
  });

  it("treats an operator equal to the owner as no caveat", () => {
    expect(codes(loaded({ operator: "ME" }))).toEqual([]);
  });

  it("orients holdings correctly when the base token is Y", () => {
    const a = assessPosition(loaded(), { ...ctx, baseIsX: false });
    expect(a.details).toMatchObject({ quoteInBandRaw: 5n, baseInBandRaw: 7n });
  });

  it("checks the set itself", () => {
    expect(assessSet(["a", "b"], 8)).toEqual([]);
    expect(assessSet([], 8)[0]?.code).toBe("EmptySet");
    expect(assessSet(["a", "a"], 8)[0]?.code).toBe("DuplicatePosition");
    expect(assessSet(["a", "b", "c"], 2)[0]?.code).toBe("TooManyPositions");
    expect(
      assessSet(
        Array.from({ length: 9 }, (_, i) => `k${String(i)}`),
        200,
      )[0]?.code,
    ).toBe("TooManyPositions");
    expect(assessSet(["11111111111111111111111111111111"], 8)[0]?.code).toBe("DefaultKey");
  });
});

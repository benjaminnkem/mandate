import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  BIN_ARRAYS_PER_DIRECTION,
  DLMM,
  MeasurementError,
  ReplayMissError,
  ReplaySource,
  SnapshotSkewError,
  UnobservableError,
  assertMintObservable,
  assertSlotSkew,
  buildEvidence,
  canonicalJson,
  createDlmmQuoteEngine,
  replayPool,
  slotRange,
  swapForYFor,
  type AccountSnapshot,
  type MintState,
} from "../src/index.ts";

// REAL mainnet-beta account state, captured atomically at one slot. See test/fixtures/README.md.
const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/openai-usdc-mainnet.snapshot.json", import.meta.url), "utf8"),
) as AccountSnapshot;

const POOL = "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH";
const BASE = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF"; // OPENAI PreStocks (Token-2022)
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PROVIDER = "2KmmUnQ6nscD7j6siUjZMbDoT1u6jnjfZWF386CcRjak";
const OWN = [
  "2Ymo1bMvEQsTcErk5tEEYRZ8kKG5wNCRBbWvP8YnixNU",
  "7UXQYfYALyUDKQPaPSTj7kuRdbPyc3oNkxyVtTEFqjhR",
  "B8BhNDnc6HePLdjn6grmYpoM7AiCsKzQqVjbtrpSztdE",
];
const OTHER_OWNERS_POSITION = "3gRmvT4D9viEtEbFo4QDnDk7THnTXaLstYFBoffkc1qn";
const NONEXISTENT = "Fz1XcAr1fxKcJZsJpHfj8sXpXnBz5L9m6z3Zy1xq2vQp";

const params = {
  pool: POOL,
  baseMint: BASE,
  quoteMint: USDC,
  provider: PROVIDER,
  positions: [...OWN, OTHER_OWNERS_POSITION, NONEXISTENT],
  probeQuoteRaw: 10_000_000n,
  depthBandBps: 500n,
};
const inputs = { probeQuoteRaw: params.probeQuoteRaw, depthBandBps: params.depthBandBps };
const context = { cluster: "mainnet-beta", mandate: null, epochIndex: null, positionSet: null };
// Fixed provenance so the golden hash does not depend on the local git state.
const provenance = { algorithmSourceCommit: "TEST-FIXTURE", lockfileSha256: "0".repeat(64) };
const transport = { observerInstanceId: null, rpcHost: null };

describe("real mainnet snapshot: coherence", () => {
  it("was read at a single slot", () => {
    expect(slotRange(snapshot)).toEqual({ minSlot: 448786149, maxSlot: 448786149 });
    expect(snapshot.calls).toHaveLength(1);
  });

  it("rejects reads spread over too many slots", () => {
    expect(() => {
      assertSlotSkew({ minSlot: 100, maxSlot: 113 }, 12);
    }).toThrow(SnapshotSkewError);
    expect(() => {
      assertSlotSkew({ minSlot: 100, maxSlot: 112 }, 12);
    }).not.toThrow();
  });
});

describe("real mainnet snapshot: golden measurement (algorithm v1)", () => {
  it("produces the expected metrics, attribution and mint state", async () => {
    const obs = await replayPool(snapshot, params);
    const m = obs.measurement;

    expect(obs.clock).toEqual({ slot: "448786149", epoch: "1038", unixTimestamp: "1789921836" });
    expect(obs.pool).toMatchObject({
      baseIsX: true,
      activeId: 102,
      binStep: 50,
      programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    });

    // Values printed by `pnpm market:measure` for this exact snapshot.
    expect(m.metrics.effectiveSpreadBps).toBe(251);
    expect(m.metrics.poolBuyDepthQuoteRaw).toBe(63_491_020_966n);
    expect(m.metrics.poolSellDepthQuoteRaw).toBe(49_065_543_907n);
    expect(m.metrics.providerQuoteInBandRaw).toBe(91_107_867n);
    expect(m.providerBaseInBandRaw).toBe(48_887_131n);
    expect(m.metrics.providerBaseQuoteEqInBandRaw).toBe(81_314_309n);

    // Attribution on real accounts: the provider's three positions count; another owner's position and
    // a non-existent account contribute exactly zero, each with its reason.
    expect(m.provider.perPosition.map((p) => p.verdict)).toEqual([
      "Counted",
      "Counted",
      "Counted",
      "ExcludedOwnerMismatch",
      "ExcludedMissing",
    ]);
    expect(m.provider.perPosition.slice(0, 3).every((p) => p.coversActiveBin)).toBe(true);

    // Token-2022 state the measurement ran under (docs/adr/0008).
    expect(obs.baseMintState).toMatchObject({
      programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      hasFreezeAuthority: true,
      effectiveTransferFeeBps: 50, // epoch 1038 < 1039, so the older 50 bps schedule applies
      transferFeeSchedule: { olderBps: 50, newerBps: 100, newerEpoch: "1039" },
      transferHookProgramId: null,
      paused: false,
      scaledUiMultiplier: "1.4861347",
    });
    expect(obs.baseMintState.extensions).toEqual(
      expect.arrayContaining([
        "TransferFeeConfig",
        "PermanentDelegate",
        "PausableConfig",
        "TransferHook",
        "ScaledUiAmountConfig",
      ]),
    );
  });

  it("proves each depth is a real boundary: one raw unit under passes, one over fails", async () => {
    const { measurement } = await replayPool(snapshot, params);
    for (const proof of [measurement.buyDepth, measurement.sellDepth]) {
      expect(proof.capReached).toBe(false);
      expect(proof.failingInput).toBe(proof.passingInput + 1n);
      expect(proof.failingReason).toBe("ImpactExceeded");
    }
  });

  it("matches the golden payload hash", async () => {
    const obs = await replayPool(snapshot, params);
    const bundle = buildEvidence(obs, context, provenance, inputs, transport);
    // If this changes, the algorithm or evidence schema changed: bump ALGORITHM_VERSION deliberately.
    expect(bundle.payloadHash).toBe(
      "114a569154351c38a3ba28ab8a33c98d9285d4524e7080d4330f896c8f8a136d",
    );
    expect(bundle.observedSlot).toBe(448786149n);
    expect(bundle.observedUnixTs).toBe(1789921836n);
  });

  it("is byte-identical across 120 independent replays", async () => {
    const first = buildEvidence(
      await replayPool(snapshot, params),
      context,
      provenance,
      inputs,
      transport,
    );
    const firstJson = canonicalJson(first.payload);
    for (let i = 0; i < 120; i += 1) {
      const again = buildEvidence(
        await replayPool(snapshot, params),
        context,
        provenance,
        inputs,
        transport,
      );
      expect(again.payloadHash).toBe(first.payloadHash);
      expect(canonicalJson(again.payload)).toBe(firstJson);
    }
  }, 120_000);

  it("does not depend on the wall clock (the SDK reads Date.now; we pin it)", async () => {
    const baseline = buildEvidence(
      await replayPool(snapshot, params),
      context,
      provenance,
      inputs,
      transport,
    ).payloadHash;
    vi.useFakeTimers();
    try {
      for (const now of [0, 1_000_000_000_000, 1_789_919_800_000, 4_102_444_800_000]) {
        vi.setSystemTime(now);
        const bundle = buildEvidence(
          await replayPool(snapshot, params),
          context,
          provenance,
          inputs,
          transport,
        );
        expect(bundle.payloadHash).toBe(baseline);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes the hash when any economic input changes", async () => {
    const base = buildEvidence(
      await replayPool(snapshot, params),
      context,
      provenance,
      inputs,
      transport,
    ).payloadHash;
    const otherProbe = { ...params, probeQuoteRaw: 20_000_000n };
    const b2 = buildEvidence(
      await replayPool(snapshot, otherProbe),
      context,
      provenance,
      { ...inputs, probeQuoteRaw: 20_000_000n },
      transport,
    );
    expect(b2.payloadHash).not.toBe(base);
    const noPositions = { ...params, positions: [] as string[] };
    const b3 = buildEvidence(
      await replayPool(snapshot, noPositions),
      context,
      provenance,
      inputs,
      transport,
    );
    expect(b3.payloadHash).not.toBe(base);
    expect(b3.metrics.providerQuoteInBandRaw).toBe(0n);
    expect(b3.metrics.poolBuyDepthQuoteRaw).toBe(63_491_020_966n); // pool metrics do not depend on the provider
  });

  it("keeps observer-specific transport metadata out of both the payload and evidence hashes", async () => {
    const obs = await replayPool(snapshot, params);
    const a = buildEvidence(obs, context, provenance, inputs, {
      observerInstanceId: "observer-1",
      rpcHost: "rpc-a.example",
    });
    const b = buildEvidence(obs, context, provenance, inputs, {
      observerInstanceId: "observer-2",
      rpcHost: "rpc-b.example",
    });
    expect(a.payloadHash).toBe(b.payloadHash);
    // The evidence hash covers payload + snapshot only, so it is ALSO identical: this is what lets two
    // observers match onchain.
    expect(a.evidenceHash).toBe(b.evidenceHash);
    expect(canonicalJson(a.transport)).not.toBe(canonicalJson(b.transport));
  });
});

describe("real mainnet snapshot: failure handling never becomes a compliance verdict", () => {
  it("throws PoolMismatch for the wrong base or quote mint", async () => {
    await expect(
      replayPool(snapshot, { ...params, baseMint: "So11111111111111111111111111111111111111112" }),
    ).rejects.toThrow(UnobservableError);
    await expect(
      replayPool(snapshot, { ...params, quoteMint: "So11111111111111111111111111111111111111112" }),
    ).rejects.toThrow(/PoolMismatch/);
  });

  it("cannot read anything that was not in the snapshot", async () => {
    const other = "4NDDFqtEfQXpBUU6vmB9fhTJ8Ne9LSCuato8HvKdCDsU"; // a different real OPENAI pool, not captured
    await expect(replayPool(snapshot, { ...params, pool: other })).rejects.toThrow(ReplayMissError);
  });

  it("reports a probe that the pool cannot absorb as unavailable, not as a metric", async () => {
    // 10,000,000 USDC cannot be bought from a pool holding about 157k USDC.
    await expect(
      replayPool(snapshot, { ...params, probeQuoteRaw: 10_000_000_000_000n }),
    ).rejects.toThrow(MeasurementError);
    await expect(
      replayPool(snapshot, { ...params, probeQuoteRaw: 10_000_000_000_000n }),
    ).rejects.toThrow(/BuyProbeUnavailable/);
  });

  it("rejects a duplicated registered position", async () => {
    await expect(
      replayPool(snapshot, { ...params, positions: [OWN[0] ?? "", OWN[0] ?? ""] }),
    ).rejects.toThrow(/DuplicatePosition/);
  });
});

describe("mint observability policy", () => {
  const healthy: MintState = {
    address: BASE,
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: 9,
    hasFreezeAuthority: true,
    extensions: [],
    effectiveTransferFeeBps: 50,
    observationEpoch: "1038",
    transferFeeSchedule: null,
    transferHookProgramId: null,
    paused: false,
    permanentDelegate: null,
    scaledUiMultiplier: null,
  };

  it("accepts a healthy mint", () => {
    expect(() => {
      assertMintObservable(healthy);
    }).not.toThrow();
  });

  it("treats a paused mint as unobservable, not non-compliant", () => {
    expect(() => {
      assertMintObservable({ ...healthy, paused: true });
    }).toThrow(/MintPaused/);
  });

  it("treats an active transfer hook as unobservable", () => {
    expect(() => {
      assertMintObservable({
        ...healthy,
        transferHookProgramId: "Hook111111111111111111111111111111111111111",
      });
    }).toThrow(/TransferHookActive/);
  });
});

describe("orientation", () => {
  it("maps buy and sell to the right DLMM direction for both pool orientations", () => {
    expect(swapForYFor(true)).toEqual({ buy: false, sell: true }); // base = X: buying base is Y -> X
    expect(swapForYFor(false)).toEqual({ buy: true, sell: false }); // base = Y: buying base is X -> Y
  });

  it("issues the swap in the mapped direction and pins nothing else", () => {
    const seen: boolean[] = [];
    const fake = {
      swapQuote: (_in: unknown, swapForY: boolean) => {
        seen.push(swapForY);
        return { consumedInAmount: { toString: () => "5" }, outAmount: { toString: () => "4" } };
      },
    };
    for (const baseIsX of [true, false]) {
      seen.length = 0;
      const engine = createDlmmQuoteEngine({
        dlmm: fake as never,
        baseIsX,
        buyBinArrays: [],
        sellBinArrays: [],
        clockUnixTimestamp: 1n,
      });
      engine.buy(5n);
      engine.sell(5n);
      expect(seen).toEqual([!baseIsX, baseIsX]);
    }
  });
});

describe("SDK dynamic-fee clock dependence (why the clock is pinned)", () => {
  // This pool's real volatility is currently so low that the dynamic fee is negligible for small
  // quotes, so the hazard is shown by raising the volatility accumulator on the loaded SDK object
  // (a test-only mutation of an in-memory copy; the snapshot itself is untouched).
  async function volatilePool() {
    const { PublicKey } = await import("@solana/web3.js");
    const BN = (await import("bn.js")).default;
    const dlmm = await DLMM.create(new ReplaySource(snapshot).connection, new PublicKey(POOL));
    const arrays = await dlmm.getBinArrayForSwap(false, BIN_ARRAYS_PER_DIRECTION);
    const clockTs = BigInt(dlmm.clock.unixTimestamp.toString());
    dlmm.lbPair.vParameters.volatilityAccumulator = 350_000;
    dlmm.lbPair.vParameters.volatilityReference = 350_000;
    dlmm.lbPair.vParameters.lastUpdateTimestamp = new BN(clockTs.toString());
    return { dlmm, arrays, clockTs, BN };
  }

  it("shows the raw SDK quote changes with the wall clock", async () => {
    const { dlmm, arrays, clockTs, BN } = await volatilePool();
    const quoteAt = (offsetSeconds: number): string => {
      vi.useFakeTimers();
      vi.setSystemTime((Number(clockTs) + offsetSeconds) * 1000);
      try {
        return dlmm.swapQuote(new BN("10000000"), false, new BN(0), arrays).outAmount.toString();
      } finally {
        vi.useRealTimers();
      }
    };
    expect(quoteAt(10)).not.toBe(quoteAt(100_000)); // inside the filter window vs fully decayed
  });

  it("gives identical engine quotes whatever the wall clock, because the clock is pinned", async () => {
    const { dlmm, arrays, clockTs } = await volatilePool();
    const engine = createDlmmQuoteEngine({
      dlmm,
      baseIsX: true,
      buyBinArrays: arrays,
      sellBinArrays: arrays,
      clockUnixTimestamp: clockTs,
    });
    const at = (ms: number) => {
      vi.useFakeTimers();
      vi.setSystemTime(ms);
      try {
        return engine.buy(10_000_000n);
      } finally {
        vi.useRealTimers();
      }
    };
    const a = at(Number(clockTs) * 1000 + 10_000);
    const b = at(Number(clockTs) * 1000 + 100_000_000);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });
});

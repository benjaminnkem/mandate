import { PublicKey } from "@solana/web3.js";

import { measureQuality, type Measurement } from "../algorithm/measure.ts";
import { DLMM, meteoraSdk } from "../sdk.ts";
import { createDlmmQuoteEngine, loadBinArrays } from "./dlmm-engine.ts";
import { UnobservableError } from "./errors.ts";
import { assertMintObservable, readMintState, type MintState } from "./mint-state.ts";
import { loadPositions } from "./positions.ts";
import {
  assertSlotSkew,
  slotRange,
  type AccountSnapshot,
  type SlotRange,
  type SnapshotSource,
} from "./snapshot.ts";

/** Reads spanning more than this many slots are not one coherent state (about 5 seconds). */
export const DEFAULT_MAX_SLOT_SKEW = 12;

export interface MeasurePoolParams {
  readonly source: SnapshotSource;
  readonly pool: string;
  /** Exact PreStocks mint. Never a ticker. */
  readonly baseMint: string;
  readonly quoteMint: string;
  /** The accepted provider's wallet. */
  readonly provider: string;
  /** The provider's registered position accounts, in registration order. */
  readonly positions: readonly string[];
  readonly probeQuoteRaw: bigint;
  readonly depthBandBps: bigint;
  readonly maxSlotSkew?: number;
}

export interface PoolObservation {
  readonly measurement: Measurement;
  readonly pool: {
    readonly address: string;
    readonly programId: string;
    readonly baseMint: string;
    readonly quoteMint: string;
    readonly baseIsX: boolean;
    readonly activeId: number;
    readonly binStep: number;
    readonly baseFactor: number;
    readonly variableFeeControl: number;
    readonly volatilityAccumulator: number;
    readonly lastUpdateTimestamp: string;
  };
  readonly baseMintState: MintState;
  readonly quoteMint: {
    readonly address: string;
    readonly programId: string;
    readonly decimals: number;
  };
  readonly clock: { readonly slot: string; readonly epoch: string; readonly unixTimestamp: string };
  readonly slots: SlotRange;
  readonly snapshot: AccountSnapshot;
  readonly registeredPositions: readonly string[];
  readonly provider: string;
}

/**
 * Observe one pool: load it through the official SDK from a snapshot source, verify it is the exact
 * pool, orientation and mint state we expect, run the canonical measurement, and check the reads were
 * one coherent state. Read-only. Throws `UnobservableError` / `SnapshotSkewError` when no valid
 * observation exists, which callers map to an `Unavailable` epoch, never to non-compliance.
 */
export async function measurePool(params: MeasurePoolParams): Promise<PoolObservation> {
  const dlmm = await DLMM.create(params.source.connection, new PublicKey(params.pool));

  const officialPrograms = Object.values(meteoraSdk.LBCLMM_PROGRAM_IDS).map(String);
  const programId = dlmm.program.programId.toBase58();
  if (!officialPrograms.includes(programId))
    throw new UnobservableError("PoolMismatch", `unofficial program ${programId}`);

  const x = dlmm.lbPair.tokenXMint.toBase58();
  const y = dlmm.lbPair.tokenYMint.toBase58();
  const sameSet =
    (x === params.baseMint && y === params.quoteMint) ||
    (y === params.baseMint && x === params.quoteMint);
  if (!sameSet)
    throw new UnobservableError(
      "PoolMismatch",
      `pool mints ${x}/${y} do not match expected base/quote`,
    );
  const baseIsX = x === params.baseMint;

  const clock = {
    slot: dlmm.clock.slot.toString(),
    epoch: dlmm.clock.epoch.toString(),
    unixTimestamp: dlmm.clock.unixTimestamp.toString(),
  };
  const baseToken = baseIsX ? dlmm.tokenX : dlmm.tokenY;
  const quoteToken = baseIsX ? dlmm.tokenY : dlmm.tokenX;
  const baseMintState = readMintState(
    params.baseMint,
    baseToken.owner.toBase58(),
    baseToken.mint,
    BigInt(clock.epoch),
    BigInt(clock.unixTimestamp),
  );
  assertMintObservable(baseMintState);

  const arrays = await loadBinArrays(dlmm, baseIsX);
  const engine = createDlmmQuoteEngine({
    dlmm,
    baseIsX,
    buyBinArrays: arrays.buy,
    sellBinArrays: arrays.sell,
    clockUnixTimestamp: BigInt(clock.unixTimestamp),
  });
  const positions = await loadPositions(dlmm, params.positions);

  const measurement = measureQuality({
    engine,
    probeQuoteRaw: params.probeQuoteRaw,
    depthBandBps: params.depthBandBps,
    pool: params.pool,
    provider: params.provider,
    baseIsX,
    activeId: dlmm.lbPair.activeId,
    binStep: dlmm.lbPair.binStep,
    positions,
  });

  const snapshot = params.source.snapshot();
  const slots = slotRange(snapshot);
  assertSlotSkew(slots, params.maxSlotSkew ?? DEFAULT_MAX_SLOT_SKEW);

  return {
    measurement,
    pool: {
      address: params.pool,
      programId,
      baseMint: params.baseMint,
      quoteMint: params.quoteMint,
      baseIsX,
      activeId: dlmm.lbPair.activeId,
      binStep: dlmm.lbPair.binStep,
      baseFactor: dlmm.lbPair.parameters.baseFactor,
      variableFeeControl: dlmm.lbPair.parameters.variableFeeControl,
      volatilityAccumulator: dlmm.lbPair.vParameters.volatilityAccumulator,
      lastUpdateTimestamp: dlmm.lbPair.vParameters.lastUpdateTimestamp.toString(),
    },
    baseMintState,
    quoteMint: {
      address: params.quoteMint,
      programId: quoteToken.owner.toBase58(),
      decimals: quoteToken.mint.decimals,
    },
    clock,
    slots,
    snapshot,
    registeredPositions: [...params.positions],
    provider: params.provider,
  };
}

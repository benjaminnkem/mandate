import BN from "bn.js";

import type { Quote, QuoteEngine } from "../algorithm/types.ts";
import { meteoraSdk, type DLMMInstance } from "../sdk.ts";
import { withPinnedClock } from "./clock.ts";

/** Bin arrays loaded per swap direction. Part of algorithm v1: depth is measured within this window. */
export const BIN_ARRAYS_PER_DIRECTION = 24;

type BinArrays = Awaited<ReturnType<DLMMInstance["getBinArrayForSwap"]>>;

export interface DlmmEngineInputs {
  readonly dlmm: DLMMInstance;
  /** True when the base (PreStocks) token is the pool's token X. */
  readonly baseIsX: boolean;
  /** Bin arrays for buying base (quote in) and selling base (base in). */
  readonly buyBinArrays: BinArrays;
  readonly sellBinArrays: BinArrays;
  /** The snapshot's on-chain Clock unix timestamp. Every quote runs with the wall clock pinned to it. */
  readonly clockUnixTimestamp: bigint;
}

/**
 * Direction mapping. In DLMM, `swapForY = true` means "swap token X for token Y". Buying the base
 * token spends quote: with base = X that is Y -> X, so `swapForY = false`; with base = Y it is X -> Y.
 * Selling base is the reverse. Orientation is always resolved explicitly, never assumed.
 */
export const swapForYFor = (baseIsX: boolean): { buy: boolean; sell: boolean } => ({
  buy: !baseIsX,
  sell: baseIsX,
});

const toBn = (value: bigint): BN => new BN(value.toString());
const toBigInt = (value: { toString(): string }): bigint => BigInt(value.toString());

/** Errors the SDK raises when a size simply cannot be filled from the loaded liquidity. */
const isInsufficientLiquidity = (error: unknown): boolean =>
  error instanceof meteoraSdk.DlmmSdkError &&
  (error.name.includes("INSUFFICIENT_LIQUIDITY") ||
    error.message.includes("Insufficient liquidity"));

/**
 * A `QuoteEngine` backed by the official SDK's `swapQuote` on one pinned snapshot. Quotes are
 * transfer-fee aware on both legs (verified in the SDK source): `consumedInAmount` is what the trader
 * sends, `outAmount` is what they receive net of every fee. Partial fills are refused
 * (`isPartialFill = false`); an unfillable size is reported as `null`, any other SDK error propagates.
 */
export function createDlmmQuoteEngine(inputs: DlmmEngineInputs): QuoteEngine {
  const directions = swapForYFor(inputs.baseIsX);
  const quote = (amount: bigint, swapForY: boolean, binArrays: BinArrays): Quote | null => {
    try {
      const result = withPinnedClock(inputs.clockUnixTimestamp, () =>
        inputs.dlmm.swapQuote(toBn(amount), swapForY, new BN(0), binArrays, false, 0),
      );
      return { consumedIn: toBigInt(result.consumedInAmount), out: toBigInt(result.outAmount) };
    } catch (error) {
      if (isInsufficientLiquidity(error)) return null;
      throw error;
    }
  };
  return {
    buy: (quoteIn) => quote(quoteIn, directions.buy, inputs.buyBinArrays),
    sell: (baseIn) => quote(baseIn, directions.sell, inputs.sellBinArrays),
  };
}

export async function loadBinArrays(
  dlmm: DLMMInstance,
  baseIsX: boolean,
): Promise<{ buy: BinArrays; sell: BinArrays }> {
  const directions = swapForYFor(baseIsX);
  const [buy, sell] = await Promise.all([
    dlmm.getBinArrayForSwap(directions.buy, BIN_ARRAYS_PER_DIRECTION),
    dlmm.getBinArrayForSwap(directions.sell, BIN_ARRAYS_PER_DIRECTION),
  ]);
  return { buy, sell };
}

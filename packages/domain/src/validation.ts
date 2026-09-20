import { z } from "zod";

import { type DomainErrorCode } from "./errors.ts";
import { I64_MAX, U32_MAX, U64_MAX } from "./math.ts";
import type { ProtocolConfig } from "./types.ts";

/** The protocol limits that validation consults. A subset of `ProtocolConfig`. */
export type ProtocolLimits = Pick<
  ProtocolConfig,
  | "minBudgetRaw"
  | "maxBudgetRaw"
  | "minEpochSeconds"
  | "maxEpochSeconds"
  | "maxDurationSeconds"
  | "maxEpochs"
  | "maxSpreadBps"
  | "maxDepthBandBps"
  | "minProbeQuoteRaw"
  | "maxProbeQuoteRaw"
  | "minStartLeadSeconds"
  | "positionLockBufferSeconds"
  | "minSetupWindowSeconds"
>;

export interface CreateMandateParams {
  readonly maxRewardRaw: bigint;
  readonly biddingEndsAt: bigint;
  readonly startAt: bigint;
  readonly durationSeconds: bigint;
  readonly epochSeconds: bigint;
  readonly maxEffectiveSpreadBps: number;
  readonly depthBandBps: number;
  readonly minPoolBuyDepthQuoteRaw: bigint;
  readonly minPoolSellDepthQuoteRaw: bigint;
  readonly minProviderQuoteInBandRaw: bigint;
  readonly minProviderBaseQuoteEqInBandRaw: bigint;
  readonly probeQuoteRaw: bigint;
}

/**
 * Validate mandate creation parameters. Returns every distinct problem, sorted; an empty list means valid.
 * The rules and their grouping are the contract shared with the Rust program (golden vectors assert them).
 * Mandate creation is never allowed to succeed on a schedule the reward split cannot honour: the escrow
 * must cover at least one raw unit per epoch.
 */
export function validateCreateMandate(
  params: CreateMandateParams,
  protocol: ProtocolLimits,
  now: bigint,
): DomainErrorCode[] {
  const errors = new Set<DomainErrorCode>();
  const { epochSeconds: e, durationSeconds: d, startAt } = params;

  let totalEpochs: bigint | undefined;
  if (e < protocol.minEpochSeconds || e > protocol.maxEpochSeconds) {
    errors.add("InvalidEpochLength");
  } else if (d <= 0n || d > protocol.maxDurationSeconds) {
    errors.add("InvalidTiming");
  } else if (d % e !== 0n) {
    errors.add("InvalidEpochLength");
  } else {
    totalEpochs = d / e;
    if (totalEpochs > BigInt(protocol.maxEpochs)) errors.add("TooManyEpochs");
  }

  const lockAt = startAt - protocol.positionLockBufferSeconds;
  if (params.biddingEndsAt <= now) errors.add("InvalidTiming");
  if (startAt < now + protocol.minStartLeadSeconds) errors.add("InvalidTiming");
  if (params.biddingEndsAt >= lockAt - protocol.minSetupWindowSeconds) errors.add("InvalidTiming");
  if (
    totalEpochs !== undefined &&
    startAt > 0n &&
    totalEpochs <= BigInt(protocol.maxEpochs) &&
    startAt + e * totalEpochs > I64_MAX
  ) {
    errors.add("ArithmeticOverflow");
  }

  const budget = params.maxRewardRaw;
  if (
    budget < protocol.minBudgetRaw ||
    budget > protocol.maxBudgetRaw ||
    (totalEpochs !== undefined && budget < totalEpochs)
  ) {
    errors.add("InvalidBudget");
  }

  const spread = BigInt(params.maxEffectiveSpreadBps);
  if (spread < 1n || spread > BigInt(protocol.maxSpreadBps)) errors.add("InvalidThreshold");
  const band = BigInt(params.depthBandBps);
  if (band < 1n || band > BigInt(protocol.maxDepthBandBps)) errors.add("InvalidThreshold");
  for (const minimum of [
    params.minPoolBuyDepthQuoteRaw,
    params.minPoolSellDepthQuoteRaw,
    params.minProviderQuoteInBandRaw,
    params.minProviderBaseQuoteEqInBandRaw,
  ]) {
    if (minimum <= 0n) errors.add("InvalidThreshold");
  }
  if (
    params.probeQuoteRaw < protocol.minProbeQuoteRaw ||
    params.probeQuoteRaw > protocol.maxProbeQuoteRaw
  ) {
    errors.add("InvalidThreshold");
  }
  return [...errors].sort();
}

export interface BidParams {
  readonly requestedRewardRaw: bigint;
  readonly validUntil: bigint;
  readonly maxRewardRaw: bigint;
  readonly now: bigint;
  readonly totalEpochs: number;
  /** Last instant a sponsor can still accept: the start of the provider's setup window. */
  readonly acceptanceCutoff: bigint;
}

/** Validate a bid. Sorted distinct problems; empty means valid. */
export function validateBid(bid: BidParams): DomainErrorCode[] {
  const errors = new Set<DomainErrorCode>();
  if (
    bid.requestedRewardRaw <= 0n ||
    bid.requestedRewardRaw > bid.maxRewardRaw ||
    bid.requestedRewardRaw < BigInt(bid.totalEpochs)
  ) {
    errors.add("InvalidBudget");
  }
  if (bid.validUntil < bid.now) errors.add("BidExpired");
  else if (bid.validUntil > bid.acceptanceCutoff) errors.add("InvalidTiming");
  return [...errors].sort();
}

// ---- JSON transport schemas -------------------------------------------------------------------
// HTTP/JSON carries u64 and i64 as base-10 strings. These schemas parse them into bigint and
// enforce the fixed-width ranges, so nothing downstream ever sees a JavaScript number as money.

const uintString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "expected a base-10 unsigned integer string")
  .transform((text) => BigInt(text));

export const u64String = uintString.refine((x) => x <= U64_MAX, "exceeds u64");
export const i64String = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "expected a base-10 integer string")
  .transform((text) => BigInt(text))
  .refine((x) => x <= I64_MAX, "exceeds i64");
const u32Number = z.number().int().min(0).max(Number(U32_MAX));

export const createMandateParamsSchema = z.strictObject({
  maxRewardRaw: u64String,
  biddingEndsAt: i64String,
  startAt: i64String,
  durationSeconds: i64String,
  epochSeconds: i64String,
  maxEffectiveSpreadBps: u32Number,
  depthBandBps: u32Number,
  minPoolBuyDepthQuoteRaw: u64String,
  minPoolSellDepthQuoteRaw: u64String,
  minProviderQuoteInBandRaw: u64String,
  minProviderBaseQuoteEqInBandRaw: u64String,
  probeQuoteRaw: u64String,
});

export const bidParamsSchema = z.strictObject({
  requestedRewardRaw: u64String,
  validUntil: i64String,
});

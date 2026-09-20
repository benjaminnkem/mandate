import {
  MAX_DURATION_SECONDS,
  MAX_EPOCHS,
  MAX_EPOCH_SECONDS,
  MIN_EPOCH_SECONDS,
} from "./constants.ts";
import { fail } from "./errors.ts";
import { asI64 } from "./math.ts";

export interface ScheduleBounds {
  readonly minEpochSeconds: bigint;
  readonly maxEpochSeconds: bigint;
  readonly maxDurationSeconds: bigint;
  readonly maxEpochs: number;
}

export const DEFAULT_SCHEDULE_BOUNDS: ScheduleBounds = {
  minEpochSeconds: MIN_EPOCH_SECONDS,
  maxEpochSeconds: MAX_EPOCH_SECONDS,
  maxDurationSeconds: MAX_DURATION_SECONDS,
  maxEpochs: MAX_EPOCHS,
};

export interface Schedule {
  readonly startAt: bigint;
  readonly epochSeconds: bigint;
  readonly totalEpochs: number;
  readonly endAt: bigint;
}

/**
 * Build the fixed epoch schedule. Duration must be an exact multiple of the epoch length (v1).
 * Rule order is part of the contract: golden vectors assert which error wins.
 */
export function buildSchedule(
  startAt: bigint,
  durationSeconds: bigint,
  epochSeconds: bigint,
  bounds: ScheduleBounds = DEFAULT_SCHEDULE_BOUNDS,
): Schedule {
  if (epochSeconds < bounds.minEpochSeconds || epochSeconds > bounds.maxEpochSeconds) {
    fail("InvalidEpochLength", "epoch length outside protocol bounds");
  }
  if (durationSeconds <= 0n || durationSeconds > bounds.maxDurationSeconds || startAt <= 0n) {
    fail("InvalidTiming", "duration or start outside bounds");
  }
  if (durationSeconds % epochSeconds !== 0n) {
    fail("InvalidEpochLength", "duration is not a multiple of the epoch length");
  }
  const total = durationSeconds / epochSeconds;
  if (total > BigInt(bounds.maxEpochs)) fail("TooManyEpochs");
  const endAt = asI64(startAt + epochSeconds * total);
  return { startAt, epochSeconds, totalEpochs: Number(total), endAt };
}

export type EpochPosition =
  | { readonly kind: "NotStarted" }
  | { readonly kind: "Ended" }
  | { readonly kind: "Epoch"; readonly index: number };

/**
 * Which epoch a timestamp falls in. Epoch `i` covers `[start + i*E, start + (i+1)*E)`: the start
 * is inclusive and the end exclusive, so a timestamp exactly on a boundary belongs to the later epoch.
 */
export function epochPositionAt(
  schedule: Pick<Schedule, "startAt" | "epochSeconds" | "totalEpochs">,
  ts: bigint,
): EpochPosition {
  const endAt = schedule.startAt + schedule.epochSeconds * BigInt(schedule.totalEpochs);
  if (ts < schedule.startAt) return { kind: "NotStarted" };
  if (ts >= endAt) return { kind: "Ended" };
  return { kind: "Epoch", index: Number((ts - schedule.startAt) / schedule.epochSeconds) };
}

export interface EpochBounds {
  readonly epochStart: bigint;
  /** Exclusive end. An epoch can be finalized once the clock reaches this instant. */
  readonly epochEnd: bigint;
  /** Earliest instant `finalize_unavailable_epoch` may run (epoch end + recovery window). */
  readonly recoveryDeadline: bigint;
}

export function epochBounds(
  schedule: Pick<Schedule, "startAt" | "epochSeconds" | "totalEpochs">,
  index: number,
  unavailableRecoverySeconds: bigint,
): EpochBounds {
  if (!Number.isSafeInteger(index) || index < 0 || index >= schedule.totalEpochs)
    fail("EpochOutOfRange");
  const epochStart = schedule.startAt + BigInt(index) * schedule.epochSeconds;
  const epochEnd = epochStart + schedule.epochSeconds;
  return { epochStart, epochEnd, recoveryDeadline: asI64(epochEnd + unavailableRecoverySeconds) };
}

/**
 * The last instant a sponsor can still accept a bid: `startAt - lockBuffer - setupWindow`. Accepting no later
 * than this leaves the provider at least the protocol's setup window before the position set locks
 * (docs/adr/0009). Throws `ArithmeticOverflow` rather than leaving the i64 range.
 */
export function acceptanceCutoff(
  startAt: bigint,
  positionLockBufferSeconds: bigint,
  minSetupWindowSeconds: bigint,
): bigint {
  return asI64(startAt - positionLockBufferSeconds - minSetupWindowSeconds);
}

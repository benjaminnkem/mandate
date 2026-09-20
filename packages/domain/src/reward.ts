import { fail } from "./errors.ts";
import { addU64, asU64 } from "./math.ts";

export interface RewardSplit {
  /** Reward for every epoch except the last. */
  readonly base: bigint;
  /** Remainder added to the last epoch only, so the maximum earnable equals the accepted bid exactly. */
  readonly extra: bigint;
}

/** `base = floor(R / N)`, `extra = R mod N`. */
export function splitReward(acceptedRewardRaw: bigint, totalEpochs: number): RewardSplit {
  if (totalEpochs === 0) return fail("DivisionByZero", "zero epochs");
  const n = BigInt(totalEpochs);
  const reward = asU64(acceptedRewardRaw);
  return { base: reward / n, extra: reward % n };
}

/** Reward a compliant epoch earns. Epochs `0..N-2` earn `base`; the final epoch earns `base + extra`. */
export function epochReward(acceptedRewardRaw: bigint, totalEpochs: number, index: number): bigint {
  const { base, extra } = splitReward(acceptedRewardRaw, totalEpochs);
  if (!Number.isSafeInteger(index) || index < 0 || index >= totalEpochs)
    return fail("EpochOutOfRange");
  return index === totalEpochs - 1 ? addU64(base, extra) : base;
}

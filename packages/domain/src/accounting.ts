import { fail } from "./errors.ts";
import { addU64, asU64, subU64 } from "./math.ts";
import { epochReward } from "./reward.ts";
import type { EpochStatus } from "./types.ts";

/**
 * Exact reward accounting for one mandate. Everything is derived from a handful of stored
 * counters and the fixed invariants below; there are no ad hoc branches.
 *
 *   earned + forfeited + unresolved == accepted           (every epoch's reward is in exactly one bucket)
 *   claimed <= earned <= accepted <= max
 *   vault == max - claimed - sponsorWithdrawn             (funding conservation)
 *   vault >= (earned - claimed) + unresolved              (the provider's possible rights are always covered)
 */
export interface AccountingState {
  readonly maxRewardRaw: bigint;
  readonly acceptedRewardRaw: bigint;
  readonly totalEpochs: number;
  readonly finalizedEpochs: number;
  readonly compliantEpochs: number;
  readonly noncompliantEpochs: number;
  readonly unavailableEpochs: number;
  readonly earnedRewardRaw: bigint;
  readonly forfeitedRewardRaw: bigint;
  readonly claimedRewardRaw: bigint;
  readonly sponsorWithdrawnRaw: bigint;
}

export function newAccounting(
  maxRewardRaw: bigint,
  acceptedRewardRaw: bigint,
  totalEpochs: number,
): AccountingState {
  asU64(maxRewardRaw);
  asU64(acceptedRewardRaw);
  if (totalEpochs <= 0) return fail("InvalidEpochLength", "zero epochs");
  if (acceptedRewardRaw > maxRewardRaw)
    return fail("InvalidBudget", "accepted reward exceeds escrow");
  return {
    maxRewardRaw,
    acceptedRewardRaw,
    totalEpochs,
    finalizedEpochs: 0,
    compliantEpochs: 0,
    noncompliantEpochs: 0,
    unavailableEpochs: 0,
    earnedRewardRaw: 0n,
    forfeitedRewardRaw: 0n,
    claimedRewardRaw: 0n,
    sponsorWithdrawnRaw: 0n,
  };
}

export const allEpochsResolved = (s: AccountingState): boolean =>
  s.finalizedEpochs === s.totalEpochs;

/** Earned by the provider and not yet claimed. */
export const claimableRaw = (s: AccountingState): bigint =>
  subU64(s.earnedRewardRaw, s.claimedRewardRaw);

/** Reward of epochs that are still undecided (pending, or unavailable inside the recovery window). */
export const unresolvedRewardRaw = (s: AccountingState): bigint =>
  subU64(subU64(s.acceptedRewardRaw, s.earnedRewardRaw), s.forfeitedRewardRaw);

/** USDC still held by the reward vault. */
export const vaultBalanceRaw = (s: AccountingState): bigint =>
  subU64(subU64(s.maxRewardRaw, s.claimedRewardRaw), s.sponsorWithdrawnRaw);

/**
 * What the sponsor may withdraw now: the award surplus (`max - accepted`) at any time after award,
 * plus every forfeited reward (`accepted - earned`) once all epochs are resolved, less what was already withdrawn.
 * Nothing owed to the provider, and nothing still undecided, is ever included.
 */
export function sponsorWithdrawableRaw(s: AccountingState): bigint {
  const surplus = subU64(s.maxRewardRaw, s.acceptedRewardRaw);
  const forfeited = allEpochsResolved(s) ? subU64(s.acceptedRewardRaw, s.earnedRewardRaw) : 0n;
  return subU64(addU64(surplus, forfeited), s.sponsorWithdrawnRaw);
}

/**
 * Record one epoch's final outcome. `alreadyFinalized` comes from the caller (the program knows via
 * the epoch's unique result account); counters alone cannot tell which epochs were finalized.
 */
export function finalizeEpoch(
  s: AccountingState,
  index: number,
  outcome: EpochStatus,
  alreadyFinalized: boolean,
): AccountingState {
  if (!Number.isSafeInteger(index) || index < 0 || index >= s.totalEpochs)
    return fail("EpochOutOfRange");
  if (alreadyFinalized || s.finalizedEpochs >= s.totalEpochs) return fail("EpochAlreadyFinalized");
  const reward = epochReward(s.acceptedRewardRaw, s.totalEpochs, index);
  const base = { ...s, finalizedEpochs: s.finalizedEpochs + 1 };
  if (outcome === "Compliant") {
    return {
      ...base,
      compliantEpochs: s.compliantEpochs + 1,
      earnedRewardRaw: addU64(s.earnedRewardRaw, reward),
    };
  }
  const forfeitedRewardRaw = addU64(s.forfeitedRewardRaw, reward);
  return outcome === "NonCompliant"
    ? { ...base, noncompliantEpochs: s.noncompliantEpochs + 1, forfeitedRewardRaw }
    : { ...base, unavailableEpochs: s.unavailableEpochs + 1, forfeitedRewardRaw };
}

export type Amount = bigint | "all";

/** Provider claim. `"all"` claims everything currently claimable. */
export function claim(
  s: AccountingState,
  amount: Amount,
): { state: AccountingState; amountRaw: bigint } {
  const available = claimableRaw(s);
  const amountRaw = amount === "all" ? available : amount;
  if (amountRaw === 0n || available === 0n) return fail("NothingToClaim");
  if (amountRaw > available) return fail("ClaimExceedsEarned");
  return { state: { ...s, claimedRewardRaw: addU64(s.claimedRewardRaw, amountRaw) }, amountRaw };
}

/** Sponsor withdrawal of surplus and forfeited funds. `"all"` withdraws everything currently available. */
export function sponsorWithdraw(
  s: AccountingState,
  amount: Amount,
): { state: AccountingState; amountRaw: bigint } {
  const available = sponsorWithdrawableRaw(s);
  const amountRaw = amount === "all" ? available : amount;
  if (amountRaw === 0n || available === 0n) return fail("NothingToWithdraw");
  if (amountRaw > available) return fail("WithdrawExceedsAvailable");
  return {
    state: { ...s, sponsorWithdrawnRaw: addU64(s.sponsorWithdrawnRaw, amountRaw) },
    amountRaw,
  };
}

/** Assert every conservation invariant. Throws `InvariantViolation` naming the first one broken. */
export function assertInvariants(s: AccountingState): void {
  const bad = (name: string): never => fail("InvariantViolation", name);
  if (s.earnedRewardRaw + s.forfeitedRewardRaw > s.acceptedRewardRaw)
    bad("earned+forfeited<=accepted");
  if (s.claimedRewardRaw > s.earnedRewardRaw) bad("claimed<=earned");
  if (s.acceptedRewardRaw > s.maxRewardRaw) bad("accepted<=max");
  if (s.claimedRewardRaw + s.sponsorWithdrawnRaw > s.maxRewardRaw) bad("outflow<=funding");
  if (s.sponsorWithdrawnRaw > sponsorWithdrawableRaw({ ...s, sponsorWithdrawnRaw: 0n }))
    bad("sponsorWithdrawn<=releasable");
  if (vaultBalanceRaw(s) < claimableRaw(s) + unresolvedRewardRaw(s))
    bad("vault covers provider rights");
  if (s.finalizedEpochs !== s.compliantEpochs + s.noncompliantEpochs + s.unavailableEpochs)
    bad("epoch counters");
}

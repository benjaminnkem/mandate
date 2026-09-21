import {
  assertInvariants,
  claimableRaw,
  epochReward,
  sponsorWithdrawableRaw,
  unresolvedRewardRaw,
  vaultBalanceRaw,
  type AccountingState,
} from "@mandate/domain";

import type { EpochResultAccount, MandateAccount } from "./accounts.ts";

export interface Finding {
  /** Stable machine-readable name of the check that failed. */
  readonly check: string;
  readonly detail: string;
}

export interface Reconciliation {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  /** What the ledger says: everything a reader needs to audit the vault by hand. */
  readonly ledger: {
    readonly depositedRaw: bigint;
    readonly earnedRaw: bigint;
    readonly forfeitedRaw: bigint;
    readonly unresolvedRaw: bigint;
    readonly claimedRaw: bigint;
    readonly claimableRaw: bigint;
    readonly sponsorWithdrawnRaw: bigint;
    readonly sponsorWithdrawableRaw: bigint;
    readonly expectedVaultRaw: bigint;
    /** `null` when the vault account no longer exists (a closed mandate). */
    readonly actualVaultRaw: bigint | null;
    /** Provider entitlement still owed: claimable now plus unresolved epochs. */
    readonly remainingObligationsRaw: bigint;
  };
}

export interface ReconcileInput {
  readonly mandate: MandateAccount;
  /** The reward vault's token balance, or `null` if the account does not exist. */
  readonly vaultBalanceRaw: bigint | null;
  /** Every EpochResult that exists for the mandate. */
  readonly results: readonly EpochResultAccount[];
}

const stateOf = (m: MandateAccount): AccountingState => ({
  maxRewardRaw: m.maxRewardRaw,
  acceptedRewardRaw: m.acceptedRewardRaw,
  totalEpochs: m.totalEpochs,
  finalizedEpochs: m.finalizedEpochs,
  compliantEpochs: m.compliantEpochs,
  noncompliantEpochs: m.noncompliantEpochs,
  unavailableEpochs: m.unavailableEpochs,
  earnedRewardRaw: m.earnedRewardRaw,
  forfeitedRewardRaw: m.forfeitedRewardRaw,
  claimedRewardRaw: m.claimedRewardRaw,
  sponsorWithdrawnRaw: m.sponsorWithdrawnRaw,
});

/**
 * Compare the chain's three sources of truth: the mandate's counters, the epoch results, and the token
 * vault. Pure and total: it never throws on bad data, it reports it. Any finding means the books disagree and
 * a caller (the CLI, the indexer, an alert) must treat that as an incident.
 */
export function reconcileMandate(input: ReconcileInput): Reconciliation {
  const { mandate: m, results } = input;
  const s = stateOf(m);
  const findings: Finding[] = [];
  const add = (check: string, detail: string): void => {
    findings.push({ check, detail });
  };
  // Derived amounts throw when the counters are impossible (for example claimed > earned). That is itself a
  // finding, not a crash: report it once and carry on with a zero placeholder.
  const safe = (name: string, compute: () => bigint): bigint => {
    try {
      return compute();
    } catch (error) {
      add(`ledger-${name}`, error instanceof Error ? error.message : String(error));
      return 0n;
    }
  };

  try {
    assertInvariants(s);
  } catch (error) {
    add("accounting-invariants", error instanceof Error ? error.message : String(error));
  }

  const expectedVault = safe("vault", () => vaultBalanceRaw(s));
  if (input.vaultBalanceRaw === null) {
    if (m.status !== "Closed" && m.status !== "Cancelled")
      add("vault-missing", `vault account absent while mandate is ${m.status}`);
    if (expectedVault !== 0n)
      add("vault-closed-with-funds", `vault gone but the ledger expects ${expectedVault}`);
  } else if (input.vaultBalanceRaw !== expectedVault) {
    add(
      "vault-balance",
      `vault holds ${input.vaultBalanceRaw} but max - claimed - sponsorWithdrawn = ${expectedVault}`,
    );
  }

  // Epoch results against the counters.
  const seen = new Set<number>();
  let earned = 0n;
  let forfeited = 0n;
  const counts = { Compliant: 0, NonCompliant: 0, Unavailable: 0 };
  for (const r of results) {
    if (r.epochIndex >= m.totalEpochs) add("result-range", `epoch ${r.epochIndex} is out of range`);
    if (seen.has(r.epochIndex)) add("result-duplicate", `epoch ${r.epochIndex} appears twice`);
    seen.add(r.epochIndex);
    if (m.totalEpochs > 0 && r.epochIndex < m.totalEpochs) {
      const share = epochReward(m.acceptedRewardRaw, m.totalEpochs, r.epochIndex);
      const wantEarned = r.outcome === "Compliant" ? share : 0n;
      const wantForfeited = r.outcome === "Compliant" ? 0n : share;
      if (r.rewardEarnedRaw !== wantEarned || r.rewardForfeitedRaw !== wantForfeited)
        add(
          "result-reward",
          `epoch ${r.epochIndex} ${r.outcome}: earned ${r.rewardEarnedRaw} forfeited ${r.rewardForfeitedRaw}, expected ${wantEarned}/${wantForfeited}`,
        );
    }
    earned += r.rewardEarnedRaw;
    forfeited += r.rewardForfeitedRaw;
    counts[r.outcome] += 1;
  }
  if (results.length !== m.finalizedEpochs)
    add("result-count", `${results.length} results but finalizedEpochs = ${m.finalizedEpochs}`);
  if (earned !== m.earnedRewardRaw)
    add("result-earned", `results earned ${earned} but mandate says ${m.earnedRewardRaw}`);
  if (forfeited !== m.forfeitedRewardRaw)
    add(
      "result-forfeited",
      `results forfeited ${forfeited} but mandate says ${m.forfeitedRewardRaw}`,
    );
  if (
    counts.Compliant !== m.compliantEpochs ||
    counts.NonCompliant !== m.noncompliantEpochs ||
    counts.Unavailable !== m.unavailableEpochs
  )
    add(
      "result-outcomes",
      `results ${JSON.stringify(counts)} vs mandate ${m.compliantEpochs}/${m.noncompliantEpochs}/${m.unavailableEpochs}`,
    );

  const resolved = m.finalizedEpochs === m.totalEpochs;
  if (resolved && m.status === "Active")
    add("status", "every epoch is resolved but the mandate is still Active");
  if (!resolved && (m.status === "AwaitingFinalization" || m.status === "Closed"))
    add("status", `${m.status} with only ${m.finalizedEpochs}/${m.totalEpochs} epochs resolved`);
  if (
    m.status === "Closed" &&
    (safe("claimable", () => claimableRaw(s)) !== 0n ||
      safe("withdrawable", () => sponsorWithdrawableRaw(s)) !== 0n)
  )
    add("closed-with-entitlements", "a Closed mandate still has claimable or withdrawable funds");

  const claimable = safe("claimable", () => claimableRaw(s));
  const unresolved = safe("unresolved", () => unresolvedRewardRaw(s));
  return {
    ok: findings.length === 0,
    findings,
    ledger: {
      depositedRaw: m.maxRewardRaw,
      earnedRaw: m.earnedRewardRaw,
      forfeitedRaw: m.forfeitedRewardRaw,
      unresolvedRaw: unresolved,
      claimedRaw: m.claimedRewardRaw,
      claimableRaw: claimable,
      sponsorWithdrawnRaw: m.sponsorWithdrawnRaw,
      sponsorWithdrawableRaw: safe("withdrawable", () => sponsorWithdrawableRaw(s)),
      expectedVaultRaw: expectedVault,
      actualVaultRaw: input.vaultBalanceRaw,
      remainingObligationsRaw: claimable + unresolved,
    },
  };
}

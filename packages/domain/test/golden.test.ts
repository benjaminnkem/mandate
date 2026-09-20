import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DomainError,
  addU64,
  ceilDivU64,
  claim,
  divU64,
  epochBounds,
  epochPositionAt,
  epochReward,
  evaluateCompliance,
  finalizeEpoch,
  mulDivCeilU64,
  mulDivFloorU64,
  mulU64,
  newAccounting,
  sponsorWithdraw,
  splitReward,
  subU64,
  buildSchedule,
  acceptanceCutoff,
  validateBid,
  validateCreateMandate,
  assertInvariants,
  claimableRaw,
  unresolvedRewardRaw,
  sponsorWithdrawableRaw,
  vaultBalanceRaw,
  allEpochsResolved,
  type AccountingState,
  type ProtocolLimits,
  type EpochStatus,
  type CreateMandateParams,
} from "../src/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
const vectors: any = JSON.parse(
  readFileSync(new URL("../vectors/golden.json", import.meta.url), "utf8"),
);

/** Run `fn` and return `{ ok }` or `{ err }` with the domain error code, like the vectors. */
function outcome<T>(fn: () => T): { ok: T } | { err: string } {
  try {
    return { ok: fn() };
  } catch (error) {
    if (error instanceof DomainError) return { err: error.code };
    throw error;
  }
}

const big = (x: string): bigint => BigInt(x);

describe("golden vectors: checked math", () => {
  for (const c of vectors.checked_math) {
    const name = `${c.op}(${c.a}, ${c.b}${c.c === undefined ? "" : `, ${c.c}`})`;
    it(name, () => {
      const a = big(c.a);
      const b = big(c.b);
      const run = {
        add: () => addU64(a, b),
        sub: () => subU64(a, b),
        mul: () => mulU64(a, b),
        div: () => divU64(a, b),
        ceil_div: () => ceilDivU64(a, b),
        mul_div_floor: () => mulDivFloorU64(a, b, big(c.c)),
        mul_div_ceil: () => mulDivCeilU64(a, b, big(c.c)),
      }[c.op as string];
      const result = outcome(() => (run as () => bigint)());
      expect("ok" in result ? { ok: result.ok.toString() } : result).toEqual(c.expect);
    });
  }
});

describe("golden vectors: reward split", () => {
  for (const c of vectors.reward_split) {
    it(`reward ${c.reward} over ${c.epochs} epochs`, () => {
      if (c.expect) {
        expect(outcome(() => splitReward(big(c.reward), c.epochs))).toEqual(c.expect);
        return;
      }
      const split = splitReward(big(c.reward), c.epochs);
      expect(split.base.toString()).toBe(c.base);
      expect(split.extra.toString()).toBe(c.extra);
      if (c.all_epoch_rewards) {
        const rewards = Array.from({ length: c.epochs }, (_, i) =>
          epochReward(big(c.reward), c.epochs, i),
        );
        expect(rewards.map(String)).toEqual(c.all_epoch_rewards);
        expect(rewards.reduce((a, b) => a + b, 0n)).toBe(big(c.reward)); // conservation
      }
      for (const s of c.sampled) {
        const r = outcome(() => epochReward(big(c.reward), c.epochs, s.index));
        expect("ok" in r ? { ok: r.ok.toString() } : r).toEqual(s.expect);
      }
    });
  }
});

describe("golden vectors: schedule and epoch timing", () => {
  for (const c of vectors.schedule) {
    it(`schedule start=${c.start_at} duration=${c.duration_seconds} epoch=${c.epoch_seconds}`, () => {
      const r = outcome(() =>
        buildSchedule(big(c.start_at), big(c.duration_seconds), big(c.epoch_seconds)),
      );
      const shaped =
        "ok" in r ? { ok: { total_epochs: r.ok.totalEpochs, end_at: r.ok.endAt.toString() } } : r;
      expect(shaped).toEqual(c.expect);
    });
  }
  for (const c of vectors.timing.positions) {
    it(`position ts=${c.ts}`, () => {
      const p = epochPositionAt(
        {
          startAt: big(c.start_at),
          epochSeconds: big(c.epoch_seconds),
          totalEpochs: c.total_epochs,
        },
        big(c.ts),
      );
      expect(p.kind).toBe(c.expect.kind);
      if (c.expect.kind === "Epoch") expect(p).toMatchObject({ index: c.expect.index });
    });
  }
  for (const c of vectors.timing.bounds) {
    it(`bounds index=${c.index}`, () => {
      const r = outcome(() =>
        epochBounds(
          {
            startAt: big(c.start_at),
            epochSeconds: big(c.epoch_seconds),
            totalEpochs: c.total_epochs,
          },
          c.index,
          big(c.recovery_seconds),
        ),
      );
      const shaped =
        "ok" in r
          ? {
              ok: {
                epoch_start: r.ok.epochStart.toString(),
                epoch_end: r.ok.epochEnd.toString(),
                recovery_deadline: r.ok.recoveryDeadline.toString(),
              },
            }
          : r;
      expect(shaped).toEqual(c.expect);
    });
  }
});

describe("golden vectors: acceptance cutoff", () => {
  for (const c of vectors.acceptance_cutoff) {
    it(`cutoff start=${c.start_at} buffer=${c.position_lock_buffer_seconds} setup=${c.min_setup_window_seconds}`, () => {
      const r = outcome(() =>
        acceptanceCutoff(
          big(c.start_at),
          big(c.position_lock_buffer_seconds),
          big(c.min_setup_window_seconds),
        ),
      );
      expect("ok" in r ? { ok: r.ok.toString() } : r).toEqual(c.expect);
    });
  }
});

describe("golden vectors: compliance", () => {
  vectors.compliance.forEach((c: any, i: number) => {
    it(`case ${String(i)}`, () => {
      const t = c.thresholds;
      const m = c.metrics;
      const result = evaluateCompliance(
        {
          effectiveSpreadBps: m.effective_spread_bps,
          poolBuyDepthQuoteRaw: big(m.pool_buy_depth_quote_raw),
          poolSellDepthQuoteRaw: big(m.pool_sell_depth_quote_raw),
          providerQuoteInBandRaw: big(m.provider_quote_in_band_raw),
          providerBaseQuoteEqInBandRaw: big(m.provider_base_quote_eq_in_band_raw),
        },
        {
          maxEffectiveSpreadBps: t.max_effective_spread_bps,
          minPoolBuyDepthQuoteRaw: big(t.min_pool_buy_depth_quote_raw),
          minPoolSellDepthQuoteRaw: big(t.min_pool_sell_depth_quote_raw),
          minProviderQuoteInBandRaw: big(t.min_provider_quote_in_band_raw),
          minProviderBaseQuoteEqInBandRaw: big(t.min_provider_base_quote_eq_in_band_raw),
        },
      );
      expect({ compliant: result.compliant, failures: result.failures }).toEqual(c.expect);
    });
  });
});

function snapshot(s: AccountingState): Record<string, unknown> {
  return {
    finalized_epochs: s.finalizedEpochs,
    compliant_epochs: s.compliantEpochs,
    noncompliant_epochs: s.noncompliantEpochs,
    unavailable_epochs: s.unavailableEpochs,
    earned_reward_raw: s.earnedRewardRaw.toString(),
    forfeited_reward_raw: s.forfeitedRewardRaw.toString(),
    claimed_reward_raw: s.claimedRewardRaw.toString(),
    sponsor_withdrawn_raw: s.sponsorWithdrawnRaw.toString(),
    claimable_raw: claimableRaw(s).toString(),
    unresolved_raw: unresolvedRewardRaw(s).toString(),
    sponsor_withdrawable_raw: sponsorWithdrawableRaw(s).toString(),
    vault_balance_raw: vaultBalanceRaw(s).toString(),
    all_epochs_resolved: allEpochsResolved(s),
  };
}

describe("golden vectors: accounting scenarios", () => {
  for (const sc of vectors.accounting) {
    it(sc.name, () => {
      let state = newAccounting(
        big(sc.max_reward_raw),
        big(sc.accepted_reward_raw),
        sc.total_epochs,
      );
      const finalized = new Set<number>();
      for (const step of sc.steps) {
        const amount = (): bigint | "all" => (step.amount === "all" ? "all" : big(step.amount));
        const result = outcome(() => {
          if (step.op === "finalize") {
            const next = finalizeEpoch(
              state,
              step.index,
              step.outcome as EpochStatus,
              finalized.has(step.index),
            );
            finalized.add(step.index);
            return next;
          }
          return (step.op === "claim" ? claim(state, amount()) : sponsorWithdraw(state, amount()))
            .state;
        });
        if ("ok" in result) state = result.ok;
        expect(
          "ok" in result ? { ok: true } : result,
          `${step.op} ${JSON.stringify(step)}`,
        ).toEqual(step.expect);
        expect(snapshot(state)).toEqual(step.after);
        assertInvariants(state);
      }
    });
  }
});

function limits(p: any): ProtocolLimits {
  return {
    minBudgetRaw: big(p.min_budget_raw),
    maxBudgetRaw: big(p.max_budget_raw),
    minEpochSeconds: big(p.min_epoch_seconds),
    maxEpochSeconds: big(p.max_epoch_seconds),
    maxDurationSeconds: big(p.max_duration_seconds),
    maxEpochs: p.max_epochs,
    maxSpreadBps: p.max_spread_bps,
    maxDepthBandBps: p.max_depth_band_bps,
    minProbeQuoteRaw: big(p.min_probe_quote_raw),
    maxProbeQuoteRaw: big(p.max_probe_quote_raw),
    minStartLeadSeconds: big(p.min_start_lead_seconds),
    positionLockBufferSeconds: big(p.position_lock_buffer_seconds),
    minSetupWindowSeconds: big(p.min_setup_window_seconds),
  };
}

describe("golden vectors: validation", () => {
  const protocol = limits(vectors.validation.protocol);
  for (const c of vectors.validation.create_mandate) {
    it(`create: ${c.name}`, () => {
      const p = c.params;
      const params: CreateMandateParams = {
        maxRewardRaw: big(p.max_reward_raw),
        biddingEndsAt: big(p.bidding_ends_at),
        startAt: big(p.start_at),
        durationSeconds: big(p.duration_seconds),
        epochSeconds: big(p.epoch_seconds),
        maxEffectiveSpreadBps: p.max_effective_spread_bps,
        depthBandBps: p.depth_band_bps,
        minPoolBuyDepthQuoteRaw: big(p.min_pool_buy_depth_quote_raw),
        minPoolSellDepthQuoteRaw: big(p.min_pool_sell_depth_quote_raw),
        minProviderQuoteInBandRaw: big(p.min_provider_quote_in_band_raw),
        minProviderBaseQuoteEqInBandRaw: big(p.min_provider_base_quote_eq_in_band_raw),
        probeQuoteRaw: big(p.probe_quote_raw),
      };
      expect({ errors: validateCreateMandate(params, protocol, big(c.now)) }).toEqual(c.expect);
    });
  }
  for (const c of vectors.validation.bid) {
    it(`bid: ${c.name}`, () => {
      const errors = validateBid({
        requestedRewardRaw: big(c.requested_reward_raw),
        validUntil: big(c.valid_until),
        maxRewardRaw: big(c.max_reward_raw),
        now: big(c.now),
        totalEpochs: c.total_epochs,
        acceptanceCutoff: big(c.acceptance_cutoff),
      });
      expect({ errors }).toEqual(c.expect);
    });
  }
});

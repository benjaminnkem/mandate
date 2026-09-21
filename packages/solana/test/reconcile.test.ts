import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  reconcileMandate,
  type EpochResultAccount,
  type MandateAccount,
  type MetricsAccount,
} from "../src/index.ts";

const key = new PublicKey(new Uint8Array(32).fill(1));
const zeroMetrics: MetricsAccount = {
  effectiveSpreadBps: 0,
  poolBuyDepthQuoteRaw: 0n,
  poolSellDepthQuoteRaw: 0n,
  providerQuoteInBandRaw: 0n,
  providerBaseQuoteEqInBandRaw: 0n,
};

/** Three epochs over 100 raw units (33, 33, 34) funded with 130: epoch 0 compliant, 1 unavailable. */
function mandate(over: Partial<MandateAccount> = {}): MandateAccount {
  return {
    maxRewardRaw: 130n,
    acceptedRewardRaw: 100n,
    totalEpochs: 3,
    finalizedEpochs: 2,
    compliantEpochs: 1,
    noncompliantEpochs: 0,
    unavailableEpochs: 1,
    earnedRewardRaw: 33n,
    forfeitedRewardRaw: 33n,
    claimedRewardRaw: 10n,
    sponsorWithdrawnRaw: 5n,
    status: "Active",
    ...over,
  } as MandateAccount;
}

const result = (
  epochIndex: number,
  outcome: EpochResultAccount["outcome"],
  over: Partial<EpochResultAccount> = {},
): EpochResultAccount => ({
  mandate: key,
  epochIndex,
  outcome,
  rewardEarnedRaw: outcome === "Compliant" ? 33n : 0n,
  rewardForfeitedRaw: outcome === "Compliant" ? 0n : 33n,
  failureBits: 0,
  attestationCount: 2,
  observedSlot: 1n,
  observedUnixTs: 1n,
  algorithmVersion: 1,
  positionSet: key,
  payloadHash: new Uint8Array(32),
  evidenceHash: new Uint8Array(32),
  metrics: zeroMetrics,
  finalizedBy: key,
  finalizedAt: 1n,
  ...over,
});

const good = { vaultBalanceRaw: 115n, results: [result(0, "Compliant"), result(1, "Unavailable")] };

describe("reconcileMandate", () => {
  it("passes when counters, results and the vault agree, and reports the ledger", () => {
    const r = reconcileMandate({ mandate: mandate(), ...good });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.ledger).toMatchObject({
      depositedRaw: 130n,
      earnedRaw: 33n,
      forfeitedRaw: 33n,
      unresolvedRaw: 34n,
      claimableRaw: 23n,
      expectedVaultRaw: 115n,
      remainingObligationsRaw: 57n,
    });
  });

  it("flags a vault that is off by one raw unit, in either direction", () => {
    for (const vault of [114n, 116n]) {
      const r = reconcileMandate({ mandate: mandate(), ...good, vaultBalanceRaw: vault });
      expect(r.ok).toBe(false);
      expect(r.findings.map((f) => f.check)).toContain("vault-balance");
    }
  });

  it("flags counters that disagree with the epoch results", () => {
    const cases: [string, Partial<MandateAccount>][] = [
      ["result-earned", { earnedRewardRaw: 34n }],
      ["result-forfeited", { forfeitedRewardRaw: 32n }],
      ["result-outcomes", { compliantEpochs: 0, noncompliantEpochs: 1 }],
    ];
    for (const [check, over] of cases) {
      const r = reconcileMandate({ mandate: mandate(over), ...good });
      expect(
        r.findings.map((f) => f.check),
        check,
      ).toContain(check);
    }
  });

  it("flags a missing, duplicated or mis-rewarded result", () => {
    const missing = reconcileMandate({
      mandate: mandate(),
      ...good,
      results: [result(0, "Compliant")],
    });
    expect(missing.findings.map((f) => f.check)).toContain("result-count");
    const dup = reconcileMandate({
      mandate: mandate(),
      ...good,
      results: [result(0, "Compliant"), result(0, "Compliant")],
    });
    expect(dup.findings.map((f) => f.check)).toContain("result-duplicate");
    const wrong = reconcileMandate({
      mandate: mandate(),
      ...good,
      results: [result(0, "Compliant", { rewardEarnedRaw: 34n }), result(1, "Unavailable")],
    });
    expect(wrong.findings.map((f) => f.check)).toContain("result-reward");
  });

  it("flags a broken invariant such as claiming more than was earned", () => {
    const r = reconcileMandate({
      mandate: mandate({ claimedRewardRaw: 34n }),
      ...good,
      vaultBalanceRaw: 91n,
    });
    expect(r.findings.map((f) => f.check)).toContain("accounting-invariants");
  });

  it("checks the final epoch remainder and the terminal states", () => {
    const done = mandate({
      finalizedEpochs: 3,
      compliantEpochs: 2,
      earnedRewardRaw: 67n,
      claimedRewardRaw: 67n,
      sponsorWithdrawnRaw: 63n,
      status: "Closed",
    });
    const results = [
      result(0, "Compliant"),
      result(1, "Unavailable"),
      result(2, "Compliant", { rewardEarnedRaw: 34n }),
    ];
    const r = reconcileMandate({ mandate: done, vaultBalanceRaw: null, results });
    expect(r.findings).toEqual([]);
    expect(r.ledger.remainingObligationsRaw).toBe(0n);
    // A vault that vanished while funds remained is an incident.
    const gone = reconcileMandate({ mandate: mandate(), ...good, vaultBalanceRaw: null });
    expect(gone.findings.map((f) => f.check)).toEqual(
      expect.arrayContaining(["vault-missing", "vault-closed-with-funds"]),
    );
  });

  it("flags status that contradicts the counters", () => {
    const r = reconcileMandate({
      mandate: mandate({ status: "Closed" }),
      ...good,
    });
    expect(r.findings.map((f) => f.check)).toContain("status");
  });
});

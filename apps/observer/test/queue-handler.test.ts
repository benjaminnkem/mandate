import { describe, expect, it } from "vitest";

import { AttestationConflictError } from "../src/errors.ts";
import type { JobResult } from "../src/job.ts";
import { observeHandler, toOutcome } from "../src/queue-handler.ts";

const job = {
  key: "observe:M:0:A",
  kind: "observe",
  owner: "A",
  payload: { mandate: "M", epoch: 0 },
  state: "running",
  attempts: 1,
  maxAttempts: 6,
  runAt: new Date(),
  leaseUntil: null,
  lastError: null,
} as const;

describe("observe queue handler", () => {
  it("finishes, waits, or fails according to what the epoch job reported", () => {
    const done: JobResult[] = [
      { status: "attested", role: "leader", signature: "s", payloadHash: "p", evidenceHash: "e" },
      { status: "already-attested", payloadHash: "p", localEvidence: true },
      { status: "mandate-not-active" },
      { status: "epoch-out-of-range" },
      { status: "window-closed" },
    ];
    for (const r of done) expect(toOutcome(r)).toBe("done");
    expect(toOutcome({ status: "too-early", actsAt: 1_000 })).toEqual({
      deferUntil: new Date(1_000_000),
      reason: "too-early",
    });
    expect(toOutcome({ status: "waiting-for-leader", actsAt: 2_000, rank: 1 })).toMatchObject({
      reason: "waiting-for-leader",
    });
    expect(() => toOutcome({ status: "cannot-verify", reasons: ["hash differs"] })).toThrow(
      /hash differs/,
    );
  });

  it("never retries a conflict between chain and local evidence", async () => {
    const handler = observeHandler(() =>
      Promise.reject(new AttestationConflictError("on-chain attestation differs")),
    );
    expect(await handler(job)).toEqual({ fatal: "on-chain attestation differs" });
    const flaky = observeHandler(() => Promise.reject(new Error("rpc down")));
    await expect(flaky(job)).rejects.toThrow("rpc down");
  });

  it("passes the job's mandate and epoch through", async () => {
    let seen: unknown;
    await observeHandler((input) => {
      seen = input;
      return Promise.resolve({ status: "window-closed" });
    })(job);
    expect(seen).toEqual({ mandate: "M", epochIndex: 0 });
  });
});

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildEvidence, replayPool } from "@mandate/meteora";
import { describe, expect, it } from "vitest";

import { AttestationConflictError } from "../src/errors.ts";
import { FilesystemEvidenceStore } from "../src/evidence-store.ts";
import { runEpochJob, type JobDeps } from "../src/job.ts";
import { leaderOrder } from "../src/leader.ts";
import {
  EPOCH,
  EPOCH_END,
  MANDATE_ADDRESS,
  OBSERVE_AT,
  RECOVERY,
  World,
  config,
  fixtureMeasurer,
  mandateAccount,
  newObservers,
  provenance,
  spyLogger,
  snapshot,
  POSITIONS,
  BASE,
  POOL,
  PROVIDER,
  USDC,
} from "./support.ts";

const input = { mandate: MANDATE_ADDRESS, epochIndex: EPOCH };
const tmp = (): string => mkdtempSync(join(tmpdir(), "mandate-observer-"));

/** Three observers in a shared world with a shared evidence directory. */
function setup(over: { measurer?: ReturnType<typeof fixtureMeasurer> } = {}) {
  const keys = newObservers(3);
  const ids = keys.map((k) => k.publicKey.toBase58());
  const world = new World(ids);
  const dir = tmp();
  const spy = spyLogger();
  const measurer = over.measurer ?? fixtureMeasurer();
  const deps = (i: number, overrides: Partial<JobDeps> = {}): JobDeps => ({
    chain: world.port(ids[i] ?? ""),
    store: new FilesystemEvidenceStore(dir),
    measurer,
    logger: spy.logger,
    config: config(`observer-${String(i + 1)}`),
    ...overrides,
  });
  // For epoch 2 the primary leader is the observer at rotation index 2 % 3 = 2.
  const order = leaderOrder(EPOCH, ids);
  const idx = (o: string | undefined): number => ids.indexOf(o ?? "");
  return {
    keys,
    ids,
    world,
    dir,
    spy,
    measurer,
    deps,
    primary: idx(order[0]),
    second: idx(order[1]),
    third: idx(order[2]),
  };
}

describe("the leader", () => {
  it("observes, persists evidence BEFORE submitting, and submits an attestation that matches the evidence", async () => {
    const s = setup();
    let evidenceExistedAtSubmit = false;
    s.world.onSubmit = (submitted, observer) => {
      const record = readdirSync(join(s.dir, "records")).length > 0;
      const snap = readdirSync(join(s.dir, "snapshots")).length > 0;
      const own = readFileSync(
        join(s.dir, "index", MANDATE_ADDRESS, String(EPOCH), `${observer}.json`),
        "utf8",
      );
      evidenceExistedAtSubmit = record && snap && own.includes(submitted.evidenceHash);
    };
    const result = await runEpochJob(s.deps(s.primary), input);
    expect(result).toMatchObject({ status: "attested", role: "leader" });
    expect(evidenceExistedAtSubmit).toBe(true);

    const attestation = s.world.attestations.get(`${String(EPOCH)}:${s.ids[s.primary] ?? ""}`);
    expect(attestation?.metrics.effectiveSpreadBps).toBe(251);
    expect(attestation?.metrics.poolBuyDepthQuoteRaw).toBe(63_491_020_966n);
    expect(attestation?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent: a second run verifies and does not resubmit", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const again = await runEpochJob(s.deps(s.primary), input);
    expect(again).toMatchObject({ status: "already-attested", localEvidence: true });
    expect(s.world.submits).toHaveLength(1);
  });

  it("fails loudly when the chain holds an attestation that conflicts with its own stored evidence", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const key = `${String(EPOCH)}:${s.ids[s.primary] ?? ""}`;
    const onchain = s.world.attestations.get(key);
    if (!onchain) throw new Error("setup");
    s.world.attestations.set(key, { ...onchain, payloadHash: "f".repeat(64) });
    await expect(runEpochJob(s.deps(s.primary), input)).rejects.toThrow(AttestationConflictError);
  });

  it("reports (and logs an error) when it attested but has lost its local evidence", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const fresh = s.deps(s.primary, { store: new FilesystemEvidenceStore(tmp()) });
    expect(await runEpochJob(fresh, input)).toMatchObject({
      status: "already-attested",
      localEvidence: false,
    });
    expect(s.spy.errors().some((e) => String(e["msg"]).includes("no local evidence"))).toBe(true);
  });

  it("does not attest an observation that falls outside the epoch", async () => {
    // Epoch 3 is [1789922100, 1789922400); the recorded snapshot's clock (1789921836) is not inside it.
    const s = setup();
    s.world.now = EPOCH_END + 300 - 60; // observeAt of epoch 3
    const order3 = leaderOrder(3, s.ids);
    const primary3 = s.ids.indexOf(order3[0] ?? "");
    const result = await runEpochJob(s.deps(primary3), { mandate: MANDATE_ADDRESS, epochIndex: 3 });
    expect(result).toMatchObject({ status: "observation-outside-epoch" });
    expect(s.world.submits).toHaveLength(0);
  });
});

describe("two observer identities over the same deterministic evidence", () => {
  it("produce identical payload hashes, evidence hashes and metrics, even in separate worlds", async () => {
    const a = setup();
    const b = setup();
    const ra = await runEpochJob(a.deps(a.primary), input);
    const rb = await runEpochJob(b.deps(b.primary), input);
    if (ra.status !== "attested" || rb.status !== "attested") throw new Error("both should attest");
    expect(a.ids[a.primary]).not.toBe(b.ids[b.primary]); // different keys, different processes
    expect(ra.payloadHash).toBe(rb.payloadHash);
    expect(ra.evidenceHash).toBe(rb.evidenceHash);
  });

  it("lets a follower reproduce the leader's hashes exactly and attest identically", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const follow = await runEpochJob(s.deps(s.second), input);
    expect(follow).toMatchObject({ status: "attested", role: "follower" });
    const third = await runEpochJob(s.deps(s.third), input);
    expect(third).toMatchObject({ status: "attested", role: "follower" });

    const all = s.ids.map((id) => s.world.attestations.get(`${String(EPOCH)}:${id}`));
    expect(all.every((x) => x !== undefined)).toBe(true);
    expect(new Set(all.map((x) => x?.payloadHash)).size).toBe(1);
    expect(new Set(all.map((x) => x?.evidenceHash)).size).toBe(1);
    expect(
      new Set(
        all.map((x) =>
          JSON.stringify(x?.metrics, (_k, v: unknown) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        ),
      ).size,
    ).toBe(1);
    expect(new Set(all.map((x) => x?.observedSlot)).size).toBe(1);
    expect(new Set(all.map((x) => x?.observer)).size).toBe(3);
    expect(s.measurer.liveCalls).toBe(1 + 2); // leader's observation, plus each follower's plausibility read
  });

  it("matches what the measurement engine itself produces for the same snapshot", async () => {
    const s = setup();
    const leader = await runEpochJob(s.deps(s.primary), input);
    if (leader.status !== "attested") throw new Error("setup");
    const params = {
      pool: POOL,
      baseMint: BASE,
      quoteMint: USDC,
      provider: PROVIDER,
      positions: POSITIONS,
      probeQuoteRaw: 10_000_000n,
      depthBandBps: 500n,
    };
    const direct = buildEvidence(
      await replayPool(snapshot, params),
      {
        cluster: "mainnet-beta",
        mandate: MANDATE_ADDRESS,
        epochIndex: EPOCH,
        positionSet: s.world.context().positionSetAddress,
      },
      provenance,
      { probeQuoteRaw: 10_000_000n, depthBandBps: 500n },
      { observerInstanceId: "x", rpcHost: null },
    );
    expect(leader.payloadHash).toBe(direct.payloadHash);
    expect(leader.evidenceHash).toBe(direct.evidenceHash);
  });
});

describe("a follower signs only what it can reproduce", () => {
  async function leaderThen() {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    return s;
  }
  const leaderKey = (s: ReturnType<typeof setup>): string =>
    `${String(EPOCH)}:${s.ids[s.primary] ?? ""}`;

  it("refuses when the leader's hashes are not reproduced", async () => {
    const s = await leaderThen();
    const a = s.world.attestations.get(leaderKey(s));
    if (!a) throw new Error("setup");
    s.world.attestations.set(leaderKey(s), { ...a, payloadHash: "e".repeat(64) });
    const result = await runEpochJob(s.deps(s.second), input);
    expect(result.status).toBe("cannot-verify");
    expect(s.world.attestations.has(`${String(EPOCH)}:${s.ids[s.second] ?? ""}`)).toBe(false);
  });

  it("refuses when the leader's attested metrics differ from the replay", async () => {
    const s = await leaderThen();
    const a = s.world.attestations.get(leaderKey(s));
    if (!a) throw new Error("setup");
    // hashes intact, but the leader claims a better spread than its own evidence supports
    s.world.attestations.set(leaderKey(s), {
      ...a,
      metrics: { ...a.metrics, effectiveSpreadBps: 1 },
    });
    expect((await runEpochJob(s.deps(s.second), input)).status).toBe("cannot-verify");
  });

  it("refuses when the leader's evidence is not available", async () => {
    const s = await leaderThen();
    const result = await runEpochJob(
      s.deps(s.second, { store: new FilesystemEvidenceStore(tmp()) }),
      input,
    );
    expect(result).toMatchObject({ status: "cannot-verify" });
    expect(s.spy.errors().some((e) => String(e["msg"]).includes("not signing"))).toBe(true);
  });

  it("refuses a snapshot that no longer hashes to its name", async () => {
    const s = await leaderThen();
    const file = join(s.dir, "snapshots", readdirSync(join(s.dir, "snapshots"))[0] ?? "");
    const tampered = JSON.parse(readFileSync(file, "utf8")) as { label: string };
    tampered.label = "tampered";
    writeFileSync(file, JSON.stringify(tampered));
    const result = await runEpochJob(s.deps(s.second), input);
    expect(result.status).toBe("cannot-verify");
    expect(JSON.stringify(result)).toMatch(/altered or corrupted/);
  });

  it("refuses to sign for a peer built from different code (provenance is part of the hash)", async () => {
    const s = await leaderThen();
    const result = await runEpochJob(
      s.deps(s.second, {
        config: config("observer-x", {
          provenance: { ...provenance, algorithmSourceCommit: "OTHER-COMMIT" },
        }),
      }),
      input,
    );
    expect(result.status).toBe("cannot-verify");
    expect(JSON.stringify(result)).toMatch(/does not reproduce their hashes/);
  });

  it("refuses a snapshot that is implausible against the live chain", async () => {
    let drifted = false;
    const s = setup({
      measurer: fixtureMeasurer((o) =>
        drifted ? { ...o, pool: { ...o.pool, activeId: o.pool.activeId + 500 } } : o,
      ),
    });
    await runEpochJob(s.deps(s.primary), input); // the leader is honest and observes real state
    drifted = true; // ...and the live chain has since moved a long way from the leader's snapshot
    const result = await runEpochJob(s.deps(s.second), input);
    expect(result.status).toBe("cannot-verify");
    expect(JSON.stringify(result)).toMatch(/active bin moved/);
    expect(s.world.attestations.has(`${String(EPOCH)}:${s.ids[s.second] ?? ""}`)).toBe(false);
  });

  it("logs an alert when two other observers disagree, and still refuses to average", async () => {
    const s = await leaderThen();
    const a = s.world.attestations.get(leaderKey(s));
    if (!a) throw new Error("setup");
    s.world.attestations.set(`${String(EPOCH)}:${s.ids[s.second] ?? ""}`, {
      ...a,
      observer: s.ids[s.second] ?? "",
      payloadHash: "d".repeat(64),
    });
    const result = await runEpochJob(s.deps(s.third), input);
    expect(s.spy.errors().some((e) => String(e["msg"]).includes("disagree"))).toBe(true);
    // it can still follow the one attestation it is able to reproduce exactly
    expect(result.status).toBe("attested");
  });
});

describe("timing and rotation", () => {
  it("does nothing before the primary leader's time", async () => {
    const s = setup();
    s.world.now = OBSERVE_AT - 1;
    expect(await runEpochJob(s.deps(s.primary), input)).toEqual({
      status: "too-early",
      actsAt: OBSERVE_AT,
    });
    expect(s.world.submits).toHaveLength(0);
  });

  it("makes each further rank wait one timeout, and lets the next rank lead if the primary is silent", async () => {
    const s = setup();
    s.world.now = OBSERVE_AT;
    expect(await runEpochJob(s.deps(s.second), input)).toMatchObject({
      status: "waiting-for-leader",
      rank: 1,
      actsAt: OBSERVE_AT + 15,
    });
    expect(await runEpochJob(s.deps(s.third), input)).toMatchObject({
      status: "waiting-for-leader",
      rank: 2,
      actsAt: OBSERVE_AT + 30,
    });
    s.world.now = OBSERVE_AT + 15;
    expect(await runEpochJob(s.deps(s.second), input)).toMatchObject({
      status: "attested",
      role: "leader",
    });
    // the third rank now finds an attestation and follows rather than competing
    s.world.now = OBSERVE_AT + 30;
    expect(await runEpochJob(s.deps(s.third), input)).toMatchObject({
      status: "attested",
      role: "follower",
    });
  });

  it("stops when the attestation window has closed", async () => {
    const s = setup();
    s.world.now = EPOCH_END + RECOVERY;
    expect(await runEpochJob(s.deps(s.primary), input)).toEqual({ status: "window-closed" });
  });

  it("rejects timing that cannot fit the observer count", async () => {
    const s = setup();
    const bad = s.deps(s.primary, {
      config: config("x", { timing: { observeLeadSeconds: 30, leaderTimeoutSeconds: 15 } }),
    });
    await expect(runEpochJob(bad, input)).rejects.toThrow(/does not fit/);
  });

  it("skips mandates that are not active and epochs that do not exist", async () => {
    const s = setup();
    s.world.mandate = mandateAccount({ status: "Awarded" });
    expect(await runEpochJob(s.deps(s.primary), input)).toEqual({ status: "mandate-not-active" });
    s.world.mandate = mandateAccount();
    expect(await runEpochJob(s.deps(s.primary), { ...input, epochIndex: 72 })).toEqual({
      status: "epoch-out-of-range",
    });
    expect(await runEpochJob(s.deps(s.primary), { ...input, epochIndex: -1 })).toEqual({
      status: "epoch-out-of-range",
    });
  });

  it("refuses to run with a key that is not in the observer set", async () => {
    const s = setup();
    const stranger = newObservers(1)[0]?.publicKey.toBase58() ?? "";
    await expect(runEpochJob(s.deps(0, { chain: s.world.port(stranger) }), input)).rejects.toThrow(
      /not in the mandate's observer set/,
    );
  });
});

describe("races with its own earlier submission", () => {
  /** A chain view that hides existing attestations from the first read only, as after a crash post-send. */
  const blindOnce = (deps: JobDeps): JobDeps => {
    let first = true;
    return {
      ...deps,
      chain: {
        ...deps.chain,
        loadAttestations: (m, e, o) => {
          if (first) {
            first = false;
            return Promise.resolve(new Map());
          }
          return deps.chain.loadAttestations(m, e, o);
        },
      },
    };
  };

  it("treats an identical existing attestation as done, not as an error", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const result = await runEpochJob(blindOnce(s.deps(s.primary)), input);
    expect(result).toMatchObject({ status: "already-attested", localEvidence: true });
    expect(s.world.attestations.size).toBe(1);
  });

  it("raises a conflict when the existing attestation differs from what was just computed", async () => {
    const s = setup();
    await runEpochJob(s.deps(s.primary), input);
    const key = `${String(EPOCH)}:${s.ids[s.primary] ?? ""}`;
    const onchain = s.world.attestations.get(key);
    if (!onchain) throw new Error("setup");
    s.world.attestations.set(key, { ...onchain, payloadHash: "9".repeat(64) });
    await expect(runEpochJob(blindOnce(s.deps(s.primary)), input)).rejects.toThrow(
      AttestationConflictError,
    );
  });
});

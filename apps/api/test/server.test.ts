import { migrate, upsertAccount, type Db } from "@mandate/db";
import { createTestDb } from "@mandate/db/testing";
import { createMetrics, createLogger } from "@mandate/observability";
import { MANDATE_PROGRAM_ID, findBidPda } from "@mandate/solana";
import { PublicKey } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiChain, ApiDeps } from "../src/deps.ts";
import { buildServer } from "../src/server.ts";
import { bn, encodeAccount, key, mandateFields } from "./support.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PROGRAM = MANDATE_PROGRAM_ID.toBase58();
const NOW = new Date("2026-09-22T12:00:00Z");

class FakeChain implements ApiChain {
  readonly accounts = new Map<string, { data: Uint8Array; owner: string }>();
  getAccount(a: PublicKey) {
    return Promise.resolve(this.accounts.get(a.toBase58()) ?? null);
  }
  getLatestBlockhash() {
    return Promise.resolve({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 4242,
    });
  }
}

function tokenAccount(mint: string, owner: PublicKey): Uint8Array {
  const data = new Uint8Array(165);
  data.set(new PublicKey(mint).toBytes(), 0);
  data.set(owner.toBytes(), 32);
  return data;
}

let db: Db;
let chain: FakeChain;
let app: FastifyInstance;
const M = key(50);
const SPONSOR = key(1);
const PROVIDER = key(9);

async function build(over: Partial<ApiDeps["config"]> = {}): Promise<void> {
  chain = new FakeChain();
  app = await buildServer(
    {
      db,
      chain,
      metrics: createMetrics("api-test"),
      prestocks: { getSnapshot: () => Promise.reject(new Error("offline")) },
      now: () => NOW,
      config: {
        cluster: "surfpool",
        programId: PROGRAM,
        usdcMint: USDC,
        rateLimitPerMinute: 1000,
        maxStalenessSeconds: 120,
        ...over,
      },
    },
    createLogger({ service: "api-test", level: "silent" }),
  );
}

async function seedIndexed(): Promise<void> {
  const market = key(2).toBase58();
  await upsertAccount(db, "MarketConfig", market, 10n, {
    pool: key(70).toBase58(),
    enabled: true,
    baseMint: key(71).toBase58(),
    quoteMint: USDC,
  });
  await upsertAccount(db, "Mandate", M.toBase58(), 10n, {
    sponsor: SPONSOR.toBase58(),
    provider: PROVIDER.toBase58(),
    marketConfig: market,
    status: "Active",
    startAt: "1000",
    endAt: "2000",
    totalEpochs: 3,
    finalizedEpochs: 1,
    compliantEpochs: 1,
    noncompliantEpochs: 0,
    unavailableEpochs: 0,
    maxRewardRaw: "130000000",
    acceptedRewardRaw: "100000000",
    earnedRewardRaw: "33333333",
    forfeitedRewardRaw: "0",
    claimedRewardRaw: "10000000",
    sponsorWithdrawnRaw: "0",
    epochSeconds: "300",
    vault: key(4).toBase58(),
    probeQuoteRaw: "10000000",
    depthBandBps: 500,
    algorithmVersion: 1,
  });
  await upsertAccount(db, "EpochResult", key(80).toBase58(), 11n, {
    mandate: M.toBase58(),
    epochIndex: 0,
    outcome: "Compliant",
    rewardEarnedRaw: "33333333",
    evidenceHash: "bb".repeat(32),
    payloadHash: "aa".repeat(32),
    observedSlot: "500",
    observedUnixTs: "1290",
    metrics: {
      effectiveSpreadBps: 251,
      poolBuyDepthQuoteRaw: "63491020966",
      poolSellDepthQuoteRaw: "49065543907",
      providerQuoteInBandRaw: "91107867",
      providerBaseQuoteEqInBandRaw: "81314309",
    },
  });
  for (const [i, o] of [key(31), key(32)].entries())
    await upsertAccount(db, "EpochAttestation", key(90 + i).toBase58(), 11n, {
      mandate: M.toBase58(),
      epochIndex: 0,
      observer: o.toBase58(),
      payloadHash: "aa".repeat(32),
      evidenceHash: "bb".repeat(32),
      observedSlot: "500",
      observedUnixTs: "1290",
      metrics: { effectiveSpreadBps: 251 },
    });
  await db.query(
    "INSERT INTO chain_cursor (name, last_signature, last_slot, updated_at) VALUES ('program-events','s',600,$1)",
    [new Date(NOW.getTime() - 5000)],
  );
}

beforeEach(async () => {
  db = await createTestDb();
  await migrate(db);
  await build();
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const get = async (url: string) => app.inject({ method: "GET", url });

describe("read routes", () => {
  it("names the network and freshness on every chain-derived response", async () => {
    await seedIndexed();
    const res = await get("/v1/mandates");
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({
      cluster: "surfpool",
      programId: PROGRAM,
      indexedSlot: "600",
      staleSeconds: 5,
      stale: false,
      source: "indexed-chain-state",
    });
  });

  it("flags an index that stopped advancing", async () => {
    await seedIndexed();
    await db.query("UPDATE chain_cursor SET updated_at = $1", [new Date(NOW.getTime() - 600_000)]);
    expect((await get("/v1/mandates")).json().meta).toMatchObject({
      stale: true,
      staleSeconds: 600,
    });
    expect((await get("/readyz")).statusCode).toBe(503);
  });

  it("returns a mandate with exact accounting derived from its counters", async () => {
    await seedIndexed();
    const body = (await get(`/v1/mandates/${M.toBase58()}`)).json();
    expect(body.data.accounting.claimableByProvider).toEqual({
      raw: "23333333",
      usdc: "23.333333",
    });
    expect(body.data.accounting.expectedVault).toEqual({ raw: "120000000", usdc: "120.000000" });
    expect(body.data.accounting.deposited.usdc).toBe("130.000000");
  });

  it("filters and paginates mandates with a keyset cursor and validates inputs", async () => {
    await seedIndexed();
    expect(
      (await get(`/v1/mandates?provider=${PROVIDER.toBase58()}&status=Active`)).json().data
        .mandates,
    ).toHaveLength(1);
    expect(
      (await get(`/v1/mandates?provider=${key(200).toBase58()}`)).json().data.mandates,
    ).toHaveLength(0);
    const bad = await get("/v1/mandates?limit=1000&status=Nope");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_request");
    expect((await get("/v1/mandates/not-a-key")).statusCode).toBe(400);
    expect((await get(`/v1/mandates/${key(123).toBase58()}`)).statusCode).toBe(404);
  });

  it("reports epoch timeline as Pending until a result exists on chain", async () => {
    await seedIndexed();
    const { epochs } = (await get(`/v1/mandates/${M.toBase58()}/epochs`)).json().data as {
      epochs: { outcome: string; attestationCount: number }[];
    };
    expect(epochs.map((e) => e.outcome)).toEqual(["Compliant", "Pending", "Pending"]);
    expect(epochs[0]?.attestationCount).toBe(2);
  });

  it("exposes reproducibility information for an epoch's evidence", async () => {
    await seedIndexed();
    const body = (await get(`/v1/mandates/${M.toBase58()}/evidence/0`)).json();
    expect(body.data.agreement).toMatchObject({ unanimous: true });
    expect(body.data.howToReproduce.expected).toMatchObject({
      payloadHash: "aa".repeat(32),
      evidenceHash: "bb".repeat(32),
    });
    expect(body.data.howToReproduce.parameters).toMatchObject({
      pool: key(70).toBase58(),
      probeQuoteRaw: "10000000",
      algorithmVersion: 1,
    });
    expect(body.data.evidence.note).toMatch(/not been registered/);
    expect((await get(`/v1/mandates/${M.toBase58()}/evidence/2`)).statusCode).toBe(404);
  });

  it("separates aggregate pool metrics from provider contribution and never invents quality", async () => {
    await seedIndexed();
    const q = (await get(`/v1/markets/${key(70).toBase58()}/quality`)).json().data;
    expect(q.latestAttestedEpoch.aggregatePool.buyDepthQuoteRaw).toBe("63491020966");
    expect(q.latestAttestedEpoch.providerContribution.quoteInBandRaw).toBe("91107867");
    await db.query("DELETE FROM epoch_results");
    const none = (await get(`/v1/markets/${key(70).toBase58()}/quality`)).json().data;
    expect(none.latestAttestedEpoch).toBeNull();
    expect((await get(`/v1/markets/${key(72).toBase58()}/quality`)).statusCode).toBe(404);
  });

  it("fails closed when PreStocks is unreachable, labelling external data when it is not", async () => {
    const res = await get("/v1/prestocks");
    expect(res.statusCode).toBe(500); // a non-PrestocksApiError is an internal error, not silent success
    await app.close();
    const { PrestocksApiError } = await import("@mandate/prestocks");
    app = await buildServer(
      {
        db,
        chain,
        metrics: createMetrics("x"),
        now: () => NOW,
        prestocks: { getSnapshot: () => Promise.reject(new PrestocksApiError("upstream down")) },
        config: {
          cluster: "surfpool",
          programId: PROGRAM,
          usdcMint: USDC,
          rateLimitPerMinute: 1000,
          maxStalenessSeconds: 120,
        },
      },
      createLogger({ service: "t", level: "silent" }),
    );
    const down = await get("/v1/prestocks");
    expect(down.statusCode).toBe(503);
    expect(down.json().error.code).toBe("prestocks_unavailable");
  });
});

describe("operations", () => {
  it("serves health, readiness and Prometheus metrics with request latency", async () => {
    await seedIndexed();
    expect((await get("/healthz")).json()).toEqual({ status: "ok" });
    expect((await get("/readyz")).statusCode).toBe(200);
    await get("/v1/mandates");
    const metrics = (await get("/metrics")).body;
    expect(metrics).toContain("api_request_latency_seconds_count");
    expect(metrics).toContain('route="/v1/mandates"');
  });

  it("reports not ready when a vault reconciliation is failing", async () => {
    await seedIndexed();
    await db.query(
      "INSERT INTO vault_reconciliations (mandate, checked_at, slot, ok, expected_raw, actual_raw, findings) VALUES ($1, now(), 1, false, 5, 4, '[]')",
      [M.toBase58()],
    );
    const r = await get("/readyz");
    expect(r.statusCode).toBe(503);
    expect(r.json().checks.vault_reconciliation.ok).toBe(false);
  });

  it("rate limits public reads but never health or metrics", async () => {
    await app.close();
    await build({ rateLimitPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await get("/v1/markets")).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    for (let i = 0; i < 10; i++) expect((await get("/healthz")).statusCode).toBe(200);
  });
});

describe("transaction building", () => {
  const post = (url: string, body: unknown) =>
    app.inject({ method: "POST", url, payload: body as object });

  async function chainMandate(status: string, over: Record<string, unknown> = {}): Promise<void> {
    chain.accounts.set(M.toBase58(), {
      owner: PROGRAM,
      data: await encodeAccount(
        "Mandate",
        mandateFields({
          status: { [status]: {} },
          sponsor: SPONSOR,
          provider: PROVIDER,
          max_reward_raw: bn(130_000_000),
          accepted_reward_raw: bn(100_000_000),
          total_epochs: 3,
          earned_reward_raw: bn(33_333_333),
          claimed_reward_raw: bn(10_000_000),
          finalized_epochs: 1,
          compliant_epochs: 1,
          ...over,
        }),
      ),
    });
  }
  const usdcAccount = key(60);

  it("builds an unsigned claim whose amounts it recomputed from chain state", async () => {
    await chainMandate("Active");
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(USDC, PROVIDER),
    });
    const res = await post("/v1/tx/claim", {
      wallet: PROVIDER.toBase58(),
      mandate: M.toBase58(),
      destinationUsdc: usdcAccount.toBase58(),
      amountRaw: "20000000",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toMatchObject({
      youReceive: { raw: "20000000", usdc: "20.000000" },
      claimableNow: { raw: "23333333" },
      remainingClaimableAfter: { raw: "3333333" },
    });
    expect(body.expiresAfterBlockHeight).toBe(4242);
    // The transaction really is unsigned and names the wallet as the only required signer.
    const { Transaction } = await import("@solana/web3.js");
    const tx = Transaction.from(Buffer.from(body.transaction, "base64"));
    expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
    expect(tx.feePayer?.toBase58()).toBe(PROVIDER.toBase58());
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]?.programId.toBase58()).toBe(PROGRAM);
  });

  it("refuses claims above the claimable amount, from non-providers, or to someone else's account", async () => {
    await chainMandate("Active");
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(USDC, PROVIDER),
    });
    const base = {
      wallet: PROVIDER.toBase58(),
      mandate: M.toBase58(),
      destinationUsdc: usdcAccount.toBase58(),
    };
    expect((await post("/v1/tx/claim", { ...base, amountRaw: "23333334" })).json().error.code).toBe(
      "amount_out_of_range",
    );
    expect((await post("/v1/tx/claim", { ...base, amountRaw: "0" })).json().error.code).toBe(
      "amount_out_of_range",
    );
    expect(
      (await post("/v1/tx/claim", { ...base, wallet: SPONSOR.toBase58(), amountRaw: "1" })).json()
        .error.code,
    ).toBe("not_provider");
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(USDC, key(77)),
    });
    expect((await post("/v1/tx/claim", { ...base, amountRaw: "1" })).json().error.code).toBe(
      "invalid_destination",
    );
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(key(78).toBase58(), PROVIDER),
    });
    expect((await post("/v1/tx/claim", { ...base, amountRaw: "1" })).json().error.code).toBe(
      "invalid_destination",
    );
  });

  it("withdraw allows only the sponsor and only what the rules release", async () => {
    await chainMandate("Active");
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(USDC, SPONSOR),
    });
    const base = {
      wallet: SPONSOR.toBase58(),
      mandate: M.toBase58(),
      destinationUsdc: usdcAccount.toBase58(),
    };
    // Surplus is 130 - 100 = 30 USDC while epochs are open; forfeited money is not released until all resolve.
    expect((await post("/v1/tx/withdraw", { ...base, amountRaw: "30000000" })).statusCode).toBe(
      200,
    );
    expect(
      (await post("/v1/tx/withdraw", { ...base, amountRaw: "30000001" })).json().error.code,
    ).toBe("amount_out_of_range");
    expect(
      (
        await post("/v1/tx/withdraw", { ...base, wallet: PROVIDER.toBase58(), amountRaw: "1" })
      ).json().error.code,
    ).toBe("not_sponsor");
  });

  it("validates bids against the mandate on chain", async () => {
    await chainMandate("Bidding", { bidding_ends_at: bn(9_999_999_999) });
    const ok = {
      wallet: PROVIDER.toBase58(),
      mandate: M.toBase58(),
      nonce: "1",
      requestedRewardRaw: "100000000",
      validUntil: "1800000000",
    };
    const res = await post("/v1/tx/submit-bid", ok);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({
      perEpochReward: { raw: "33333333" },
      finalEpochExtra: { raw: "1" },
    });
    expect(
      (await post("/v1/tx/submit-bid", { ...ok, requestedRewardRaw: "130000001" })).json().error
        .code,
    ).toBe("amount_out_of_range");
    expect((await post("/v1/tx/submit-bid", { ...ok, validUntil: "1" })).json().error.code).toBe(
      "expired",
    );
    await chainMandate("Active");
    expect((await post("/v1/tx/submit-bid", ok)).json().error.code).toBe("not_bidding");
  });

  it("builds an award that states the irreversible terms", async () => {
    await chainMandate("Bidding", { acceptance_cutoff: bn(1_700_000_000) });
    chain.accounts.set(findBidPda(M, PROVIDER, 1n).toBase58(), {
      owner: PROGRAM,
      data: await encodeAccount("Bid", {
        mandate: M,
        provider: PROVIDER,
        nonce: bn(1),
        requested_reward_raw: bn(90_000_000),
        status: { Active: {} },
      }),
    });
    const res = await post("/v1/tx/accept-bid", {
      wallet: SPONSOR.toBase58(),
      mandate: M.toBase58(),
      provider: PROVIDER.toBase58(),
      nonce: "1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({
      acceptedReward: { raw: "90000000" },
      surplusReleasedToYou: { raw: "40000000" },
      epochs: 3,
    });
    expect(res.json().summary.irreversible).toMatch(/permanently/);
  });

  it("registers positions only before the lock and explains that ownership is not checked on chain", async () => {
    await chainMandate("Awarded", { position_lock_at: bn(Math.floor(NOW.getTime() / 1000) + 600) });
    const body = {
      wallet: PROVIDER.toBase58(),
      mandate: M.toBase58(),
      positions: [key(100).toBase58(), key(101).toBase58()],
    };
    const res = await post("/v1/tx/register-positions", body);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.notice).toMatch(/does not verify you own/);
    expect(
      (
        await post("/v1/tx/register-positions", {
          ...body,
          positions: [key(100).toBase58(), key(100).toBase58()],
        })
      ).json().error.code,
    ).toBe("duplicate_position");
    expect((await post("/v1/tx/register-positions", { ...body, positions: [] })).statusCode).toBe(
      400,
    );
    await chainMandate("Awarded", { position_lock_at: bn(Math.floor(NOW.getTime() / 1000) - 1) });
    expect((await post("/v1/tx/register-positions", body)).json().error.code).toBe(
      "position_set_locked",
    );
  });

  it("rejects malformed bodies and never accepts a private key field", async () => {
    expect((await post("/v1/tx/claim", { wallet: "x" })).statusCode).toBe(400);
    expect((await post("/v1/tx/claim", "nonsense")).statusCode).toBeGreaterThanOrEqual(400);
    // Unknown fields (for example a secret key) are ignored by validation and never echoed back.
    await chainMandate("Active");
    chain.accounts.set(usdcAccount.toBase58(), {
      owner: "Tokenkeg",
      data: tokenAccount(USDC, PROVIDER),
    });
    const res = await post("/v1/tx/claim", {
      wallet: PROVIDER.toBase58(),
      mandate: M.toBase58(),
      destinationUsdc: usdcAccount.toBase58(),
      amountRaw: "1",
      secretKey: "SHOULD-NEVER-APPEAR",
    });
    expect(res.body).not.toContain("SHOULD-NEVER-APPEAR");
  });
});

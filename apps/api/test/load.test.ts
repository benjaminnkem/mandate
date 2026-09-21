import { migrate, type Db } from "@mandate/db";
import { createTestDb } from "@mandate/db/testing";
import { createLogger, createMetrics } from "@mandate/observability";
import { MANDATE_PROGRAM_ID } from "@mandate/solana";
import { seedSynthetic, type SyntheticWorld } from "@mandate/testkit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.ts";

/**
 * SYNTHETIC LOAD TEST. The data below is fabricated by @mandate/testkit and exists only to exercise the read paths at
 * scale. No production route serves fixtures. Size: LOAD_MANDATES (default 150; `pnpm test:load` uses thousands).
 */
const N = Number(process.env["LOAD_MANDATES"] ?? "150");
const EPOCHS = 72;
const NOW = 2_000_000_000;

let db: Db;
let app: FastifyInstance;
let world: SyntheticWorld;

beforeAll(async () => {
  db = await createTestDb();
  await migrate(db);
  world = await seedSynthetic(db, {
    mandates: N,
    epochsEach: EPOCHS,
    nowUnix: NOW,
    startOffsetSeconds: 40 * 300,
  });
  await db.query(
    "INSERT INTO chain_cursor (name, last_slot, updated_at) VALUES ('program-events', 1, $1)",
    [new Date(NOW * 1000)],
  );
  app = await buildServer(
    {
      db,
      chain: {
        getAccount: () => Promise.resolve(null),
        getLatestBlockhash: () => Promise.reject(new Error("unused")),
      },
      metrics: createMetrics("api-load"),
      prestocks: { getSnapshot: () => Promise.reject(new Error("unused")) },
      now: () => new Date(NOW * 1000),
      config: {
        cluster: "surfpool",
        programId: MANDATE_PROGRAM_ID.toBase58(),
        usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        rateLimitPerMinute: 10_000_000,
        maxStalenessSeconds: 120,
      },
    },
    createLogger({ service: "api-load", level: "silent" }),
  );
}, 600_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const pct = (xs: number[], p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

async function measure(name: string, urls: string[], concurrency = 16): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    await Promise.all(
      urls.slice(i, i + concurrency).map(async (url) => {
        const t = performance.now();
        const res = await app.inject({ method: "GET", url });
        times.push(performance.now() - t);
        expect(res.statusCode, `${name} ${url}`).toBe(200);
      }),
    );
  }
  const p95 = pct(times, 0.95);
  console.log(
    `SYNTHETIC LOAD TEST ${name}: n=${times.length} mandates=${N} p50=${pct(times, 0.5).toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${Math.max(...times).toFixed(1)}ms`,
  );
  return p95;
}

describe("read paths under synthetic load", () => {
  it("serves every mandate detail, epoch timeline and bid list", async () => {
    const sample = world.mandates.filter((_, i) => i % 10 !== 0).slice(0, 300);
    expect(
      await measure(
        "mandate detail",
        sample.map((m) => `/v1/mandates/${m}`),
      ),
    ).toBeLessThan(2000);
    expect(
      await measure(
        "epoch timeline",
        sample.map((m) => `/v1/mandates/${m}/epochs`),
      ),
    ).toBeLessThan(2000);
    expect(
      await measure(
        "bids",
        sample.map((m) => `/v1/mandates/${m}/bids`),
      ),
    ).toBeLessThan(2000);
  }, 600_000);

  it("pages through the entire mandate list with a keyset cursor, seeing each mandate exactly once", async () => {
    const seen = new Set<string>();
    interface Page {
      data: { mandates: { address: string }[]; nextAfter: string | null };
    }
    let after: string | null = null;
    let pages = 0;
    const t = performance.now();
    do {
      const url: string = `/v1/mandates?limit=100${after ? `&after=${after}` : ""}`;
      const res = await app.inject({ method: "GET", url });
      const body = res.json<Page>();
      for (const m of body.data.mandates) {
        expect(seen.has(m.address)).toBe(false);
        seen.add(m.address);
      }
      after = body.data.nextAfter;
      pages += 1;
    } while (after);
    console.log(
      `SYNTHETIC LOAD TEST list pagination: ${pages} pages, ${seen.size} mandates in ${(performance.now() - t).toFixed(0)}ms`,
    );
    expect(seen.size).toBe(N);
  }, 600_000);

  it("answers provider and filtered queries", async () => {
    const urls = world.providers.slice(0, 100).map((p) => `/v1/provider/${p}/mandates`);
    expect(await measure("provider mandates", urls)).toBeLessThan(2000);
    expect(
      await measure("filtered list", [
        `/v1/mandates?status=Active&limit=100`,
        `/v1/mandates?status=Bidding&limit=100`,
      ]),
    ).toBeLessThan(2000);
  }, 600_000);
});

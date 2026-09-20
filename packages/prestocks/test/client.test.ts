import { describe, expect, it, vi } from "vitest";

import { PrestocksApiError, PrestocksClient } from "../src/index.ts";

// TEST FIXTURE: shaped like the public API, not real market data.
const fixtureAsset = {
  name: "Fixture PreStocks",
  symbol: "FIXTURE",
  description: "test fixture",
  image: "https://example.invalid/i.png",
  external_url: "https://example.invalid/fixture",
  contract_address: "11111111111111111111111111111111",
  markPrice: 1,
  markValuation: 1,
  tokenPrice: 1,
  impliedValuation: 1,
  supply: 1,
};

const ok = (body: unknown): typeof fetch =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe("PrestocksClient", () => {
  it("parses a valid response and resolves by exact mint", async () => {
    const client = new PrestocksClient({ fetch: ok([fixtureAsset]) });
    expect((await client.findByMint("11111111111111111111111111111111"))?.symbol).toBe("FIXTURE");
    expect(await client.findByMint("FIXTURE")).toBeUndefined();
  });

  it("fails closed on schema drift", async () => {
    const drifted = { ...fixtureAsset, contract_address: undefined };
    await expect(new PrestocksClient({ fetch: ok([drifted]) }).getSnapshot()).rejects.toThrow(
      /schema drift/,
    );
  });

  it("fails closed on HTTP errors and network failures", async () => {
    const http500: typeof fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    await expect(new PrestocksClient({ fetch: http500 }).getSnapshot()).rejects.toThrow(
      PrestocksApiError,
    );
    const down: typeof fetch = () => Promise.reject(new Error("offline"));
    await expect(new PrestocksClient({ fetch: down }).getSnapshot()).rejects.toThrow(
      /request failed/,
    );
  });

  it("serves from cache inside the TTL and refetches after it", async () => {
    let t = 0;
    const fetcher = ok([fixtureAsset]);
    const client = new PrestocksClient({
      fetch: fetcher,
      cacheTtlMs: 1000,
      now: () => new Date(t),
    });
    await client.getSnapshot();
    t = 500;
    await client.getSnapshot();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 1500;
    await client.getSnapshot();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

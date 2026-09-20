import type { Quote, QuoteEngine } from "../src/index.ts";

/**
 * TEST FIXTURE. A constant-product venue with a proportional fee and an optional hard liquidity
 * limit, used to exercise the algorithm on small integer numbers where every answer can be
 * verified by brute force. It is not market data and never used outside tests.
 */
export function constantProductEngine(options: {
  baseReserve: bigint;
  quoteReserve: bigint;
  feeBps: bigint;
  /** Largest quote input the venue can absorb; larger requests are partial fills. */
  maxQuoteIn?: bigint;
  maxBaseIn?: bigint;
}): QuoteEngine {
  const { baseReserve, quoteReserve, feeBps } = options;
  const keep = 10_000n - feeBps;
  return {
    buy(quoteIn: bigint): Quote | null {
      if (quoteIn <= 0n) return null;
      const consumedIn =
        options.maxQuoteIn !== undefined && quoteIn > options.maxQuoteIn
          ? options.maxQuoteIn
          : quoteIn;
      const net = (consumedIn * keep) / 10_000n;
      const out = (baseReserve * net) / (quoteReserve + net);
      return { consumedIn, out };
    },
    sell(baseIn: bigint): Quote | null {
      if (baseIn <= 0n) return null;
      const consumedIn =
        options.maxBaseIn !== undefined && baseIn > options.maxBaseIn ? options.maxBaseIn : baseIn;
      const net = (consumedIn * keep) / 10_000n;
      const out = (quoteReserve * net) / (baseReserve + net);
      return { consumedIn, out };
    },
  };
}

/** Wrap an engine and count calls, to prove search cost is bounded. */
export function counting(engine: QuoteEngine): QuoteEngine & { calls: () => number } {
  let calls = 0;
  return {
    buy: (q) => {
      calls += 1;
      return engine.buy(q);
    },
    sell: (b) => {
      calls += 1;
      return engine.sell(b);
    },
    calls: () => calls,
  };
}

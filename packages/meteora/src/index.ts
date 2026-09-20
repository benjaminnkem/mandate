/**
 * @mandate/meteora: DLMM venue adapter and canonical measurement algorithm.
 *
 * - `algorithm/`: pure. Depends only on a `QuoteEngine` and plain data, so it is deterministic and
 *   testable offline.
 * - `adapter/`: connects the algorithm to real Solana state through the pinned official SDK, with
 *   record/replay of every account read.
 * - `evidence/`: canonical serialization and hashing of an observation.
 */
export * from "./adapter/index.ts";
export * from "./algorithm/index.ts";
export * from "./evidence/index.ts";
export * from "./hash.ts";
export * from "./sdk.ts";

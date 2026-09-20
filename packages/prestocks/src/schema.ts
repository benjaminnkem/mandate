import { z } from "zod";

const finiteNumber = z.number(); // zod 4 rejects Infinity and NaN by default

/**
 * One PreStocks product as returned by GET https://prestocks.com/api/prestocks.
 *
 * Price/valuation fields are CONTEXT ONLY. They are never settlement inputs
 * (docs/PRD.md section 6.7) and must never be used in money math.
 */
export const prestocksAssetSchema = z.looseObject({
  name: z.string().min(1),
  symbol: z.string().min(1),
  description: z.string(),
  image: z.string(),
  external_url: z.string(),
  /** Solana mint address. The only valid financial identifier; tickers are not. */
  contract_address: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address"),
  markPrice: finiteNumber,
  markValuation: finiteNumber,
  tokenPrice: finiteNumber,
  impliedValuation: finiteNumber,
  supply: finiteNumber,
});
export type PrestocksAsset = z.infer<typeof prestocksAssetSchema>;

export const prestocksResponseSchema = z.array(prestocksAssetSchema);

/**
 * Read-only: discover and verify PreStocks/USDC Meteora DLMM pools.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm market:discover --symbol OPENAI [--min-tvl 10000]
 *
 * The Meteora data API is used for DISCOVERY ONLY (candidate addresses and TVL for
 * ranking). Every candidate is then verified from Solana state through the pinned
 * official SDK; nothing the data API reports is trusted for eligibility.
 */
import { DLMM } from "@mandate/meteora";
import { PrestocksClient } from "@mandate/prestocks";
import { Connection, PublicKey } from "@solana/web3.js";

/** The SDK's BN type is not resolvable from here; stringify through a minimal structural type. */
const raw = (value: unknown): string => (value as { toString(): string }).toString();

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rpcUrl = process.env["SOLANA_RPC_HTTP_URL"];
if (!rpcUrl) throw new Error("SOLANA_RPC_HTTP_URL is required");
const symbol = arg("symbol");
if (!symbol)
  throw new Error("--symbol is required (resolved to an exact mint, never used as an id)");
const minTvl = Number(arg("min-tvl") ?? "10000");

const asset = (await new PrestocksClient().getSnapshot()).assets.find((a) => a.symbol === symbol);
if (!asset) throw new Error(`no PreStocks asset with symbol ${symbol}`);
const mint = asset.contract_address;
console.log(`PreStocks ${symbol} -> mint ${mint}`);

interface DataApiPool {
  address: string;
  tvl: number;
  token_x: { address: string };
  token_y: { address: string };
}
const candidates: DataApiPool[] = [];
for (let page = 1, pages = 1; page <= pages; page++) {
  const res = await fetch(
    `https://dlmm.datapi.meteora.ag/pools?query=${mint}&page_size=50&page=${String(page)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const body = (await res.json()) as { pages: number; data: DataApiPool[] };
  pages = body.pages;
  candidates.push(...body.data);
}
const ranked = candidates
  .filter((p) => new Set([p.token_x.address, p.token_y.address]).has(mint))
  .filter((p) => new Set([p.token_x.address, p.token_y.address]).has(USDC))
  .filter((p) => p.tvl >= minTvl)
  .sort((a, b) => b.tvl - a.tvl);

const connection = new Connection(rpcUrl, "confirmed");
for (const candidate of ranked) {
  const pool = await DLMM.create(connection, new PublicKey(candidate.address));
  const x = pool.lbPair.tokenXMint.toBase58();
  const y = pool.lbPair.tokenYMint.toBase58();
  const activeBin = await pool.getActiveBin();
  console.log(
    JSON.stringify(
      {
        pool: candidate.address,
        discoveryTvlUsd: Math.round(candidate.tvl),
        verifiedOnchain: {
          programId: pool.program.programId.toBase58(),
          isOfficialDlmmProgram: pool.program.programId.toBase58() === DLMM_PROGRAM,
          tokenXMint: x,
          tokenYMint: y,
          baseIsX: x === mint,
          quoteIsUsdc: (x === mint ? y : x) === USDC,
          binStep: pool.lbPair.binStep,
          activeId: pool.lbPair.activeId,
          activeBinPricePerToken: activeBin.pricePerToken,
          activeBinXAmountRaw: raw(activeBin.xAmount),
          activeBinYAmountRaw: raw(activeBin.yAmount),
        },
      },
      null,
      2,
    ),
  );
}

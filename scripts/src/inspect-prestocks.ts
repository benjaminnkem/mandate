/**
 * Read-only: print the current PreStocks catalogue and inspect each mint onchain.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm inspect:prestocks [--symbol OPENAI]
 *
 * PreStocks API presence is NOT sufficient for support. This command shows what the
 * onchain mint actually is (token program, authorities, Token-2022 extensions) so a
 * human can review before any market is approved.
 */
import { PrestocksClient } from "@mandate/prestocks";
import { Connection, PublicKey } from "@solana/web3.js";

interface ParsedMintInfo {
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions?: { extension: string; state?: unknown }[];
}

const rpcUrl = process.env["SOLANA_RPC_HTTP_URL"];
if (!rpcUrl) throw new Error("SOLANA_RPC_HTTP_URL is required");
const symbolFilter = process.argv.includes("--symbol")
  ? process.argv[process.argv.indexOf("--symbol") + 1]
  : undefined;

const snapshot = await new PrestocksClient().getSnapshot();
const connection = new Connection(rpcUrl, "confirmed");

console.log(`source: ${snapshot.sourceUrl}`);
console.log(`fetchedAt: ${snapshot.fetchedAt.toISOString()}`);

for (const asset of snapshot.assets) {
  if (symbolFilter && asset.symbol !== symbolFilter) continue;
  const account = await connection.getParsedAccountInfo(new PublicKey(asset.contract_address));
  const data = account.value?.data;
  const parsed = data && "parsed" in data ? (data.parsed as { info: ParsedMintInfo }) : undefined;
  console.log(
    JSON.stringify(
      {
        symbol: asset.symbol,
        mint: asset.contract_address,
        onchainOwnerProgram: account.value?.owner.toBase58() ?? null,
        decimals: parsed?.info.decimals ?? null,
        supplyRaw: parsed?.info.supply ?? null,
        mintAuthority: parsed?.info.mintAuthority ?? null,
        freezeAuthority: parsed?.info.freezeAuthority ?? null,
        extensions: parsed?.info.extensions?.map((e) => e.extension) ?? [],
        contextOnly: { markPrice: asset.markPrice, tokenPrice: asset.tokenPrice },
      },
      null,
      2,
    ),
  );
}

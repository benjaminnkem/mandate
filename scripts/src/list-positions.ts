/**
 * Read-only: list the positions that exist on a DLMM pool, with owners and in-range amounts.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm market:positions --pool <pool> [--top 20]
 *
 * Uses the official SDK's decoded `PositionV2` accounts (`getProgramAccounts` filtered by pool). Useful
 * for finding a real provider position to register or to study; it decides nothing.
 */
import { DLMM } from "@mandate/meteora";
import { Connection, PublicKey } from "@solana/web3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rpcUrl = process.env["SOLANA_RPC_HTTP_URL"];
if (!rpcUrl) throw new Error("SOLANA_RPC_HTTP_URL is required");
const pool = arg("pool");
if (!pool) throw new Error("--pool is required");
const top = Number(arg("top") ?? "20");

const dlmm = await DLMM.create(new Connection(rpcUrl, "confirmed"), new PublicKey(pool));
const accounts = await dlmm.program.account.positionV2.all([
  { memcmp: { offset: 8, bytes: pool } },
]);
const activeId = dlmm.lbPair.activeId;

interface Row {
  position: string;
  owner: string;
  operator: string;
  lowerBinId: number;
  upperBinId: number;
  coversActive: boolean;
}
const rows: Row[] = accounts.map((a) => ({
  position: a.publicKey.toBase58(),
  owner: a.account.owner.toBase58(),
  operator: a.account.operator.toBase58(),
  lowerBinId: a.account.lowerBinId,
  upperBinId: a.account.upperBinId,
  coversActive: a.account.lowerBinId <= activeId && activeId <= a.account.upperBinId,
}));
rows.sort(
  (a, b) => Number(b.coversActive) - Number(a.coversActive) || a.owner.localeCompare(b.owner),
);
console.log(
  JSON.stringify({
    pool,
    activeId,
    totalPositions: rows.length,
    shown: Math.min(top, rows.length),
  }),
);
for (const row of rows.slice(0, top)) console.log(JSON.stringify(row));

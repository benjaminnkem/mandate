/**
 * Read-only accounting reconciliation of one mandate against the chain.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm reconcile:mandate <mandate-address> [--json]
 *
 * Reads the mandate, its reward vault and every epoch result, and checks the ledger:
 * deposits, earned, forfeited, claimed, sponsor withdrawals, remaining obligations. Exits 1 on any mismatch
 * (and 2 if the mandate cannot be read), so it can run as a cron job or an alert.
 */
import {
  decodeAccount,
  findEpochResultPda,
  findVaultPda,
  reconcileMandate,
  type EpochResultAccount,
  type MandateAccount,
} from "@mandate/solana";
import { Connection, PublicKey } from "@solana/web3.js";

const address = process.argv[2];
const rpc = process.env["SOLANA_RPC_HTTP_URL"];
if (!address || address.startsWith("--") || !rpc) {
  console.error(
    "usage: SOLANA_RPC_HTTP_URL=<rpc> pnpm reconcile:mandate <mandate-address> [--json]",
  );
  process.exit(2);
}

const connection = new Connection(rpc, "confirmed");
const mandateKey = new PublicKey(address);
const mandateInfo = await connection.getAccountInfo(mandateKey);
if (!mandateInfo) {
  console.error(`mandate ${address} does not exist on ${new URL(rpc).host}`);
  process.exit(2);
}
const mandate = decodeAccount<MandateAccount>("Mandate", mandateInfo.data);

const vaultInfo = await connection.getAccountInfo(findVaultPda(mandateKey));
let vaultBalance: bigint | null = null;
if (vaultInfo) {
  const balance = await connection.getTokenAccountBalance(findVaultPda(mandateKey));
  vaultBalance = BigInt(balance.value.amount);
}

const results: EpochResultAccount[] = [];
const keys = Array.from({ length: mandate.totalEpochs }, (_, i) =>
  findEpochResultPda(mandateKey, i),
);
for (let i = 0; i < keys.length; i += 100) {
  const infos = await connection.getMultipleAccountsInfo(keys.slice(i, i + 100));
  for (const info of infos) {
    if (info) results.push(decodeAccount<EpochResultAccount>("EpochResult", info.data));
  }
}

const report = reconcileMandate({ mandate, vaultBalanceRaw: vaultBalance, results });
const replacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? v.toString() : v);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ mandate: address, status: mandate.status, ...report }, replacer, 2));
} else {
  const l = report.ledger;
  console.log(`mandate ${address} (${mandate.status}) on ${new URL(rpc).host}`);
  console.log(`  deposited            ${l.depositedRaw}`);
  console.log(
    `  earned / forfeited   ${l.earnedRaw} / ${l.forfeitedRaw}   (unresolved ${l.unresolvedRaw})`,
  );
  console.log(`  claimed / claimable  ${l.claimedRaw} / ${l.claimableRaw}`);
  console.log(
    `  sponsor withdrawn    ${l.sponsorWithdrawnRaw}   (withdrawable ${l.sponsorWithdrawableRaw})`,
  );
  console.log(`  vault expected/actual ${l.expectedVaultRaw} / ${l.actualVaultRaw ?? "closed"}`);
  console.log(`  remaining obligations ${l.remainingObligationsRaw}`);
  for (const f of report.findings) console.log(`  MISMATCH ${f.check}: ${f.detail}`);
  console.log(report.ok ? "OK: books reconcile" : "FAIL: books do not reconcile");
}
process.exit(report.ok ? 0 : 1);

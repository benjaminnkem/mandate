/**
 * Read-only pre-signature check: inspect the positions you are about to register for a mandate.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm positions:inspect \
 *     --pool <pool> --base-mint <mint> --provider <wallet> --positions <p1,p2,...> \
 *     [--quote-mint <mint>] [--band <bps>] [--max-positions 8] [--replay <snapshot.json>]
 *
 * Exits non-zero if any position would be rejected. The Mandate program stores only the keys you register and
 * does NOT verify ownership; observers measure it later. This command tells you now which positions would
 * count and which would silently count as zero.
 */
import { readFileSync } from "node:fs";

import {
  ReplaySource,
  inspectPositionsForRegistration,
  type AccountSnapshot,
} from "@mandate/meteora";
import { Connection } from "@solana/web3.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function required(name: string): string {
  const value = arg(name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

const replay = arg("replay");
let connection: Connection;
if (replay) {
  connection = new ReplaySource(JSON.parse(readFileSync(replay, "utf8")) as AccountSnapshot)
    .connection;
} else {
  const rpc = process.env["SOLANA_RPC_HTTP_URL"];
  if (!rpc) throw new Error("SOLANA_RPC_HTTP_URL is required (or pass --replay)");
  connection = new Connection(rpc, "confirmed");
}

const report = await inspectPositionsForRegistration({
  connection,
  pool: required("pool"),
  baseMint: required("base-mint"),
  quoteMint: arg("quote-mint") ?? USDC,
  provider: required("provider"),
  positions: required("positions")
    .split(",")
    .filter((p) => p.length > 0),
  maxPositions: Number(arg("max-positions") ?? "8"),
  ...(arg("band") === undefined ? {} : { depthBandBps: BigInt(arg("band") ?? "0") }),
});

const mark = { ok: "OK    ", warn: "WARN  ", reject: "REJECT" } as const;
for (const finding of report.marketWarnings)
  console.log(`MARKET  ${finding.code}: ${finding.message}`);
for (const finding of report.setErrors) console.log(`SET     ${finding.code}: ${finding.message}`);
for (const p of report.positions) {
  console.log(`${mark[p.severity]} ${p.address}`);
  for (const finding of p.findings) console.log(`          - ${finding.code}: ${finding.message}`);
  if (p.details.quoteInBandRaw !== null) {
    console.log(
      `          in band now: ${p.details.quoteInBandRaw.toString()} quote raw, ${(p.details.baseInBandRaw ?? 0n).toString()} base raw`,
    );
  }
}
console.log(
  report.ok
    ? "\nRESULT: every position can be registered."
    : "\nRESULT: do NOT register until the rejected items are fixed.",
);
process.exitCode = report.ok ? 0 : 1;

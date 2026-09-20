/**
 * Read-only: measure a DLMM pool with the canonical algorithm and print a provenance-rich report.
 *
 *   SOLANA_RPC_HTTP_URL=<rpc> pnpm market:measure \
 *     --pool <pool> --base-mint <mint> --provider <wallet> --positions <p1,p2,...> \
 *     [--quote-mint <mint>] [--probe <quote raw>] [--band <bps>] [--record <file>] [--replay <file>] \
 *     [--cluster mainnet-beta] [--epoch <index> --mandate <pubkey>]
 *
 * Live mode reads every needed account in one atomic request (a single slot), then measures purely from
 * that snapshot. `--record` writes the snapshot. `--replay` re-runs the same measurement from a snapshot
 * with no network access and must reproduce the same payload hash.
 * Nothing here signs or sends a transaction.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildEvidence,
  canonicalJson,
  observePool,
  replayPool,
  sha256Hex,
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

/** 1234567n with 6 decimals -> "1.234567". Display only. */
function fmt(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function gitCommit(): string {
  try {
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
    const head = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--", "packages/meteora", "packages/domain");
    return dirty ? `${head}+uncommitted` : head;
  } catch {
    return "unknown";
  }
}

const pool = required("pool");
const baseMint = required("base-mint");
const quoteMint = arg("quote-mint") ?? USDC;
const provider = required("provider");
const positions = (arg("positions") ?? "").split(",").filter((p) => p.length > 0);
const probeQuoteRaw = BigInt(arg("probe") ?? "10000000"); // 10 USDC
const depthBandBps = BigInt(arg("band") ?? "500");
const cluster = arg("cluster") ?? "mainnet-beta";
const replayFile = arg("replay");
const recordFile = arg("record");

const measureParams = {
  pool,
  baseMint,
  quoteMint,
  provider,
  positions,
  probeQuoteRaw,
  depthBandBps,
};
let rpcHost: string | null = null;
let observation;
if (replayFile) {
  observation = await replayPool(
    JSON.parse(readFileSync(replayFile, "utf8")) as AccountSnapshot,
    measureParams,
  );
} else {
  const rpcUrl = process.env["SOLANA_RPC_HTTP_URL"];
  if (!rpcUrl) throw new Error("SOLANA_RPC_HTTP_URL is required (or pass --replay)");
  rpcHost = new URL(rpcUrl).host;
  observation = await observePool({
    ...measureParams,
    connection: new Connection(rpcUrl, "confirmed"),
    cluster,
    label: `atomic single-slot snapshot for read-only measurement of pool ${pool}, pnpm market:measure`,
    commitment: "confirmed",
  });
}

const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url));
const bundle = buildEvidence(
  observation,
  {
    cluster,
    mandate: arg("mandate") ?? null,
    epochIndex: arg("epoch") === undefined ? null : Number(arg("epoch")),
    positionSet: null,
  },
  { algorithmSourceCommit: gitCommit(), lockfileSha256: sha256Hex(lockfile) },
  { probeQuoteRaw, depthBandBps },
  { observerInstanceId: null, rpcHost },
);

if (recordFile) {
  writeFileSync(recordFile, JSON.stringify(observation.snapshot, null, 1) + "\n");
}

const m = bundle.metrics;
const usdc = observation.quoteMint.decimals;
console.log(
  `NETWORK        ${cluster}${replayFile ? "  (REPLAY of a recorded snapshot; no network used)" : ""}`,
);
console.log(`POOL           ${pool}`);
console.log(
  `SNAPSHOT SLOTS ${String(observation.slots.minSlot)}..${String(observation.slots.maxSlot)}  clock epoch ${observation.clock.epoch}  ts ${observation.clock.unixTimestamp}`,
);
console.log(
  `BASE MINT      ${baseMint}  transfer fee ${String(observation.baseMintState.effectiveTransferFeeBps)} bps (epoch ${observation.baseMintState.observationEpoch}), paused=${String(observation.baseMintState.paused)}`,
);
console.log(
  `PROBE          buy ${fmt(observation.measurement.probe.q0, usdc)} USDC -> ${observation.measurement.probe.b0.toString()} base raw -> sell -> ${fmt(observation.measurement.probe.s0, usdc)} USDC`,
);
console.log(
  `SPREAD         ${String(m.effectiveSpreadBps)} bps (effective two-sided round trip, includes pool + transfer fees)`,
);
console.log(
  `BUY DEPTH      ${fmt(m.poolBuyDepthQuoteRaw, usdc)} USDC within ${depthBandBps.toString()} bps`,
);
console.log(
  `SELL DEPTH     ${fmt(m.poolSellDepthQuoteRaw, usdc)} USDC within ${depthBandBps.toString()} bps`,
);
console.log(
  `PROVIDER QUOTE ${fmt(m.providerQuoteInBandRaw, usdc)} USDC in band [${String(observation.measurement.band.lowerBinId)}, ${String(observation.measurement.band.upperBinId)}]`,
);
console.log(
  `PROVIDER BASE  ${fmt(m.providerBaseQuoteEqInBandRaw, usdc)} USDC-equivalent (${observation.measurement.providerBaseInBandRaw.toString()} base raw)`,
);
for (const p of observation.measurement.provider.perPosition) {
  console.log(`  position ${p.address}  ${p.verdict}  bins-in-band ${String(p.binsInBand)}`);
}
console.log(`PAYLOAD HASH   ${bundle.payloadHash}`);
console.log(`EVIDENCE HASH  ${bundle.evidenceHash}`);
if (arg("json") !== undefined) console.log(canonicalJson(bundle.payload));

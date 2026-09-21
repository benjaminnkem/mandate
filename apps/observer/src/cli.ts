/**
 * One-shot observer command.
 *
 *   node src/cli.ts attest --mandate <pubkey> --epoch <n>
 *
 * Reads its whole configuration from the environment (see apps/observer/.env.example) and signs as the single
 * observer key it is configured with. Exit status: 0 attested or already attested, 2 cannot verify or not yet
 * time, 1 on a conflict or any error (loud failure).
 */
import { loadObserverEnv } from "@mandate/config";
import { observePool, replayPool, sha256Hex } from "@mandate/meteora";
import { createLogger } from "@mandate/observability";
import { Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { FilesystemEvidenceStore } from "./evidence-store.ts";
import { runEpochJob, type Measurer } from "./job.ts";
import { loadObserverKeypair } from "./keys.ts";
import { Web3ChainPort } from "./web3-chain.ts";

const env = loadObserverEnv();
const logger = createLogger({ service: env.OBSERVER_INSTANCE_ID, level: env.LOG_LEVEL });

if (env.EVIDENCE_STORAGE_MODE !== "filesystem" || !env.EVIDENCE_STORAGE_PATH) {
  throw new Error(
    "only EVIDENCE_STORAGE_MODE=filesystem is implemented; s3-compatible storage is not (docs/adr/0015)",
  );
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (process.argv[2] !== "attest")
  throw new Error("usage: cli.ts attest --mandate <pubkey> --epoch <n>");
const mandate = arg("mandate");
const epochText = arg("epoch");
if (!mandate || epochText === undefined) throw new Error("--mandate and --epoch are required");

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const commit = ((): string => {
  const explicit = process.env["ALGORITHM_SOURCE_COMMIT"];
  if (explicit) return explicit;
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const connection = new Connection(env.SOLANA_RPC_HTTP_URL, env.SOLANA_COMMITMENT);
const keypair = loadObserverKeypair(env.OBSERVER_KEYPAIR_PATH, env.OBSERVER_EXPECTED_PUBKEY);
const rpcHost = new URL(env.SOLANA_RPC_HTTP_URL).host;

const measurer: Measurer = {
  rpcHost,
  observeLive: (p) =>
    observePool({
      ...p,
      connection,
      cluster: env.SOLANA_CLUSTER,
      label: `observer ${env.OBSERVER_INSTANCE_ID}`,
      commitment: env.SOLANA_COMMITMENT,
    }),
  replay: (snapshot, p) => replayPool(snapshot, p),
};

const result = await runEpochJob(
  {
    chain: new Web3ChainPort(connection, keypair),
    store: new FilesystemEvidenceStore(env.EVIDENCE_STORAGE_PATH),
    measurer,
    logger,
    config: {
      timing: {
        observeLeadSeconds: Number(process.env["OBSERVER_OBSERVE_LEAD_SECONDS"] ?? "60"),
        leaderTimeoutSeconds: Number(process.env["OBSERVER_LEADER_TIMEOUT_SECONDS"] ?? "15"),
      },
      provenance: {
        algorithmSourceCommit: commit,
        lockfileSha256: sha256Hex(readFileSync(`${repoRoot}pnpm-lock.yaml`)),
      },
      cluster: env.SOLANA_CLUSTER,
      instanceId: env.OBSERVER_INSTANCE_ID,
    },
  },
  { mandate, epochIndex: Number(epochText) },
);
console.log(JSON.stringify(result, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
process.exitCode = result.status === "attested" || result.status === "already-attested" ? 0 : 2;

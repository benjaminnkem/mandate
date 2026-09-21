/**
 * One-shot observer command.
 *
 *   node src/cli.ts attest --mandate <pubkey> --epoch <n>     one epoch, once
 *   node src/cli.ts work                                      run this observer's queued epoch jobs (needs DATABASE_URL)
 *
 * Reads its whole configuration from the environment (see apps/observer/.env.example) and signs as the single
 * observer key it is configured with. Exit status: 0 attested or already attested, 2 cannot verify or not yet
 * time, 1 on a conflict or any error (loud failure).
 */
import { loadObserverEnv } from "@mandate/config";
import { observePool, replayPool, sha256Hex } from "@mandate/meteora";
import { createPgDb, runWorkerOnce } from "@mandate/db";
import { createLogger, createMetrics, startOpsServer } from "@mandate/observability";
import { Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { FilesystemEvidenceStore } from "./evidence-store.ts";
import { runEpochJob, type JobDeps, type Measurer } from "./job.ts";
import { loadObserverKeypair } from "./keys.ts";
import { observeHandler } from "./queue-handler.ts";
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
const command = process.argv[2];
if (command !== "attest" && command !== "work")
  throw new Error("usage: cli.ts attest --mandate <pubkey> --epoch <n> | cli.ts work");
const mandate = arg("mandate");
const epochText = arg("epoch");
if (command === "attest" && (!mandate || epochText === undefined))
  throw new Error("--mandate and --epoch are required");

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

const jobDeps: JobDeps = {
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
};

if (command === "work") {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for `work`");
  const metrics = createMetrics(env.OBSERVER_INSTANCE_ID);
  jobDeps.onDisagreement = () => {
    metrics.observerPayloadDisagreements.inc();
  };
  let lastPass = 0;
  await startOpsServer({
    port: Number(process.env["OBSERVER_OPS_PORT"] ?? "9103"),
    registry: metrics.registry,
    readiness: () => {
      const ok = lastPass > 0 && Date.now() - lastPass < 60_000;
      return Promise.resolve({ ready: ok, checks: { worker_loop: { ok } } });
    },
  });
  const db = createPgDb(env.DATABASE_URL, { max: 2 });
  const me = keypair.publicKey.toBase58();
  logger.info({ observer: me }, "observer worker started; runs only jobs owned by this key");
  const handlers = { observe: observeHandler((input) => runEpochJob(jobDeps, input)) };
  process.once("SIGTERM", () => process.exit(0));
  for (;;) {
    try {
      // Only this observer's own jobs: the owner is its public key, so one process can never run another's.
      await runWorkerOnce(db, {
        kinds: ["observe"],
        owner: me,
        handlers,
        leaseSeconds: 300,
        limit: 5,
        now: () => new Date(),
        onResult: (job, r) => {
          metrics.observerEpochJobs.inc({ result: r });
          if (r === "retry" || r === "dead") metrics.observerEpochFailures.inc();
          if (r === "dead") logger.error({ job: job.key }, "OBSERVE JOB DEAD-LETTERED");
        },
      });
    } catch (error) {
      logger.error({ err: error }, "worker pass failed; will retry");
    }
    lastPass = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const result = await runEpochJob(jobDeps, {
  mandate: mandate ?? "",
  epochIndex: Number(epochText),
});
console.log(JSON.stringify(result, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
process.exitCode = result.status === "attested" || result.status === "already-attested" ? 0 : 2;

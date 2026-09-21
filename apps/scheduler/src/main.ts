import { loadSchedulerEnv } from "@mandate/config";
import {
  createPgDb,
  deadJobs,
  migrate,
  queueStats,
  runWorkerOnce,
  type Handler,
} from "@mandate/db";
import { createMetrics, runService, startOpsServer } from "@mandate/observability";
import { MANDATE_PROGRAM_ID } from "@mandate/solana";
import { Connection, PublicKey } from "@solana/web3.js";

import { createFinalizePorts, loadRelayerKeypair } from "./chain.ts";
import { finalizeJob } from "./finalize.ts";
import { planJobs } from "./planner.ts";

await runService("scheduler", async ({ logger, signal }) => {
  const env = loadSchedulerEnv();
  if (env.MANDATE_PROGRAM_ID !== MANDATE_PROGRAM_ID.toBase58())
    throw new Error(`MANDATE_PROGRAM_ID ${env.MANDATE_PROGRAM_ID} does not match the compiled IDL`);
  const db = createPgDb(env.DATABASE_URL);
  await migrate(db);
  const metrics = createMetrics("scheduler");
  const connection = new Connection(env.SOLANA_RPC_HTTP_URL, env.SOLANA_COMMITMENT);

  // Finalization is permissionless, so the relayer is optional and only pays fees. Without one, finalize jobs stay
  // queued for another scheduler (or any wallet) to finish; observe jobs are never run here (no observer keys).
  const handlers: Record<string, Handler> = {};
  if (env.SCHEDULER_RELAYER_KEYPAIR_PATH) {
    const relayer = loadRelayerKeypair(env.SCHEDULER_RELAYER_KEYPAIR_PATH);
    const ports = createFinalizePorts(connection, relayer, env.SOLANA_COMMITMENT);
    logger.info({ relayer: relayer.publicKey.toBase58() }, "finalization enabled");
    handlers["finalize"] = async (job) => {
      const payload = job.payload as { mandate: string; epoch: number };
      return finalizeJob(
        ports,
        { mandate: new PublicKey(payload.mandate), epoch: payload.epoch },
        { pollSeconds: 15 },
      );
    };
  } else {
    logger.warn(
      "no SCHEDULER_RELAYER_KEYPAIR_PATH: finalization jobs are planned but not executed by this process",
    );
  }

  let lastTick = 0;
  const ops = await startOpsServer({
    port: env.OPS_PORT,
    registry: metrics.registry,
    readiness: async () => {
      const dead = (await queueStats(db)).dead;
      const ticking = lastTick > 0 && Date.now() - lastTick < env.SCHEDULER_TICK_SECONDS * 5000;
      return {
        ready: ticking && dead === 0,
        checks: {
          ticking: { ok: ticking },
          dead_letter: { ok: dead === 0, detail: `${dead} dead jobs` },
        },
      };
    },
  });
  logger.info(
    { cluster: env.SOLANA_CLUSTER, programId: env.MANDATE_PROGRAM_ID },
    "scheduler started",
  );

  while (!signal.aborted) {
    try {
      const now = new Date();
      const plan = await planJobs(db, now, {
        lookaheadSeconds: env.EPOCH_JOB_LEAD_SECONDS + 60,
        observeLeadSeconds: env.EPOCH_JOB_LEAD_SECONDS,
        maxAttempts: env.FINALIZE_RETRY_LIMIT,
      });
      if (plan.jobsCreated > 0) logger.info(plan, "planned jobs");
      if (Object.keys(handlers).length > 0) {
        const report = await runWorkerOnce(db, {
          kinds: Object.keys(handlers),
          owner: null,
          handlers,
          leaseSeconds: env.SCHEDULER_JOB_LEASE_SECONDS,
          limit: 20,
          now: () => new Date(),
          onResult: (job, result) => {
            metrics.jobRuns.inc({ kind: job.kind, outcome: result });
            if (result === "dead")
              logger.error({ job: job.key, error: job.lastError }, "JOB DEAD-LETTERED");
          },
        });
        if (report.done + report.retried + report.dead > 0) logger.info(report, "ran jobs");
      }
      const stats = await queueStats(db);
      for (const [kind, states] of Object.entries(stats.byKind))
        for (const [state, n] of Object.entries(states)) metrics.queueDepth.set({ kind, state }, n);
      metrics.deadJobs.set(stats.dead);
      if (stats.dead > 0)
        logger.error(
          { dead: (await deadJobs(db, 5)).map((j) => j.key) },
          "dead-lettered jobs need an operator",
        );
      lastTick = Date.now();
    } catch (error) {
      logger.error({ err: error }, "scheduler tick failed; will retry");
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, env.SCHEDULER_TICK_SECONDS * 1000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  ops.close();
  await db.close();
});

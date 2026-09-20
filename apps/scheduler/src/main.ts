import { loadSchedulerEnv } from "@mandate/config";
import { runService, untilAborted } from "@mandate/observability";

await runService("scheduler", async ({ logger, signal }) => {
  const env = loadSchedulerEnv();
  logger.info(
    { cluster: env.SOLANA_CLUSTER, programId: env.MANDATE_PROGRAM_ID },
    "scheduler started (scaffold: no jobs registered yet, Prompt 8-9)",
  );
  await untilAborted(signal);
});

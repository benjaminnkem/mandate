import { loadIndexerEnv } from "@mandate/config";
import { runService, untilAborted } from "@mandate/observability";

await runService("indexer", async ({ logger, signal }) => {
  const env = loadIndexerEnv();
  logger.info(
    { cluster: env.SOLANA_CLUSTER, programId: env.MANDATE_PROGRAM_ID },
    "indexer started (scaffold: no chain subscriptions yet, Prompt 11)",
  );
  await untilAborted(signal);
});

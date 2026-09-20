import { loadObserverEnv } from "@mandate/config";
import { runService, untilAborted } from "@mandate/observability";

await runService("observer", async ({ logger, signal }) => {
  const env = loadObserverEnv();
  logger.info(
    { cluster: env.SOLANA_CLUSTER, programId: env.MANDATE_PROGRAM_ID },
    "observer started (scaffold: no measurement yet, Prompt 3 and 8)",
  );
  await untilAborted(signal);
});

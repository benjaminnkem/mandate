import { loadApiEnv } from "@mandate/config";
import { runService, untilAborted } from "@mandate/observability";

import { buildServer } from "./server.ts";

await runService("api", async ({ logger, signal }) => {
  const env = loadApiEnv();
  const app = buildServer(env, logger);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  await untilAborted(signal);
  await app.close();
});

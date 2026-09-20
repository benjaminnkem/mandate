import type { ApiEnv } from "@mandate/config";
import type { Logger } from "@mandate/observability";
import Fastify from "fastify";

export function buildServer(
  env: Pick<ApiEnv, "SOLANA_CLUSTER" | "MANDATE_PROGRAM_ID">,
  logger: Logger,
) {
  const app = Fastify({ loggerInstance: logger, disableRequestLogging: false });

  app.get("/healthz", () => ({ status: "ok" }));

  // Every response that reports chain-derived state must name its network.
  app.get("/v1/meta", () => ({
    cluster: env.SOLANA_CLUSTER,
    programId: env.MANDATE_PROGRAM_ID,
  }));

  return app;
}

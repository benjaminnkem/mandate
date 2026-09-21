import { loadApiEnv } from "@mandate/config";
import { createPgDb, migrate } from "@mandate/db";
import { createMetrics, runService, untilAborted } from "@mandate/observability";
import { PrestocksClient } from "@mandate/prestocks";
import { Connection } from "@solana/web3.js";

import { buildServer } from "./server.ts";

await runService("api", async ({ logger, signal }) => {
  const env = loadApiEnv();
  const db = createPgDb(env.DATABASE_URL);
  await migrate(db);
  const connection = new Connection(env.SOLANA_RPC_HTTP_URL, env.SOLANA_COMMITMENT);
  const app = await buildServer(
    {
      db,
      metrics: createMetrics("api"),
      prestocks: new PrestocksClient({
        url: env.PRESTOCKS_API_URL,
        cacheTtlMs: env.PRESTOCKS_CACHE_TTL_SECONDS * 1000,
      }),
      chain: {
        async getAccount(address) {
          const info = await connection.getAccountInfo(address, env.SOLANA_COMMITMENT);
          return info ? { data: info.data, owner: info.owner.toBase58() } : null;
        },
        getLatestBlockhash: () => connection.getLatestBlockhash(env.SOLANA_COMMITMENT),
      },
      config: {
        cluster: env.SOLANA_CLUSTER,
        programId: env.MANDATE_PROGRAM_ID,
        usdcMint: env.USDC_MINT,
        rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
        maxStalenessSeconds: env.API_MAX_STALENESS_SECONDS,
        evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL,
      },
    },
    logger,
  );
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  await untilAborted(signal);
  await app.close();
  await db.close();
});

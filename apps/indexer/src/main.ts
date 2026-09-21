import { loadIndexerEnv } from "@mandate/config";
import { createPgDb, indexStatus, migrate } from "@mandate/db";
import { createMetrics, runService, startOpsServer, withSpan } from "@mandate/observability";
import { MANDATE_PROGRAM_ID } from "@mandate/solana";
import { Connection, PublicKey } from "@solana/web3.js";

import { createRpcChainReader } from "./chain.ts";
import { CURSOR_NAME, Indexer } from "./indexer.ts";

/**
 * Usage:
 *   node src/main.ts            run the indexer (backfill, live subscription, periodic reconciliation)
 *   node src/main.ts rebuild    DESTRUCTIVE: drop all derived read-model state and re-derive it from the chain
 */
await runService("indexer", async ({ logger, signal }) => {
  const env = loadIndexerEnv();
  if (env.MANDATE_PROGRAM_ID !== MANDATE_PROGRAM_ID.toBase58())
    throw new Error(
      `MANDATE_PROGRAM_ID ${env.MANDATE_PROGRAM_ID} does not match the compiled IDL ${MANDATE_PROGRAM_ID.toBase58()}`,
    );

  const db = createPgDb(env.DATABASE_URL);
  const metrics = createMetrics("indexer");
  const connection = new Connection(env.SOLANA_RPC_HTTP_URL, {
    commitment: env.INDEXER_CONFIRMATION_LEVEL,
    ...(env.SOLANA_RPC_WS_URL ? { wsEndpoint: env.SOLANA_RPC_WS_URL } : {}),
  });
  const chain = createRpcChainReader(
    connection,
    new PublicKey(env.MANDATE_PROGRAM_ID),
    env.INDEXER_CONFIRMATION_LEVEL,
  );
  const indexer = new Indexer({
    db,
    chain,
    metrics,
    log: (message, fields) => {
      logger.error(fields ?? {}, message);
    },
  });
  await migrate(db);

  if (process.argv[2] === "rebuild") {
    logger.warn({ cluster: env.SOLANA_CLUSTER }, "rebuilding the read model from chain");
    logger.info(await indexer.rebuild(), "rebuild complete");
    await db.close();
    return;
  }

  let lastSyncMs = 0;
  const ops = await startOpsServer({
    port: env.OPS_PORT,
    registry: metrics.registry,
    readiness: async () => {
      const status = await indexStatus(db, CURSOR_NAME);
      const head = await chain.getSlot();
      const lag = head > status.indexedSlot ? head - status.indexedSlot : 0n;
      const fresh =
        lastSyncMs > 0 && Date.now() - lastSyncMs < env.INDEXER_SYNC_INTERVAL_SECONDS * 4000;
      const lagOk = lag <= BigInt(env.INDEXER_MAX_SLOT_LAG);
      return {
        ready: fresh && lagOk && status.reconciliationFailures === 0,
        checks: {
          synced_recently: { ok: fresh },
          slot_lag: { ok: lagOk, detail: `${lag} slots` },
          vault_reconciliation: {
            ok: status.reconciliationFailures === 0,
            detail: `${status.reconciliationFailures} failing`,
          },
        },
      };
    },
  });

  logger.info(
    {
      cluster: env.SOLANA_CLUSTER,
      programId: env.MANDATE_PROGRAM_ID,
      commitment: env.INDEXER_CONFIRMATION_LEVEL,
    },
    "indexer started",
  );

  const sync = (): Promise<void> =>
    withSpan("indexer.sync", { cluster: env.SOLANA_CLUSTER }, async () => {
      const r = await indexer.syncOnce();
      lastSyncMs = Date.now();
      logger.info(
        {
          slot: r.accounts.slot.toString(),
          upserted: r.accounts.upserted,
          removed: r.accounts.removed,
          events: r.events,
        },
        "synced",
      );
    });

  // Live: any program log wakes the loop early. The periodic pass below is what guarantees convergence, so a
  // dropped WebSocket costs latency, never correctness.
  let wake: (() => void) | undefined;
  const subscription = env.SOLANA_RPC_WS_URL
    ? connection.onLogs(
        new PublicKey(env.MANDATE_PROGRAM_ID),
        () => wake?.(),
        env.INDEXER_CONFIRMATION_LEVEL,
      )
    : undefined;

  let nextReconcile = 0;
  while (!signal.aborted) {
    try {
      await sync();
      if (Date.now() >= nextReconcile) {
        const r = await indexer.reconcileVaults();
        nextReconcile = Date.now() + env.INDEXER_RECONCILE_INTERVAL_SECONDS * 1000;
        logger.info(r, "vault reconciliation");
      }
    } catch (error) {
      logger.error({ err: error }, "sync failed; will retry");
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, env.INDEXER_SYNC_INTERVAL_SECONDS * 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
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
  if (subscription !== undefined) await connection.removeOnLogsListener(subscription);
  ops.close();
  await db.close();
});

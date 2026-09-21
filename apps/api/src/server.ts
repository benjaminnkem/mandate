import fastifyRateLimit from "@fastify/rate-limit";
import { indexStatus } from "@mandate/db";
import type { Logger } from "@mandate/observability";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { ApiDeps } from "./deps.ts";
import { HttpError, meta } from "./http.ts";
import { registerReadRoutes } from "./routes.ts";
import { registerTxRoutes } from "./tx.ts";

/** Build the API. All dependencies are injected, so tests run it against a real database and a fake chain. */
export async function buildServer(deps: ApiDeps, logger: Logger): Promise<FastifyInstance> {
  const app = Fastify({
    // pino's Logger and Fastify's FastifyBaseLogger are structurally the same at runtime; TypeScript sees them as
    // different because of pino's extra members, which would otherwise leak into every route registrar's types.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    bodyLimit: 32 * 1024,
  });

  await app.register(fastifyRateLimit, {
    max: deps.config.rateLimitPerMinute,
    timeWindow: "1 minute",
    // Probes and scrapers must never be throttled into a false outage.
  });

  app.addHook("onResponse", (req, reply, done) => {
    const route = req.routeOptions.url ?? "unmatched";
    deps.metrics.apiRequestLatency.observe(
      { route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });

  app.setErrorHandler((error: Error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.status(400).send({
        error: {
          code: "invalid_request",
          message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      });
    if (error instanceof HttpError)
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply
        .status(status)
        .send({ error: { code: "request_rejected", message: error.message } });
    app.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "internal error" } });
  });

  app.get("/healthz", { config: { rateLimit: false } }, () => ({ status: "ok" }));

  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.db.query("SELECT 1");
      const m = await meta(deps);
      const status = await indexStatus(deps.db, "program-events");
      const ready = !m.stale && status.reconciliationFailures === 0;
      return await reply.status(ready ? 200 : 503).send({
        ready,
        checks: {
          database: { ok: true },
          index_fresh: {
            ok: !m.stale,
            detail: m.staleSeconds === null ? "never synced" : `${m.staleSeconds}s old`,
          },
          vault_reconciliation: {
            ok: status.reconciliationFailures === 0,
            detail: `${status.reconciliationFailures} failing`,
          },
        },
      });
    } catch (error) {
      return reply
        .status(503)
        .send({ ready: false, checks: { database: { ok: false, detail: String(error) } } });
    }
  });

  app.get("/metrics", { config: { rateLimit: false } }, async (_req, reply) => {
    return reply
      .header("content-type", deps.metrics.registry.contentType)
      .send(await deps.metrics.registry.metrics());
  });

  registerReadRoutes(app, deps);
  registerTxRoutes(app, deps);
  return app;
}

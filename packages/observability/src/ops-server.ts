import { createServer, type Server } from "node:http";

import type { Registry } from "prom-client";

export interface Readiness {
  readonly ready: boolean;
  readonly checks: Record<string, { ok: boolean; detail?: string }>;
}

/**
 * A tiny HTTP surface for workers with no API of their own: `/healthz` (process is up), `/readyz` (dependencies
 * are usable and data is fresh) and `/metrics` (Prometheus text format).
 */
export function startOpsServer(options: {
  port: number;
  host?: string;
  registry: Registry;
  readiness: () => Promise<Readiness>;
}): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.url === "/healthz") {
          res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
        } else if (req.url === "/readyz") {
          const r = await options.readiness();
          res
            .writeHead(r.ready ? 200 : 503, { "content-type": "application/json" })
            .end(JSON.stringify(r));
        } else if (req.url === "/metrics") {
          res
            .writeHead(200, { "content-type": options.registry.contentType })
            .end(await options.registry.metrics());
        } else {
          res.writeHead(404).end();
        }
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      resolve(server);
    });
  });
}

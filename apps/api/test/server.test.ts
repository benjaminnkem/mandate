import { createLogger } from "@mandate/observability";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.ts";

describe("api server", () => {
  const app = buildServer(
    { SOLANA_CLUSTER: "surfpool", MANDATE_PROGRAM_ID: "11111111111111111111111111111111" },
    createLogger({ service: "api-test", level: "silent" }),
  );

  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("always names the network it serves", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.json()).toMatchObject({ cluster: "surfpool" });
  });
});

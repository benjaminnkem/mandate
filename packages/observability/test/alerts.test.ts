import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMetrics } from "../src/index.ts";

const rules = readFileSync(
  new URL("../../../ops/alerts/mandate.rules.yml", import.meta.url),
  "utf8",
);
const OURS = /\b((?:observer|indexer|reward|queue|epoch|attestation|api|job|market)_[a-z_]+)\b/g;

describe("alert rules", () => {
  it("only refer to metrics that the code really exports", async () => {
    const metrics = createMetrics("alerts-test");
    const defined = new Set((await metrics.registry.getMetricsAsJSON()).map((m) => m.name));
    const exprs = rules.split("\n").filter((line) => line.trim().startsWith("expr:"));
    expect(exprs.length).toBeGreaterThan(10);
    const used = new Set<string>();
    for (const line of exprs)
      for (const [, name] of line.matchAll(OURS))
        used.add((name ?? "").replace(/_(bucket|count|sum)$/, ""));
    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it("cover the alerts the specification requires", () => {
    for (const required of [
      "MandateVaultMismatch",
      "ObserverDisagreement",
      "IndexerBehind",
      "DeadLetteredJobs",
      "EpochQuorumLate",
      "MarketPoolUnreadable",
    ])
      expect(rules).toContain(`alert: ${required}`);
  });
});

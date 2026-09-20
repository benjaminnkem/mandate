import { describe, expect, it } from "vitest";

import {
  EnvValidationError,
  MAINNET_USDC_MINT,
  loadApiEnv,
  loadObserverEnv,
  loadSchedulerEnv,
} from "../src/index.ts";

// TEST FIXTURE values only. None of these are real endpoints or keys.
const chain = {
  SOLANA_CLUSTER: "surfpool",
  SOLANA_RPC_HTTP_URL: "http://127.0.0.1:8899",
  MANDATE_PROGRAM_ID: "11111111111111111111111111111111",
};

describe("environment validation", () => {
  it("parses a valid api environment and applies defaults", () => {
    const env = loadApiEnv({ ...chain, DATABASE_URL: "postgresql://u:p@localhost:5432/mandate" });
    expect(env.PORT).toBe(3001);
    expect(env.SOLANA_COMMITMENT).toBe("confirmed");
    expect(env.USDC_MINT).toBe(MAINNET_USDC_MINT);
  });

  it("fails startup on missing required values and names them", () => {
    expect(() => loadApiEnv({})).toThrow(EnvValidationError);
    try {
      loadApiEnv({});
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("SOLANA_CLUSTER");
      expect(issues).toContain("DATABASE_URL");
    }
  });

  it("never echoes a supplied secret value in its error", () => {
    const secret = "hunter2-super-secret";
    try {
      loadApiEnv({ ...chain, DATABASE_URL: `not-a-url-${secret}` });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("rejects the shared public RPC for mainnet-beta", () => {
    expect(() =>
      loadApiEnv({
        ...chain,
        SOLANA_CLUSTER: "mainnet-beta",
        SOLANA_RPC_HTTP_URL: "https://api.mainnet-beta.solana.com",
        DATABASE_URL: "postgresql://u:p@localhost:5432/mandate",
      }),
    ).toThrow(/public mainnet RPC/);
  });

  it("requires redis for the scheduler", () => {
    expect(() =>
      loadSchedulerEnv({ ...chain, DATABASE_URL: "postgresql://u:p@localhost:5432/mandate" }),
    ).toThrow(/REDIS_URL/);
  });

  it("requires storage settings that match the observer evidence mode", () => {
    const observer = {
      ...chain,
      OBSERVER_KEYPAIR_PATH: ".keys/observer-1.json",
      OBSERVER_EXPECTED_PUBKEY: "11111111111111111111111111111111",
    };
    expect(() => loadObserverEnv(observer)).toThrow(/EVIDENCE_STORAGE_PATH/);
    expect(
      loadObserverEnv({ ...observer, EVIDENCE_STORAGE_PATH: "./evidence-store" })
        .MEASUREMENT_ALGORITHM_VERSION,
    ).toBe(1);
    expect(() => loadObserverEnv({ ...observer, EVIDENCE_STORAGE_MODE: "s3-compatible" })).toThrow(
      /EVIDENCE_S3_BUCKET/,
    );
  });
});

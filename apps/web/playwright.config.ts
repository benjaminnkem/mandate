import { defineConfig, devices } from "@playwright/test";

const PORT = 3199;

/**
 * End-to-end tests against a real Next.js dev server in a real browser. Every network call the app makes —
 * the read/write API and the same-origin `/api/rpc` chain proxy — is intercepted per test with realistic
 * fixture data (see `e2e/fixtures.ts`); nothing here talks to a live API, RPC or wallet extension. This is a
 * UI-correctness suite, not the fork/mainnet rehearsal (that is Prompt 13's Surfpool run).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["iPhone 13"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SOLANA_CLUSTER: "surfpool",
      NEXT_PUBLIC_MANDATE_PROGRAM_ID: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3199/mocked-api",
      NEXT_PUBLIC_USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      SOLANA_RPC_HTTP_URL: "http://127.0.0.1:1/unused-in-e2e",
    },
  },
});

import { defineConfig } from "vitest/config";

/** Unit tests cover the pure, framework-free logic in `lib/`. Component and page behavior — the wallet flow,
 * the confirmation dialog, routing — is covered by the Playwright suite in `e2e/`, which runs against a real
 * browser and a real (locally served) Next.js build rather than a simulated DOM. */
export default defineConfig({
  test: {
    environment: "node",
    env: {
      NEXT_PUBLIC_SOLANA_CLUSTER: "surfpool",
      NEXT_PUBLIC_MANDATE_PROGRAM_ID: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
      NEXT_PUBLIC_USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    include: ["test/**/*.test.ts"],
  },
});

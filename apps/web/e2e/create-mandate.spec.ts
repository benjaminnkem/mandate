import { expect, test } from "@playwright/test";

import {
  envelope,
  installMockWallet,
  mockApiRoutes,
  mockChainRpc,
  protocolConfigAccount,
  MARKET_ADDRESS,
  POOL_ADDRESS,
  PROTOCOL_ADDRESS,
} from "./fixtures.ts";

test.describe("create-mandate wizard", () => {
  test("loads protocol bounds from chain, validates against them, and previews the exact terms before signing", async ({
    page,
  }) => {
    await installMockWallet(page);
    await mockChainRpc(page, {
      accountsByAddress: { [PROTOCOL_ADDRESS]: await protocolConfigAccount() },
    });
    await mockApiRoutes(page, {
      "/v1/markets": envelope([
        { address: MARKET_ADDRESS, asOfSlot: "1", account: { pool: POOL_ADDRESS, enabled: true } },
      ]),
    });

    await page.goto("/mandates/new");
    await expect(page.getByRole("heading", { name: /create a mandate/i })).toBeVisible();
    await expect(page.getByLabel("Approved pool")).toHaveValue(POOL_ADDRESS);

    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByRole("menuitem", { name: "E2E Test Wallet" }).click();

    // Over the protocol's maximum spread bound (20,000 bps): the wizard must catch this before any signature.
    await page.getByLabel("Max effective spread (bps)").fill("999999");
    await expect(page.getByText(/cannot exceed 20000 bps/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create mandate" })).toBeDisabled();
    await page.getByLabel("Max effective spread (bps)").fill("400");

    await expect(page.getByRole("button", { name: "Create mandate" })).toBeEnabled();
    await page.getByRole("button", { name: "Create mandate" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(POOL_ADDRESS)).toBeVisible();
    await expect(dialog.getByText("1000.000000 USDC")).toBeVisible(); // default max reward
    await expect(
      dialog.getByText(/fixes the schedule and every threshold permanently/i),
    ).toBeVisible();
  });

  test("blocks creation entirely while the protocol has new risk paused", async ({ page }) => {
    await installMockWallet(page);
    await mockChainRpc(page, {
      accountsByAddress: {
        [PROTOCOL_ADDRESS]: await protocolConfigAccount({ paused_new_risk: true }),
      },
    });
    await mockApiRoutes(page, {
      "/v1/markets": envelope([
        { address: MARKET_ADDRESS, asOfSlot: "1", account: { pool: POOL_ADDRESS, enabled: true } },
      ]),
    });
    await page.goto("/mandates/new");
    await expect(page.getByText(/protocol admin has paused new risk/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create mandate" })).toBeDisabled();
  });
});

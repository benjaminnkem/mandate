import { expect, test, type Page } from "@playwright/test";

import {
  BID_ADDRESS,
  envelope,
  installMockWallet,
  mandateAccounting,
  mandateRow,
  mockApiRoutes,
  mockChainRpc,
  MANDATE_ADDRESS,
  txBundle,
  WALLET_ADDRESS,
} from "./fixtures.ts";

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("menuitem", { name: "E2E Test Wallet" }).click();
  await expect(page.getByText(/E2E Test Wallet:/)).toBeVisible();
}

test.describe("mandate detail: financial write flows", () => {
  test("renders the exact SLA, accounting and epoch timeline, then completes a provider claim end to end", async ({
    page,
  }) => {
    await installMockWallet(page);
    await mockChainRpc(page, { signatureStatus: "confirmed" });
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}`]: envelope({
        address: MANDATE_ADDRESS,
        asOfSlot: "10",
        account: mandateRow(),
        accounting: mandateAccounting(),
        positionSet: null,
        vaultReconciliation: {
          ok: true,
          checkedAt: new Date().toISOString(),
          expectedRaw: "850000000",
          actualRaw: "850000000",
          findings: [],
        },
      }),
      [`/v1/mandates/${MANDATE_ADDRESS}/bids`]: envelope([]),
      [`/v1/mandates/${MANDATE_ADDRESS}/epochs`]: envelope({
        totalEpochs: 3,
        epochs: [
          {
            epoch: 0,
            outcome: "Compliant",
            attestationCount: 2,
            result: { address: "R1", asOfSlot: "1", account: { rewardEarnedRaw: "300000000" } },
          },
          { epoch: 1, outcome: "Pending", attestationCount: 0, result: null },
          { epoch: 2, outcome: "Pending", attestationCount: 0, result: null },
        ],
      }),
      "/v1/tx/claim": txBundle(WALLET_ADDRESS, {
        action: "Claim earned reward",
        youReceive: { raw: "200000000", usdc: "200.000000" },
        claimableNow: { raw: "200000000", usdc: "200.000000" },
        irreversible:
          "USDC moves out of the escrow vault to your account immediately and cannot be recalled.",
      }),
    });

    await page.goto(`/mandates/${MANDATE_ADDRESS}`);
    await expect(page.getByRole("heading", { name: "Mandate" })).toBeVisible();
    await expect(page.getByText("4.00%")).toBeVisible(); // max effective spread threshold, exact
    await expect(page.getByText("300.000000 USDC")).toBeVisible(); // earned
    await expect(page.getByRole("cell", { name: "Compliant" })).toBeVisible();

    await connect(page);
    await page.getByLabel(/amount to claim/i).fill("200");
    await page.getByRole("button", { name: "Claim reward" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("200.000000 USDC").first()).toBeVisible();
    await expect(dialog.getByText(/irreversible once confirmed/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm in wallet" }).click();
    await expect(dialog.getByText("Confirmed")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/^signature /)).toBeVisible();
  });

  test("never shows Confirmed for a transaction the chain reports as failed", async ({ page }) => {
    await installMockWallet(page);
    await mockChainRpc(page, { signatureStatus: "failed" });
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}`]: envelope({
        address: MANDATE_ADDRESS,
        asOfSlot: "10",
        account: mandateRow(),
        accounting: mandateAccounting(),
        positionSet: null,
        vaultReconciliation: null,
      }),
      [`/v1/mandates/${MANDATE_ADDRESS}/bids`]: envelope([]),
      [`/v1/mandates/${MANDATE_ADDRESS}/epochs`]: envelope({ totalEpochs: 3, epochs: [] }),
      "/v1/tx/withdraw": txBundle(WALLET_ADDRESS, {
        action: "Withdraw released funds",
        youReceive: { raw: "50000000", usdc: "50.000000" },
      }),
    });
    await page.goto(`/mandates/${MANDATE_ADDRESS}`);
    await connect(page);
    await page.getByLabel(/amount to withdraw/i).fill("50");
    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Confirm in wallet" }).click();
    await expect(dialog.getByText("Failed on chain")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("Confirmed")).toHaveCount(0);
  });

  test("sponsor can accept an open bid, fixing the provider and reward", async ({ page }) => {
    await installMockWallet(page);
    await mockChainRpc(page, { signatureStatus: "confirmed" });
    const provider = "Provider111111111111111111111111111111111";
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}`]: envelope({
        address: MANDATE_ADDRESS,
        asOfSlot: "10",
        account: mandateRow({
          status: "Bidding",
          provider: "11111111111111111111111111111111111111111",
        }),
        accounting: mandateAccounting(),
        positionSet: null,
        vaultReconciliation: null,
      }),
      [`/v1/mandates/${MANDATE_ADDRESS}/bids`]: envelope([
        {
          address: BID_ADDRESS,
          asOfSlot: "5",
          account: {
            mandate: MANDATE_ADDRESS,
            provider,
            requestedRewardRaw: "800000000",
            createdAt: "1",
            validUntil: "9999999999",
            status: "Active",
            nonce: "1",
          },
        },
      ]),
      [`/v1/mandates/${MANDATE_ADDRESS}/epochs`]: envelope({ totalEpochs: 3, epochs: [] }),
      "/v1/tx/accept-bid": txBundle(WALLET_ADDRESS, {
        action: "Award mandate to this provider",
        provider,
        acceptedReward: { raw: "800000000", usdc: "800.000000" },
        surplusReleasedToYou: { raw: "200000000", usdc: "200.000000" },
      }),
    });
    await page.goto(`/mandates/${MANDATE_ADDRESS}`);
    await connect(page);
    await page.getByRole("button", { name: "Accept" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("800.000000 USDC")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm in wallet" }).click();
    await expect(dialog.getByText("Confirmed")).toBeVisible({ timeout: 15_000 });
  });
});

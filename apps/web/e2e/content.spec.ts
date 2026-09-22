import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  envelope,
  installMockWallet,
  mandateAccounting,
  mandateRow,
  mockApiRoutes,
  MARKET_ADDRESS,
  POOL_ADDRESS,
  WALLET_ADDRESS,
} from "./fixtures.ts";

test.describe("landing and static pages", () => {
  test("states what Mandate measures, the three outcomes, and the PreStocks issuer risk, with no a11y violations", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /market quality/i, level: 1 })).toBeVisible();
    await expect(
      page.getByText(/does not claim the pool.?s price is economically correct/i),
    ).toBeVisible();
    await expect(page.getByText("Compliant", { exact: true })).toBeVisible();
    await expect(page.getByText("Non-compliant", { exact: true })).toBeVisible();
    await expect(page.getByText("Unavailable (not measured)", { exact: true })).toBeVisible();
    await expect(page.getByText(/permanent delegate/i)).toBeVisible();
    await expect(page.getByText(/not investment advice/i).first()).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("has a skip link and a primary nav landmark reachable by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  test("the methodology page explains the measured metrics and reproducibility, with no a11y violations", async ({
    page,
  }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: /measurement methodology/i })).toBeVisible();
    await expect(page.getByText("Effective spread")).toBeVisible();
    await expect(page.getByText(/provider contribution/i).first()).toBeVisible();
    await expect(page.getByText(/permanent delegate/i)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("approved markets", () => {
  test("separates aggregate pool depth from provider contribution, and labels a market with no attestation yet", async ({
    page,
  }) => {
    await mockApiRoutes(page, {
      "/v1/markets": envelope([
        { address: MARKET_ADDRESS, asOfSlot: "10", account: { pool: POOL_ADDRESS, enabled: true } },
      ]),
      [`/v1/markets/${POOL_ADDRESS}/quality`]: envelope({
        pool: POOL_ADDRESS,
        market: {
          address: MARKET_ADDRESS,
          asOfSlot: "10",
          account: { pool: POOL_ADDRESS, enabled: true },
        },
        latestAttestedEpoch: {
          mandate: "MandateAddr11111111111111111111111111111",
          epochIndex: 0,
          outcome: "Compliant",
          observedUnixTs: "1700000000",
          observedSlot: "100",
          evidenceHash: "aa",
          payloadHash: "bb",
          aggregatePool: {
            effectiveSpreadBps: 251,
            buyDepthQuoteRaw: "63491020966",
            sellDepthQuoteRaw: "49065543907",
          },
          providerContribution: { quoteInBandRaw: "91107867", baseQuoteEqInBandRaw: "81314309" },
        },
        note: null,
      }),
    });
    await page.goto("/markets");
    await expect(page.getByText("2.51%")).toBeVisible(); // effective spread, aggregate
    await expect(page.getByText(/63491\.020966/)).toBeVisible(); // pool buy depth
    await expect(page.getByText("91.107867 USDC")).toBeVisible(); // provider contribution
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("explore mandates", () => {
  test("lists mandates and updates the URL and results when a filter is applied", async ({
    page,
  }) => {
    await mockApiRoutes(page, {
      "/v1/mandates": envelope({
        mandates: [
          {
            address: "Mandate1111111111111111111111111111111111",
            asOfSlot: "1",
            account: mandateRow(),
          },
        ],
        nextAfter: null,
      }),
    });
    await page.goto("/mandates");
    await expect(page.getByRole("heading", { name: /explore mandates/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Active" })).toBeVisible();

    const filtered = new Promise<void>((resolve) => {
      page.on("request", (req) => {
        if (req.url().includes("status=Active")) resolve();
      });
    });
    await page.getByLabel("Status").selectOption("Active");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await filtered;
    await expect(page).toHaveURL(/status=Active/);
  });

  test("shows accounting figures on the provider workspace once a wallet is connected", async ({
    page,
  }) => {
    await installMockWallet(page);
    await mockApiRoutes(page, {
      [`/v1/provider/${WALLET_ADDRESS}/mandates`]: envelope([
        {
          address: "Mandate1111111111111111111111111111111111",
          asOfSlot: "1",
          account: mandateRow(),
          accounting: mandateAccounting(),
        },
      ]),
    });
    await page.goto("/provider");
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByRole("menuitem", { name: "E2E Test Wallet" }).click();
    await expect(page.getByText(/300\.000000 USDC/)).toBeVisible();
  });
});

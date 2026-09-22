import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  envelope,
  mandateAccounting,
  mandateRow,
  mockApiRoutes,
  MANDATE_ADDRESS,
} from "./fixtures.ts";

test.describe("mobile viewport", () => {
  test("the landing page fits without horizontal scrolling and the nav still works", async ({
    page,
  }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Markets" })
      .click();
    await expect(page).toHaveURL(/\/markets$/);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("a mandate's terms, accounting and actions remain readable and reachable at phone width", async ({
    page,
  }) => {
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}`]: envelope({
        address: MANDATE_ADDRESS,
        asOfSlot: "1",
        account: mandateRow(),
        accounting: mandateAccounting(),
        positionSet: null,
        vaultReconciliation: null,
      }),
      [`/v1/mandates/${MANDATE_ADDRESS}/bids`]: envelope([]),
      [`/v1/mandates/${MANDATE_ADDRESS}/epochs`]: envelope({ totalEpochs: 3, epochs: [] }),
    });
    await page.goto(`/mandates/${MANDATE_ADDRESS}`);
    await expect(page.getByRole("heading", { name: "Mandate" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });
});

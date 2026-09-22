import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attestationRow, envelope, mockApiRoutes, MANDATE_ADDRESS } from "./fixtures.ts";

const OBSERVER_A = "ObserverA111111111111111111111111111111111";
const OBSERVER_B = "ObserverB111111111111111111111111111111111";

test.describe("evidence inspector", () => {
  test("shows unanimous agreement, the final result, and how to reproduce the measurement offline", async ({
    page,
  }) => {
    const a = attestationRow(OBSERVER_A, 0xaa);
    const b = attestationRow(OBSERVER_B, 0xaa);
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}/evidence/0`]: envelope({
        epoch: 0,
        outcome: "Compliant",
        result: {
          address: "R1",
          asOfSlot: "1",
          account: {
            ...a.account,
            outcome: "Compliant",
            rewardEarnedRaw: "300000000",
            rewardForfeitedRaw: "0",
            attestationCount: 2,
            finalizedBy: OBSERVER_A,
            finalizedAt: "1700000000",
          },
        },
        attestations: [a, b],
        agreement: {
          groups: [
            {
              evidenceHash: a.account.evidenceHash,
              payloadHash: a.account.payloadHash,
              observers: [OBSERVER_A, OBSERVER_B],
            },
          ],
          unanimous: true,
        },
        evidence: {
          evidenceHash: a.account.evidenceHash,
          note: "the evidence bundle has not been registered with this API; the on-chain hashes above still stand",
        },
        howToReproduce: {
          statement: "Replay the recorded snapshot through the deterministic measurement engine.",
          parameters: {
            pool: "PoolAddr",
            baseMint: "BaseMint",
            quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            provider: "Prov",
            positions: ["Pos1"],
            probeQuoteRaw: "10000000",
            depthBandBps: 500,
            algorithmVersion: 1,
          },
          expected: {
            payloadHash: a.account.payloadHash,
            evidenceHash: a.account.evidenceHash,
            metrics: a.account.metrics,
          },
        },
      }),
    });
    await page.goto(`/mandates/${MANDATE_ADDRESS}/evidence/0`);
    await expect(page.getByText(/all 2 attesting observer/i)).toBeVisible();
    await expect(page.getByText("300.000000 USDC")).toBeVisible();
    await expect(page.getByText(/Replay the recorded snapshot/)).toBeVisible();
    await expect(page.getByText(/"probeQuoteRaw": "10000000"/)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("warns loudly, and does not claim agreement, when observers disagree", async ({ page }) => {
    const a = attestationRow(OBSERVER_A, 0xaa);
    const b = attestationRow(OBSERVER_B, 0xcc);
    await mockApiRoutes(page, {
      [`/v1/mandates/${MANDATE_ADDRESS}/evidence/1`]: envelope({
        epoch: 1,
        outcome: "Pending",
        result: null,
        attestations: [a, b],
        agreement: {
          groups: [
            {
              evidenceHash: a.account.evidenceHash,
              payloadHash: a.account.payloadHash,
              observers: [OBSERVER_A],
            },
            {
              evidenceHash: b.account.evidenceHash,
              payloadHash: b.account.payloadHash,
              observers: [OBSERVER_B],
            },
          ],
          unanimous: false,
        },
        evidence: { evidenceHash: a.account.evidenceHash, note: "not registered" },
        howToReproduce: {
          statement: "Replay the recorded snapshot.",
          parameters: {
            pool: null,
            baseMint: null,
            quoteMint: null,
            provider: "Prov",
            positions: null,
            probeQuoteRaw: "10000000",
            depthBandBps: 500,
            algorithmVersion: 1,
          },
          expected: {
            payloadHash: null,
            evidenceHash: a.account.evidenceHash,
            metrics: null,
          },
        },
      }),
    });
    await page.goto(`/mandates/${MANDATE_ADDRESS}/evidence/1`);
    await expect(page.getByText(/observers disagree/i)).toBeVisible();
    await expect(page.getByText(/never averages disagreeing observations/i)).toBeVisible();
    await expect(page.getByText("This epoch has not been finalized on chain yet.")).toBeVisible();
  });
});

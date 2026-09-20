# Mandate — Sponsor and Stocklana Submission Strategy

**Re-check the live hackathon page immediately before submission.** Sponsor requirements may change.

Official Stocklana page:

```text
https://hackathons.solana.com/hackathons/stocklana
```

At bundle preparation time the page showed:

- main prize: $100,000;
- total prizes: $126,000;
- deadline: September 25, 2026, 4:00 PM ET;
- PreStocks bounty: $10,000;
- Clawpump bounty: $5,000;
- Meteora DBC bounty: $5,000;
- Pyth non-cash bounty (intentionally not pursued).

Counts of registered builders/submissions are dynamic and irrelevant to implementation.

---

## 1. Main-track story

Mandate should be submitted first and foremost as a **real market infrastructure product**, not a sponsor-integration collage.

Core pitch:

> Tokenized stocks can exist onchain and still have poor secondary markets. Mandate lets an issuer/community escrow a fixed USDC budget and publish a measurable liquidity SLA. Market makers bid for the job and get paid only for epochs where their registered Meteora positions and the actual pool meet the promised execution quality.

### Why user/problem is real

User:

- issuer/project/treasury that needs better market quality;
- market maker that can deliver it;
- traders who suffer when markets are shallow.

Problem:

- TVL is not the same as executable liquidity;
- generic emissions can pay capital that sits out of range;
- manual market-maker contracting is opaque;
- tokenized private-stock markets can be fragmented/thin.

### Why Solana

Solana gives:

- public market/position state;
- low-cost recurring epoch attestations;
- programmatic USDC escrow/reward settlement;
- composability with Meteora;
- transparent competitive bids and provider history.

The product should be difficult to port to a closed brokerage without losing the public verifiability/composability that defines it.

---

## 2. PreStocks bounty

Current bounty asks for unique, well-executed projects driving value for PreStocks and explicitly welcomes DeFi integrations/experiments. It also states that integrating competing **non-PreStocks pre-IPO tokens** makes the project ineligible.

### Strong natural fit

Use an exact live PreStocks/USDC Meteora market as the first production market.

Mandate provides value by creating a standardized way to fund/measure better secondary liquidity around PreStocks.

### Eligibility rules for repo/product

If ticking PreStocks:

- production asset registry for pre-IPO tokens includes only PreStocks;
- don't add Tessera/private competitors "for comparison";
- documentation and screenshots should not show competing pre-IPO token integrations;
- public-stock assets are a separate question, but keep the submission focused to avoid ambiguity;
- use current PreStocks API and exact mints;
- describe the token accurately as PreStocks economic exposure, not direct underlying share ownership.

### Evidence to show

- live PreStocks API lookup;
- exact PreStocks mint;
- exact real Meteora market;
- real provider position;
- real Mandate contract/reward lifecycle;
- measured difference between nominal position/TVL and actual in-band contribution where possible.

---

## 3. Meteora

### Core integration

Meteora DLMM is central to core Mandate measurement and provider liquidity.

That **does not automatically qualify** for the Stocklana Meteora bounty because the current bounty is specifically **Best Use of Meteora DBC**.

Do not tick the DBC bounty solely because:

- a DLMM pool is measured;
- a provider adds liquidity;
- the app links to Meteora.

### Optional future DBC extension

Only pursue if there is time after core product and the extension is meaningful, such as a genuine launch-to-market-quality lifecycle where:

1. an equity-like asset uses an original DBC configuration for launch/price discovery;
2. it graduates appropriately;
3. post-graduation, a Mandate automatically/explicitly procures ongoing market quality.

The DBC part must itself satisfy sponsor originality/technical criteria and ideally have real mainnet working code.

If not, skip the bounty and keep the product strong.

---

## 4. Clawpump

Current Stocklana requirement observed:

> Launch your token with a stock-paired liquidity pool using Clawpump and Meteora.

Merely using a Clawpump agent does not satisfy that sentence.

### Natural role if pursued

A **Mandate Market Maker Agent** can be a real provider:

- monitor open mandates;
- decide whether a mandate fits configured capital/risk policy;
- bid;
- manage its own Meteora liquidity positions;
- earn Mandate USDC compensation;
- have an onchain agent identity/token launched through Clawpump with the required stock-paired Meteora setup.

### Hard gates before ticking bounty

1. Call authenticated current `GET /api/v1/pump-pairs`.
2. Confirm a coherent stock quote mint is supported.
3. Re-read exact current bounty requirement.
4. Document current custody:
   - agent wallet;
   - Clawpump creator wallet;
   - payout wallet;
   - creator-fee flow.
5. Prove actual launch/pool onchain with tiny funds.
6. Prove agent actually performs a Mandate provider function.

If a PreStocks pair is unsupported, do not invent support. Decide whether a public-stock pair remains coherent **without violating PreStocks bounty constraints**. If it feels bolted on, skip Clawpump.

### Token utility warning

Do not claim the agent token governs Mandate or represents equity unless actually implemented/legal. It can simply be the Clawpump-required agent economic identity whose creator fees help fund the agent's operations, if true.

---

## 5. Tessera

Not part of Mandate. Do not integrate Tessera just for an extra bounty; it would also jeopardize PreStocks bounty eligibility if treated as competing pre-IPO token integration.

---

## 6. Pyth

Explicitly excluded by product owner. Do not add.

---

## 7. Submission positioning

### One-sentence pitch

> **Mandate is a market-maker procurement protocol: a tokenized-stock issuer escrows USDC, makers bid for the job, and the winner earns only when its real Meteora liquidity meets the promised spread/depth SLA.**

### 30-second pitch

> Creating a token does not create a good market. Today projects can pay liquidity incentives while users still face bad execution because TVL might be one-sided or out of range. Mandate lets an issuer define the exact market quality it wants, escrow a budget and accept a maker bid. We measure the winner's registered Meteora positions plus the pool's real executable depth every epoch. If the market meets the contract, the maker earns USDC; if it doesn't, they don't. Everything is auditable on Solana.

### Judge demo sequence

Show product within first 20 seconds:

1. real PreStocks market;
2. real Mandate thresholds + escrow;
3. competing bids;
4. accepted provider's real position;
5. green compliant epoch and earned USDC;
6. remove/move real fork liquidity -> red NonCompliant, zero reward;
7. restore -> pass;
8. claim.

Only after that explain architecture/quorum.

---

## 8. Claims that are safe to make

If proven in final build:

- "The sponsor escrowed X real USDC on Solana."
- "The provider registered these exact Meteora DLMM position accounts."
- "At slot X, 2-of-3 observer nodes independently produced the same canonical metrics."
- "This epoch met all five immutable thresholds and earned Y USDC."
- "This epoch failed because provider quote-side in-band liquidity was below the mandate minimum."
- "The protocol does not use TVL alone to determine payment."
- "The protocol does not use Pyth or a fair-value oracle."

---

## 9. Claims to avoid

Do not say:

- "guaranteed liquidity" without limiting it to measured contract epochs;
- "fair price";
- "risk free";
- "fully trustless measurement";
- "institutional grade" without evidence;
- "the market maker caused all pool liquidity";
- "we solved private-market liquidity";
- "PreStocks are actual OpenAI shares";
- "Meteora bounty integration" if no genuine DBC product exists;
- "Clawpump bounty complete" if token/pool requirement is not literally live.

---

## 10. Evidence package for judges

Repository should expose a compact `docs/submission/EVIDENCE.md` containing:

- program ID + verified build hash;
- mainnet/fork labels;
- exact mandate PDA;
- reward escrow tx;
- bid txs;
- accepted bid tx;
- provider Meteora positions;
- attestation txs;
- epoch result txs;
- reward claim tx;
- reconciliation result;
- real market measurement CLI output;
- source/version of official Meteora SDK;
- limitations.

If Clawpump included, add:

- agent ID/wallet;
- live stock-paired token/pool;
- launch transaction;
- provider/bid actions made by agent.

---

## 11. What would make this submission weak

- fake/synthetic market values in primary demo;
- paying based on overall pool depth without provider attribution;
- calling DLMM usage a DBC bounty entry;
- adding an AI chat window unrelated to execution;
- launching a useless agent token just to tick Clawpump;
- 15 screens but no real earned reward lifecycle;
- hiding observer trust;
- no proof of exact liquidity positions.

---

## 12. What would make it memorable

The strongest visual is a real reward meter that stops because real provider liquidity leaves the promised band:

```text
MANDATE: ANTHROPIC/USDC
Promise: >= $5,000 per side in-band; spread <= 100 bps

Epoch 7  COMPLIANT      +1.25 USDC
Epoch 8  NONCOMPLIANT   +0.00 USDC
         reason: provider quote-side contribution 3,814 < 5,000
Epoch 9  COMPLIANT      +1.25 USDC
```

That communicates the whole primitive without slides.

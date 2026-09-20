# Mandate — Product Requirements Document

**Project:** Mandate  
**Version:** 1.0 — Stocklana production MVP  
**Prepared:** 2026-09-20  
**Primary track:** Stocklana Main Track  
**Natural sponsor fit:** PreStocks  
**Core venue:** Meteora DLMM  
**Optional gated sponsor extension:** Clawpump  
**Explicitly excluded:** Pyth

---

## 1. Executive summary

Mandate is a Solana-native **market-quality procurement protocol**.

An issuer, asset community, treasury, venue or protocol can escrow USDC and publish a concrete liquidity requirement for an exact tokenized-stock market—for example:

> Maintain at least 8,000 USDC of executable buy depth and 8,000 USDC-equivalent sell depth within the configured impact band, keep effective two-sided spread below 100 bps, and contribute at least 5,000 USDC-equivalent of attributable in-range liquidity for 95% of 5-minute epochs over six hours.

Market makers bid for the contract. The sponsor accepts one bid. The provider registers the exact Meteora DLMM position accounts that will satisfy the mandate. Independent observer processes read public Solana/Meteora state, calculate canonical metrics using the official Meteora SDK and sign epoch attestations. Once a configured signature quorum is present, the Mandate program records the epoch. If all objective requirements pass, the provider earns that epoch's reward. If they do not, the provider earns nothing for that epoch.

The product changes liquidity incentives from:

> **"How much TVL did you deposit?"**

into:

> **"What useful, attributable market quality did you actually deliver?"**

Mandate does not manage a market maker's strategy, custody their trading wallet, predict fair value, or guarantee that a token's market price reflects the underlying company. It buys measurable execution quality on one approved venue.

---

## 2. Why this product exists

### 2.1 Tokenization does not create a functioning market

Creating a token is not the same thing as creating liquidity.

A token can technically trade while still being poor for users because:

- liquidity is shallow near the current price;
- one side of the market is much thinner than the other;
- nominal TVL is parked far out of range;
- small orders materially move price;
- providers remove liquidity for long periods;
- multiple pools fragment capital;
- a project pays generic liquidity emissions without knowing whether users received better execution.

PreStocks explicitly warns that secondary-market liquidity is not guaranteed. At the time this PRD was prepared, real PreStocks pairs existed on Meteora DLMM with dramatically different liquidity levels. That makes market quality a concrete present-day product problem rather than a theoretical future issue.

### 2.2 Traditional liquidity mining rewards inputs, not outcomes

A basic liquidity incentive often asks how much capital a user supplied. But 100,000 USDC-equivalent deposited outside the active trading range can be less useful than 10,000 USDC-equivalent positioned tightly around the market.

Mandate instead defines a service-level agreement (SLA) for liquidity and pays only when the SLA is objectively satisfied.

### 2.3 Market makers need a standard procurement surface

A token issuer that wants a better market currently has to:

- operate liquidity internally;
- negotiate with a market maker manually;
- run generalized emissions;
- or hope organic LPs arrive.

Mandate makes market quality procurable:

1. sponsor specifies the outcome;
2. market makers compete on price;
3. one provider is awarded the mandate;
4. public market data determines performance;
5. payment follows verified delivery.

---

## 3. Product thesis

Mandate's thesis is:

> **Liquidity is a measurable service. It should be purchasable through a transparent contract and paid for according to delivered market quality, not nominal deposits.**

The initial wedge is PreStocks markets on Meteora because:

- the assets are already live on Solana;
- liquidity quality varies across markets/pools;
- PreStocks explicitly wants integrations that increase usefulness of its tokens;
- Meteora exposes granular public DLMM state and official quote/position APIs;
- Solana enables reward escrow, bids, attestations and settlement in the same public environment.

---

## 4. Users and jobs to be done

### 4.1 Mandate sponsor

Possible sponsor identities:

- token issuer/project;
- asset community;
- DAO/treasury;
- exchange/venue;
- lending protocol considering an asset;
- ecosystem growth program.

Job:

> "I have a fixed liquidity budget. I want to buy a measurable improvement/maintenance service for a specific market and know whether I actually received it."

Needs:

- exact market selection;
- budget certainty;
- objective requirements;
- competitive bids;
- transparent live performance;
- no upfront payment to an unproven maker;
- recover unused budget;
- audit trail.

### 4.2 Market maker / liquidity provider

Job:

> "I can provide quality liquidity. I want to compete for paid mandates and receive deterministic compensation when I deliver."

Needs:

- clear SLA before bidding;
- no subjective score after capital is committed;
- provider-specific contribution attribution;
- live compliance feedback;
- predictable reward schedule;
- ability to claim earned USDC;
- reproducible measurements.

### 4.3 Trader / observer

Job:

> "I want to know whether this market has contracted liquidity and whether the provider is meeting it."

Needs:

- transparent mandate status;
- current market quality;
- historical epoch pass/fail;
- explanation of what is and is not guaranteed.

### 4.4 Protocol integrator — later

A lending/structured-product protocol may eventually use Mandate as evidence that a market meets minimum executable-liquidity requirements. This is future scope; v1 does not provide a universal risk certification.

---

## 5. Core user stories

### Sponsor

- As a sponsor, I can select an approved PreStocks/USDC Meteora DLMM market.
- I can define start time, duration, epoch length, maximum total reward and market-quality thresholds.
- I can escrow the maximum reward in USDC onchain.
- I can define a bidding deadline and receive maker bids.
- I can accept one valid bid whose requested compensation does not exceed my budget.
- Once the mandate begins, I cannot arbitrarily take back reserved funds that may be earned by the provider.
- I can see every epoch's measurement and pass/fail reason.
- After final settlement, I can withdraw unearned/unreserved USDC permitted by the contract.

### Provider

- As a provider, I can see exact requirements before bidding.
- I can submit a requested total compensation.
- If selected, I can register my exact Meteora DLMM position account(s).
- I can update the registered position set subject to an activation delay/cutoff so I cannot swap evidence after an epoch is measured.
- I can see whether my positions are contributing enough liquidity.
- I earn only for compliant epochs.
- I can claim earned USDC without sponsor approval.

### Public user

- I can inspect the live mandate and exact pool.
- I can inspect the accepted provider/bid.
- I can inspect registered positions and onchain ownership evidence surfaced by the observer.
- I can inspect each observation's slot, metrics, signature quorum, algorithm/version and pass/fail reasons.
- I can distinguish "failed" from "not observed/unavailable."

---

## 6. V1 product scope

### 6.1 Supported market type

V1 supports:

- Solana mainnet-beta and Surfpool fork for integration testing;
- exact **Meteora DLMM** pools only;
- exact PreStocks mint as base asset;
- USDC as quote/reward asset;
- market must be explicitly approved in Mandate's market registry.

Supporting all Meteora pool types would multiply measurement semantics and testing burden. DAMM v2 and DBC-graduated markets can be added later through separate venue adapters.

### 6.2 Mandate creation parameters

A sponsor configures:

- approved market/pool;
- bidding close timestamp;
- planned start timestamp;
- duration;
- epoch length;
- maximum USDC reward budget;
- maximum acceptable provider bid (normally the same as budget);
- maximum effective two-sided spread, in bps;
- price-impact/depth band in bps;
- minimum total pool buy-side executable depth, quote units;
- minimum total pool sell-side executable depth, quote-equivalent units;
- minimum provider-attributable quote-side in-band amount;
- minimum provider-attributable base-side in-band quote-equivalent amount;
- minimum required observation quorum (bounded by protocol config);
- optional minimum compliance percentage used for a public "completed successfully" badge; **this does not change per-epoch reward math in v1**.

All economic values and bps are exact integers with protocol-level bounds.

### 6.3 Bidding

V1 uses **open bids**, not sealed bids.

A bid contains:

- provider wallet;
- requested total USDC compensation;
- creation time;
- expiry/valid-until time;
- status.

The sponsor can select any valid bid. Lowest-price automatic award is future scope because provider reputation/capability may matter.

A provider does not transfer sponsor reward or market-making capital into Mandate when bidding.

### 6.4 Award and activation

When a sponsor accepts a bid:

- provider is fixed;
- accepted total reward is fixed;
- excess sponsor budget beyond accepted reward becomes withdrawable according to program rules;
- epoch schedule is fixed;
- provider receives a setup window to register positions;
- mandate begins at the configured start time.

Once Active:

- sponsor cannot cancel simply because the provider is performing well and reward is accruing;
- economic thresholds cannot be changed;
- provider cannot change compensation;
- market cannot be changed.

### 6.5 Provider position registration

The provider registers exact Meteora DLMM position public keys.

The observer layer must verify for each active registration:

- position exists;
- position belongs to the configured DLMM pool;
- position ownership/operator semantics correspond to the accepted provider under current Meteora state;
- position is not closed;
- position data is readable at the measured slot;
- position falls under the current supported position model.

A provider may use multiple positions up to a protocol hard cap.

Position-set changes are versioned. A new set becomes effective only from a future epoch boundary so the provider cannot retroactively choose which positions count after seeing a measurement.

### 6.6 Measurement epochs

A mandate is divided into fixed epochs, e.g. 5 minutes.

For each epoch, independent observer processes evaluate the same canonical payload at a designated observation slot/window.

The observer computes two categories.

#### A. Overall market quality

Using the official Meteora DLMM SDK/state:

- current active-bin price/state;
- small-probe buy effective price;
- small-probe sell effective price;
- effective two-sided spread in bps;
- maximum executable USDC buy notional whose price impact remains within `depth_band_bps` and is fully consumable;
- maximum executable base-token sell amount whose resulting USDC output, expressed in quote units, remains within the configured impact band;
- pool/state freshness and slot evidence.

This asks:

> **Can a trader actually execute meaningful size on both sides of this exact pool?**

#### B. Provider-attributable contribution

For only the provider's currently registered position accounts:

- quote-token amount contributed in bins inside the configured active price band;
- base-token amount contributed in those bins;
- base-side amount converted into quote-equivalent using the DLMM active-bin price solely for measurement normalization;
- position range coverage;
- position ownership evidence.

This asks:

> **Did the accepted provider actually put useful two-sided inventory near the market?**

Both categories must pass. Therefore a provider cannot receive rewards merely because unrelated LPs make the pool good.

### 6.7 Fair-value disclaimer

The active-bin price is used to define the measurement center and quote-equivalent normalization.

Mandate **does not** claim:

- the active-bin price equals the private company's fair value;
- PreStocks `markPrice` equals executable fair value;
- a compliant market is a safe investment;
- compliance eliminates issuer/legal/market risk.

PreStocks mark/token prices may be shown as contextual analytics, but they are not settlement inputs for v1.

### 6.8 Observer quorum

Full DLMM measurement is not reproduced inside the Mandate Anchor program in v1.

Instead:

- protocol config stores an approved fixed-size observer set and a threshold;
- each observer signs the same canonical epoch payload hash;
- an epoch can be recorded only when the required unique signatures are present;
- the program recomputes deterministic threshold checks over the attested integer metrics;
- the raw evidence bundle is stored offchain/content-addressed and indexed; the chain stores enough hashes/fields to verify linkage.

Observer software is open source and deterministic so anyone can independently recompute the metrics.

This is **auditable threshold attestation**, not trustless oracle elimination.

### 6.9 Epoch result

An epoch can be:

- `Compliant` — quorum present and every required metric passes;
- `NonCompliant` — quorum present, observation valid, one or more metrics fail;
- `Unavailable` — a valid quorum measurement could not be finalized/reconstructed under the allowed window.

`Unavailable` must never be silently treated as provider failure.

V1 handling:

- Compliant: provider earns the epoch reward.
- NonCompliant: provider earns zero for the epoch.
- Unavailable: reward remains unresolved/reserved until the recovery window defined in protocol config expires or a valid backfilled quorum result is posted from verifiable historical state.

If recovery is impossible after the recovery deadline, the unresolved amount is refundable to the sponsor **only under the explicit unavailable-epoch finalization rule**. The UI must make this distinction visible.

### 6.10 Reward calculation

The accepted provider bid defines total potential compensation.

Let:

```text
total_epochs = duration_seconds / epoch_seconds
base_epoch_reward = accepted_reward / total_epochs
remainder = accepted_reward % total_epochs
```

For deterministic exact allocation:

- epochs `0 .. total_epochs-2` earn `base_epoch_reward` if compliant;
- final epoch earns `base_epoch_reward + remainder` if compliant.

This guarantees the maximum possible earned amount equals the accepted bid exactly.

No floating point.

### 6.11 Claims and close

Provider can claim accumulated earned USDC at any time after epochs are finalized.

After mandate end and all epochs are finalized or recovery windows have ended:

- provider claims any remaining earned amount;
- sponsor withdraws unearned/refundable balance;
- mandate becomes Closed when vault/accounting invariants reconcile.

---

## 7. Functional requirements

### FR-1 Market registry

The protocol shall maintain an onchain market configuration for each supported pool containing at minimum:

- Meteora DLMM pool public key;
- base mint;
- quote mint;
- venue type/version;
- enabled/disabled state;
- optional offchain metadata hash/version.

The current PreStocks API and onchain mint must be revalidated before market approval.

### FR-2 Create mandate

Sponsor shall be able to create a mandate and atomically escrow the maximum USDC budget.

Creation fails if:

- protocol/market disabled;
- invalid pool/mints;
- unsupported duration/epoch settings;
- budget outside bounds;
- thresholds nonsensical;
- bidding/start timing invalid;
- sponsor lacks USDC;
- duplicate mandate ID.

### FR-3 Bid

Provider shall submit, update by replacement nonce, or cancel an active bid before bidding close.

No accepted bid can be cancelled.

### FR-4 Accept bid

Sponsor shall accept one valid bid before the acceptance deadline.

Acceptance fixes provider/reward/economic terms.

### FR-5 Register positions

Only accepted provider can register/deactivate positions.

Changes take effect from an explicitly recorded future epoch index.

### FR-6 Observe

Observer services shall create deterministic epoch payloads from real Solana/Meteora data and collect threshold signatures.

### FR-7 Record epoch

Anyone may submit a valid quorum payload to the program. Submission does not need to be privileged if signatures and mandate/epoch constraints verify.

### FR-8 Accrue reward

The program shall calculate pass/fail from attested metrics and accrue exact epoch reward once only.

### FR-9 Claim

Provider can permissionlessly claim earned unclaimed USDC to the accepted provider wallet/token account.

### FR-10 Finalize

Expired bids, surplus budget, failed epoch budget and post-recovery unavailable budget must have deterministic withdrawal paths.

### FR-11 Index/rebuild

All financial read models must be rebuildable from program accounts, events, signatures and observer evidence.

### FR-12 Transparency

Web/API must expose:

- exact pool and mints;
- sponsor;
- bidders and accepted bid;
- registered positions;
- epoch schedule;
- live/last measured metrics;
- epoch history;
- quorum/evidence status;
- earned/claimed/refundable amounts;
- limitations/disclaimers.

---

## 8. Non-functional requirements

### Security

- Anchor account constraints and PDA derivations must prevent account substitution.
- Sponsor reward vault must be program-controlled.
- Observer signatures must be unique, domain-separated and bound to mandate + epoch + algorithm version + slot + position-set version.
- No observer can redirect reward recipient.
- No sponsor can alter active thresholds or accepted compensation.
- No provider can record its own measurements without satisfying observer quorum.
- Integer overflow/underflow must fail safely.

### Reliability

- observer jobs idempotent by `(mandate, epoch, algorithm_version)`;
- chain submission idempotent via unique EpochResult PDA;
- RPC/provider failover configurable;
- backfill from chain after outages;
- exact status semantics: pending vs observed vs finalized vs unavailable.

### Scalability

V1 architecture should support hundreds/thousands of concurrent mandates by:

- horizontally scalable stateless API;
- worker/queue partition by mandate/epoch;
- batched RPC reads where appropriate;
- database indexes on chain identifiers and epoch time;
- observer processes separated from web traffic;
- bounded account sizes and separate PDAs for repeating data.

### Observability

Must provide:

- structured logs with correlation IDs;
- RPC latency/error metrics;
- observer quorum lag;
- epoch finalization lag;
- DB/indexer lag;
- USDC vault reconciliation alarms;
- queue depth;
- failed signature verification counts.

### UX

- never show an epoch as failed when it is unavailable/unobserved;
- never call nominal pool TVL "guaranteed executable liquidity";
- always surface exact measurement definition;
- always distinguish provider-contributed metrics from total-pool metrics.

---

## 9. Core screens

### 9.1 Explore mandates

Show:

- market;
- sponsor;
- status;
- budget/accepted reward;
- provider;
- headline requirements;
- recent compliance;
- time remaining.

### 9.2 Create mandate wizard

Steps:

1. choose approved PreStocks/USDC market;
2. inspect current real pool quality;
3. configure duration/epoch;
4. configure objective thresholds;
5. configure max reward and bidding close;
6. review exact financial/measurement terms;
7. sign USDC escrow + create transaction.

Never auto-suggest thresholds as "safe". The interface can show current observed metrics and explain relative strictness.

### 9.3 Mandate detail

Sections:

- contract summary;
- market/pool links;
- sponsor and accepted maker;
- bid book/history;
- provider registered positions;
- live latest measurement;
- epoch timeline;
- rewards accrued/claimed;
- evidence/quorum inspector;
- methodology.

### 9.4 Provider workspace

- open mandates;
- bid form;
- awarded mandates;
- position registration;
- current expected compliance based on latest read-only measurement;
- earned/claimable rewards;
- failure reasons.

### 9.5 Observer/evidence inspector

Technical page showing:

- canonical payload;
- slot/block time;
- pool/position account references;
- algorithm version;
- observer pubkeys/signatures;
- evidence digest/content address;
- independently reproducible command.

---

## 10. Measurement methodology — product-level specification

The detailed algorithm is in `docs/TECHNICAL_SPEC.md`; the product promises must stay limited to these concepts.

### Effective spread

Use small, configured two-sided probe quotes from the same pool state to derive buy and sell effective prices. Express their difference around the midpoint in integer bps.

### Executable depth

Using official Meteora quote semantics, find the largest trade size on each side that:

- is fully consumable;
- remains within the configured maximum price-impact/depth band;
- does not rely on a partial fill hidden as full depth.

### Provider contribution

Read only registered provider positions and sum their token amounts in bins inside the configured active price band. Normalize base token to quote-equivalent using the active-bin price for measurement only.

### Binary epoch compliance

All configured metrics must pass.

This intentionally avoids an opaque weighted "liquidity score" in the settlement path. A score can be shown analytically later, but money moves based on explicit thresholds.

---

## 11. Acceptance criteria for Stocklana MVP

Mandate is submission-ready only when all are true:

1. A real PreStocks/USDC Meteora DLMM pool is discovered and approved.
2. A sponsor wallet creates a real onchain mandate with USDC escrow.
3. At least two distinct provider wallets can submit real bids.
4. Sponsor accepts one bid onchain.
5. Accepted provider registers a real Meteora DLMM position.
6. Observer quorum reads real Solana state and produces matching signed payloads.
7. A compliant real epoch records and accrues exact reward.
8. A deliberately noncompliant real epoch is produced by changing/removing provider liquidity or choosing a controlled threshold such that the actual market fails; it records zero reward without faking inputs.
9. Provider claims real earned USDC.
10. Sponsor can recover permitted unused funds after finalization.
11. Full chain/read-model reconciliation passes.
12. Repository can reproduce the flow using documented commands and real mainnet-fork/mainnet state.

For the final tiny mainnet proof, economic amounts must be intentionally low, but **transactions and data must be real**.

---

## 12. Out of scope for v1

- fair-value/reference-price certification;
- Pyth or other external price oracle settlement;
- generic market-risk scoring;
- provider strategy custody/automation;
- mandate-created market-making wallets;
- maker leverage;
- multi-venue aggregation;
- cross-chain markets;
- multi-winner mandates;
- partial metric rewards/complex weighted scoring;
- subjective slashing;
- reputation token;
- governance token;
- DBC creation merely for bounty eligibility;
- legal guarantee that liquidity will always exist beyond measured epochs.

---

## 13. Future product directions

After v1 proves the primitive:

- multi-provider mandates;
- rolling/reauctioned mandates;
- provider reputation based on historical onchain SLA performance;
- cross-venue mandates;
- lender/protocol-triggered liquidity requirements;
- mandate templates by asset stage;
- provider bonds with objectively provable slashing conditions;
- algorithm marketplace for market makers;
- automated sponsor top-ups;
- integration with inventory lending such as a future Locate-style market;
- optional Clawpump autonomous maker bidding/execution;
- optional launch-to-liquidity lifecycle where a genuinely useful Meteora DBC product graduates into a Mandate contract.

---

## 14. Sponsor strategy

### Main track

Strong fit: real market problem, end-to-end Solana-native settlement, objectively measurable improvement, reusable infrastructure.

### PreStocks

Strong fit if the production market is a PreStocks asset and no competing non-PreStocks pre-IPO token is integrated. Mandate directly increases utility/secondary-market quality around PreStocks.

### Clawpump

Optional only. To enter, the current bounty requirement must be satisfied literally: the project's agent token must have a stock-paired liquidity pool launched using Clawpump and Meteora. The agent must also perform a genuine Mandate role, not exist as decoration. See `docs/SPONSOR_AND_SUBMISSION_STRATEGY.md`.

### Meteora DBC

Core Mandate is a DLMM market-quality protocol and does **not** qualify merely by using Meteora. Only enter the DBC bounty if a DBC-specific extension becomes central and technically justified.

### Pyth

Do not enter. Explicit product-owner decision.

---

## 15. Product language requirements

Preferred:

- "market-quality mandate"
- "executable depth under the configured impact band"
- "provider-attributable in-range liquidity"
- "observed at slot X"
- "compliant / noncompliant / unavailable"
- "auditable observer quorum"

Avoid:

- "guaranteed fair price"
- "risk-free liquidity"
- "fully trustless measurement" in v1
- "institutional-grade" without evidence
- "share of OpenAI" when describing a PreStock without qualification
- "oracle-free" if referring to Mandate as a whole; measurement still uses signed observers, even though it does not use a price oracle.

---

## 16. One-sentence pitch

> **Mandate lets tokenized-stock issuers buy measurable market quality: market makers compete for USDC contracts and earn only when their real Meteora liquidity meets the promised execution SLA.**

## 17. 10-second explanation

> An issuer says, "keep this stock market this liquid for six hours." Market makers bid for the job. We measure their actual Meteora positions every few minutes and pay only for the periods where the promised spread and depth are really there.

## 18. Demo story

1. Show a real PreStocks/USDC Meteora market and current measurable depth.
2. Sponsor creates a small real Mandate and escrows USDC.
3. Two maker wallets bid.
4. Sponsor awards one.
5. Winner registers a real DLMM position and adds/repositions real liquidity.
6. Observer quorum measures the position + pool and records a compliant epoch.
7. UI shows reward accruing.
8. Provider removes/moves enough of its real liquidity that the SLA fails.
9. Next real epoch is noncompliant; reward does not accrue.
10. Provider restores liquidity; later epoch passes.
11. Provider claims exactly earned USDC.

That is the product. Do not dilute this demo with unrelated features.

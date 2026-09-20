# Mandate — Technical Specification

**Version:** 1.0  
**Prepared:** 2026-09-20  
**Audience:** senior Solana/DeFi engineers and coding agents  
**Status:** implementation contract for Stocklana v1

---

## 1. System objective

Mandate is a Solana program plus observer/indexer/application stack that lets a sponsor escrow USDC and contract one market maker to satisfy explicit market-quality requirements on a specific approved Meteora DLMM PreStocks/USDC pool.

The accepted provider earns fixed per-epoch compensation only when:

1. the selected pool's actual two-sided executable quality satisfies the mandate; and
2. the provider's pre-registered DLMM position accounts make a minimum attributable contribution near the active market.

All financial settlement is onchain. Full Meteora measurement is performed offchain by a threshold observer set over public chain state and committed onchain as signed attestations. The measurement algorithm is deterministic, versioned and open source.

---

## 2. Architectural principles

### 2.1 Separate settlement from observation

The Anchor program is authoritative for:

- reward escrow;
- bids;
- accepted provider/terms;
- registered position set;
- observer-set snapshot;
- attestation membership;
- epoch status;
- exact reward accrual;
- claims/refunds.

Observer services are authoritative only for a bounded factual statement:

> "At slot S, using algorithm version A and evidence digest E, these public Meteora pool/position metrics were M."

The Anchor program itself decides whether `M` satisfies the immutable thresholds.

### 2.2 No fair-value oracle

There is no Pyth dependency and no external fair-value input in settlement.

The measurement center is the selected DLMM pool's own active market state. This means Mandate measures **liquidity/execution quality**, not whether the market price is economically correct.

### 2.3 Provider attribution is mandatory

Overall pool quality is insufficient for payment. Attestations must separately report liquidity amounts attributable to the accepted provider's registered positions.

### 2.4 No provider capital custody

Mandate does not take custody of provider stock/USDC liquidity and does not operate Meteora positions on behalf of providers in v1. Providers control their own positions and strategy. Mandate only measures and pays.

### 2.5 Fixed/simple reward logic

No subjective score determines money movement. Each epoch is binary: compliant or noncompliant. Unavailable is a distinct unresolved state.

---

## 3. Recommended monorepo

Use a pnpm/Turborepo-style workspace or current equivalent after verifying tool docs.

```text
mandate/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── Anchor.toml
├── Cargo.toml
├── apps/
│   ├── web/                 # Next.js frontend, Wallet Standard
│   ├── api/                 # stateless HTTP API / auth-free public reads
│   ├── indexer/             # chain event/account indexer + backfill
│   ├── observer/            # deterministic Meteora measurement worker
│   └── scheduler/           # epoch scheduling/quorum/finalize jobs
├── programs/
│   └── mandate/             # Anchor program
├── packages/
│   ├── domain/              # canonical TS types/math/status logic
│   ├── solana/              # generated clients/PDA builders/tx helpers
│   ├── meteora/             # exact DLMM venue adapter + measurement algorithm
│   ├── prestocks/           # typed public API adapter
│   ├── db/                  # Prisma/Drizzle schema and migrations
│   ├── config/              # validated env/runtime config
│   ├── observability/       # logging/metrics/tracing helpers
│   └── testkit/             # deterministic fixtures only for tests
├── infra/
│   ├── docker/
│   ├── deployment/
│   └── monitoring/
├── scripts/
│   ├── inspect-prestocks.ts
│   ├── discover-meteora-market.ts
│   ├── inspect-dlmm-position.ts
│   ├── backfill.ts
│   └── reconcile.ts
└── docs/
    ├── adr/
    ├── research/
    ├── runbooks/
    ├── methodology/
    └── evidence/
```

### Runtime recommendations

- TypeScript/Node version: pin a current supported LTS/current runtime after docs verification.
- Anchor/Rust/Solana toolchain: pin exact versions in repo and CI.
- PostgreSQL: durable read model.
- Redis/queue: recommended for production epoch scheduling and retry orchestration; all jobs must be idempotent.
- Object storage: optional but recommended for raw observer evidence bundles. Store hashes onchain/DB and never make object storage the financial source of truth.

---

## 4. External integrations

### 4.1 PreStocks

API:

```text
GET https://prestocks.com/api/prestocks
```

Adapter responsibilities:

- runtime schema validation;
- exact mint resolution;
- bounded cache TTL;
- freshness/as-of metadata;
- API schema drift alarms;
- onchain mint inspection before support;
- lifecycle/action-required metadata review before market approval.

Never use a ticker as a financial identifier.

### 4.2 Meteora DLMM

Official TypeScript SDK family observed during research:

```text
@meteora-ag/dlmm
```

Official current SDK exposes relevant operations including:

- `DLMM.create`;
- `getActiveBin`;
- `getBinsAroundActiveBin`;
- `getBinsBetweenMinAndMaxPrice`;
- `getPosition`;
- `getPositionsByUserAndLbPair`;
- `getBinArrayForSwap`;
- `swapQuote` / exact-out equivalents;
- position per-bin amounts.

Pin SDK version and record it in every evidence bundle.

Do not depend on DexScreener for settlement. Third-party discovery pages are useful for research only. Production market approval must verify the pool through Solana/Meteora state.

### 4.3 Solana

- reliable mainnet RPC + WebSocket provider;
- configurable second provider for failover/validation;
- Surfpool mainnet fork for integration testing;
- Wallet Standard/current official client patterns;
- Anchor program.

### 4.4 Clawpump

Not part of core runtime.

If optional extension is enabled:

- API base `https://clawpump.tech/api/v1`;
- current `GET /pump-pairs` is authoritative for supported custom launch pairs;
- current docs require an owned agent and payment for launch operations;
- launch writes are not all universally idempotent; guard retries;
- current docs say `/portfolio` is non-functional—do not depend on it unless reverified;
- agent wallet semantics and separate launch creator-wallet/payout-wallet semantics must be documented precisely.

---

## 5. Onchain program model

Program name: `mandate`.

All account sizes must be bounded and versioned.

### 5.1 Constants

Illustrative constants; final values must be tested and documented:

```rust
pub const MAX_OBSERVERS: usize = 5;
pub const MAX_POSITIONS: usize = 8;
pub const MAX_EPOCHS: u32 = 2_016; // e.g. 7 days at 5m; choose intentionally
pub const MAX_DURATION_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MIN_EPOCH_SECONDS: i64 = 60;
pub const MAX_EPOCH_SECONDS: i64 = 60 * 60;
pub const BPS_DENOM: u64 = 10_000;
```

Do not copy these blindly; validate account/rent/operational implications.

### 5.2 ProtocolConfig

PDA:

```text
[b"protocol"]
```

Suggested fields:

```rust
pub struct ProtocolConfig {
    pub version: u8,
    pub bump: u8,
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_token_program: Pubkey,
    pub paused_new_risk: bool,
    pub min_budget_raw: u64,
    pub max_budget_raw: u64,
    pub min_epoch_seconds: i64,
    pub max_epoch_seconds: i64,
    pub max_duration_seconds: i64,
    pub max_spread_bps: u32,
    pub max_depth_band_bps: u32,
    pub max_positions: u8,
    pub min_probe_quote_raw: u64,
    pub max_probe_quote_raw: u64,
    pub min_start_lead_seconds: i64,
    pub position_lock_buffer_seconds: i64,
    pub min_setup_window_seconds: i64,
    pub unavailable_recovery_seconds: i64,
    pub current_observer_set_version: u32,
}
```

`paused_new_risk` blocks new market configs/mandates/bids/awards as appropriate but must not trap already earned provider rewards or sponsor refunds that are already legally available under program rules.

Admin has **no unilateral right to move mandate reward vault funds**.

### 5.3 ObserverSet

Immutable versioned PDA:

```text
[b"observer_set", version_le_bytes]
```

Suggested fields:

```rust
pub struct ObserverSet {
    pub version: u32,
    pub bump: u8,
    pub observer_count: u8,
    pub threshold: u8,
    pub observers: [Pubkey; MAX_OBSERVERS],
    pub created_at: i64,
}
```

Rules:

- created only by admin;
- observer pubkeys unique/non-default;
- `1 <= threshold <= observer_count <= MAX_OBSERVERS`;
- immutable after creation;
- each mandate snapshots an exact `observer_set` account.

Changing protocol's current observer set affects only future mandates.

### 5.4 MarketConfig

PDA:

```text
[b"market", dlmm_pool.as_ref()]
```

Suggested fields:

```rust
pub enum VenueType {
    MeteoraDlmm,
}

pub struct MarketConfig {
    pub version: u8,
    pub bump: u8,
    pub enabled: bool,
    pub venue_type: VenueType,
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub base_token_program: Pubkey,
    pub base_decimals: u8,
    pub quote_mint: Pubkey,
    pub quote_token_program: Pubkey,
    pub quote_decimals: u8,
    pub prestocks_metadata_hash: [u8; 32],
    pub reviewed_at: i64,
}
```

For Stocklana v1:

- `quote_mint == ProtocolConfig.usdc_mint`;
- base mint must be explicitly approved after current PreStocks API + onchain verification;
- exact pool must be a real Meteora DLMM pool for base/USDC.

Market config is an allowlist/risk control, not proof of legal eligibility.

### 5.5 Mandate

PDA:

```text
[b"mandate", sponsor.as_ref(), mandate_id_le_bytes]
```

Status:

```rust
pub enum MandateStatus {
    Bidding,
    Awarded,
    Active,
    AwaitingFinalization,
    Closed,
    Cancelled,
}
```

Suggested fields:

```rust
pub struct Mandate {
    pub version: u8,
    pub bump: u8,
    pub sponsor: Pubkey,
    pub mandate_id: u64,
    pub market_config: Pubkey,
    pub observer_set: Pubkey,
    /// The reward vault token account (PDA `[b"vault", mandate]`), owned by this account.
    pub vault: Pubkey,

    pub created_at: i64,
    pub bidding_ends_at: i64,
    pub start_at: i64,
    pub epoch_seconds: i64,
    pub total_epochs: u32,
    pub end_at: i64,

    pub max_reward_raw: u64,
    pub accepted_reward_raw: u64,
    pub base_epoch_reward_raw: u64,
    pub final_epoch_extra_raw: u64,

    pub max_effective_spread_bps: u32,
    pub depth_band_bps: u32,
    pub min_pool_buy_depth_quote_raw: u64,
    pub min_pool_sell_depth_quote_raw: u64,
    pub min_provider_quote_in_band_raw: u64,
    pub min_provider_base_quote_eq_in_band_raw: u64,
    pub probe_quote_raw: u64,

    pub accepted_bid: Pubkey,
    pub provider: Pubkey,
    pub position_set: Pubkey,

    pub compliant_epochs: u32,
    pub noncompliant_epochs: u32,
    pub unavailable_epochs: u32,
    pub finalized_epochs: u32,
    pub earned_reward_raw: u64,
    /// Sum of rewards of epochs finalized NonCompliant or Unavailable. Needed to derive the
    /// unresolved amount exactly because the final epoch carries the remainder.
    pub forfeited_reward_raw: u64,
    pub claimed_reward_raw: u64,
    pub sponsor_withdrawn_raw: u64,
    pub status: MandateStatus,
}
```

All economic thresholds become immutable after award.

`probe_quote_raw` must be bounded. A probe too tiny can be dominated by rounding; too large mixes spread with depth. Market creation UI can show observed current values but cannot label defaults "safe."

### 5.6 Reward vault

Program-controlled associated token account or PDA token account owned by Mandate authority.

At creation:

```text
sponsor USDC -> reward vault = max_reward_raw
```

Vault invariant:

```text
vault inflows == provider claimed + sponsor withdrawn + current vault balance
```

No admin withdrawal path.

### 5.7 Bid

PDA:

```text
[b"bid", mandate.as_ref(), provider.as_ref(), nonce_le_bytes]
```

Status:

```rust
pub enum BidStatus {
    Active,
    Cancelled,
    Accepted,
    RejectedByAward,
}
```

Fields:

```rust
pub struct Bid {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub nonce: u64,
    pub requested_reward_raw: u64,
    pub created_at: i64,
    pub valid_until: i64,
    pub status: BidStatus,
}
```

No maker capital is escrowed in core v1.

### 5.8 PositionSet

Provider's fixed registered position set for this mandate.

PDA:

```text
[b"position_set", mandate.as_ref()]
```

Fields:

```rust
pub struct PositionSet {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub provider: Pubkey,
    pub position_count: u8,
    pub positions: [Pubkey; MAX_POSITIONS],
    pub locked_at: i64,
}
```

V1 rules:

- accepted provider only;
- created/updated only before `start_at - position_lock_buffer_seconds`;
- after lock, immutable for mandate lifetime;
- observer validates actual position ownership/pool membership; the program only verifies registered keys/bounds.

This deliberately trades rebalancing flexibility for a safer v1. A provider may pre-register several positions and adjust liquidity inside them if Meteora permits it.

### 5.9 EpochAttestation

One PDA per observer per epoch:

```text
[b"attestation", mandate.as_ref(), epoch_index_le_bytes, observer.as_ref()]
```

Fields:

```rust
pub struct EpochMetrics {
    pub effective_spread_bps: u32,
    pub pool_buy_depth_quote_raw: u64,
    pub pool_sell_depth_quote_raw: u64,
    pub provider_quote_in_band_raw: u64,
    pub provider_base_quote_eq_in_band_raw: u64,
}

pub struct EpochAttestation {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub epoch_index: u32,
    pub observer: Pubkey,
    pub observed_slot: u64,
    pub observed_unix_ts: i64,
    pub algorithm_version: u32,
    pub position_set: Pubkey,
    pub payload_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub metrics: EpochMetrics,
    pub created_at: i64,
}
```

Attestation instruction requires observer as transaction signer and checks membership in mandate's snapshotted ObserverSet.

### 5.10 EpochResult

PDA:

```text
[b"epoch", mandate.as_ref(), epoch_index_le_bytes]
```

Status:

```rust
pub enum EpochStatus {
    Compliant,
    NonCompliant,
    Unavailable,
}
```

Fields:

```rust
pub struct EpochResult {
    pub version: u8,
    pub bump: u8,
    pub mandate: Pubkey,
    pub epoch_index: u32,
    pub observed_slot: u64,
    pub observed_unix_ts: i64,
    pub algorithm_version: u32,
    pub payload_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub metrics: EpochMetrics,
    pub status: EpochStatus,
    pub reward_earned_raw: u64,
    pub finalized_at: i64,
}
```

A valid finalized result is immutable.

---

## 6. Program instructions

Names illustrative; use explicit accounts and typed errors.

### 6.1 `initialize_protocol`

- initialize ProtocolConfig;
- configure USDC + hard bounds;
- create initial ObserverSet separately.

### 6.2 `create_observer_set`

- admin only;
- immutable versioned set;
- validate uniqueness/threshold.

### 6.3 `upsert_market`

- admin only;
- new-risk pause rules apply;
- verify supplied mint accounts/token programs/decimals onchain where practical;
- exact Meteora pool semantic verification may require client/review process unless program deserializes Meteora account safely;
- store reviewed metadata hash.

### 6.4 `create_mandate`

Sponsor signer.

Validate:

- protocol/market enabled;
- quote mint is configured USDC;
- observer set valid;
- bidding ends before start;
- start sufficiently in future;
- duration divisible by epoch seconds in v1;
- total epochs bounded;
- budget bounds;
- spread/band/amount thresholds bounds;
- probe amount bounds.

Transfer exact `max_reward_raw` USDC into reward vault atomically.

Status `Bidding`.

### 6.5 `cancel_unawarded_mandate`

Sponsor only.

Allowed at any time while no bid has been accepted (status `Bidding`). "Before configured cutoff" is read as "until award": after the acceptance deadline an unawarded mandate can never be awarded, so refusing to refund it would strand the sponsor's funds, and no provider has committed anything before award (ADR 0012).

Return entire reward vault to sponsor and status `Cancelled`.

### 6.6 `submit_bid`

Provider signer.

Validate:

- mandate Bidding;
- now < bidding_ends_at;
- requested reward > 0 and <= max reward;
- valid_until >= now and <= acceptance/start cutoff;
- nonce uniqueness.

### 6.7 `cancel_bid`

Provider only; Active only; cannot cancel accepted bid.

### 6.8 `accept_bid`

Sponsor only.

Validate:

- mandate Bidding;
- bid Active/unexpired/belongs to mandate;
- bid provider valid;
- now before start/setup cutoff.

Set:

- provider;
- accepted bid;
- accepted reward;
- exact epoch reward split;
- status `Awarded`.

Surplus:

```text
surplus = max_reward_raw - accepted_reward_raw
```

Recommended: do **not** auto-transfer surplus inside acceptance if it makes tx complexity worse. Mark it immediately withdrawable via `withdraw_surplus_after_award`.

Unselected bids remain cancellable/refundable (they hold no funds, so only account closure/rent matters).

### 6.9 `register_positions`

Accepted provider only.

- exact bounded unique position pubkeys;
- no default keys inside count;
- must occur before position lock cutoff;
- creates/updates PositionSet;
- after cutoff immutable.

The observer later verifies actual Meteora ownership/pool membership.

### 6.10 `activate_mandate`

Permissionless or provider/sponsor callable.

At/after `start_at`, require:

- Awarded;
- PositionSet exists and locked;
- accepted reward valid.

Set `Active`.

Do not require sponsor to activate and thereby gain a rug/denial lever.

### 6.11 `submit_attestation`

Observer signer.

Input contains canonical metrics/hashes.

Checks:

- observer in snapshotted ObserverSet;
- epoch index valid;
- observed time/slot within allowed epoch observation window;
- algorithm version currently supported for this mandate;
- PositionSet matches;
- Attestation PDA unique;
- metric fields within type/protocol sanity bounds.

Write attestation.

All observers must independently produce the same `payload_hash` for quorum finalization.

### 6.12 `finalize_epoch`

Callable by anyone after observation time.

Caller supplies attestation accounts as remaining accounts, bounded by `MAX_OBSERVERS`.

Program verifies:

- unique observer identities;
- each observer belongs to snapshotted set;
- at least threshold attestations;
- all attestations match mandate/epoch/position set/algorithm/payload hash/evidence hash/slot/time/metrics exactly;
- EpochResult does not already exist.

Program calculates compliance:

```text
pass =
  effective_spread_bps <= max_effective_spread_bps
  AND pool_buy_depth_quote_raw >= min_pool_buy_depth_quote_raw
  AND pool_sell_depth_quote_raw >= min_pool_sell_depth_quote_raw
  AND provider_quote_in_band_raw >= min_provider_quote_in_band_raw
  AND provider_base_quote_eq_in_band_raw >= min_provider_base_quote_eq_in_band_raw
```

If pass:

- status Compliant;
- increment compliant_epochs;
- add deterministic epoch reward to earned_reward_raw.

Else:

- NonCompliant;
- increment noncompliant_epochs;
- reward 0.

Increment finalized_epochs.

### 6.13 `finalize_unavailable_epoch`

This instruction is intentionally delayed and tightly constrained.

Allowed only after:

- epoch observation/recovery deadline has passed;
- EpochResult absent;
- no quorum payload was finalized;
- current time satisfies immutable recovery rule.

Because inability to observe can be infrastructure failure rather than provider failure, the status is `Unavailable`, not NonCompliant.

Reward is zero and becomes sponsor-refundable only after unavailable finalization.

This rule must be highlighted in UI and security review.

### 6.14 `claim_provider_reward`

Accepted provider only (or permissionless transfer to fixed provider destination if designed that way).

```text
claimable = earned_reward_raw - claimed_reward_raw
```

Transfer exact USDC; update claimed.

Must remain callable even if protocol pauses new risk.

### 6.15 `withdraw_sponsor_surplus`

Sponsor only.

Available components:

- award surplus (`max - accepted`);
- after end/finalization: rewards corresponding to NonCompliant + Unavailable epochs and any exact rounding/reserved remainder not owed to provider.

Cannot withdraw any earned-but-unclaimed provider amount.

### 6.16 `close_mandate`

After:

- all epochs finalized (including unavailable after recovery);
- provider has claimed all earned reward OR funds remain claimable under an explicit account-lifetime policy;
- sponsor permitted balance withdrawn or left intentionally;
- vault reconciles.

Prefer not to force-close accounts if that could destroy unclaimed provider entitlement. If accounts are closable, use a long explicit claim horizon and document it.

---

## 7. Canonical measurement algorithm

This is the most important offchain specification. Implement once in `packages/meteora`, used by every observer and by read-only UI previews.

Every algorithm release has a monotonically increasing `algorithm_version` and a committed source/build hash.

### 7.1 Snapshot consistency

Each observation records:

- RPC provider;
- requested commitment;
- pool account slot;
- required bin-array account slots/state;
- position account slots/state;
- mint/token metadata state;
- block time when available.

Prefer a single RPC/provider and a bounded slot skew. If required accounts cannot be read within allowed skew, observation is not valid.

Observers should attempt to converge on a designated target slot/time window. Exact implementation depends on RPC historical/account support; document any limitation.

### 7.2 Pool orientation

Resolve token X/Y from DLMM state.

Canonical internal orientation:

```text
base = PreStocks token
quote = USDC
```

Every quote helper must normalize direction explicitly rather than assume base is X.

### 7.3 Baseline two-sided probe

Configured mandate value:

```text
Q0 = probe_quote_raw // USDC raw units
```

#### Buy probe

Quote exact input `Q0` USDC -> base.

Require:

- full input consumed (`consumedInAmount == Q0` under SDK semantics);
- base output `B0 > 0`.

#### Sell probe

Using the **same pool snapshot**, quote exact input `B0` base -> USDC.

Require:

- full `B0` consumed;
- output `S0 > 0`.

This creates an exact round-trip/effective spread probe without external price data.

### 7.4 Effective spread formula

Given:

```text
Q0 = quote spent to buy B0
S0 = quote received to sell B0
```

The buy/sell effective prices share the same base quantity, so base decimals cancel.

Canonical integer spread:

```text
diff = abs(Q0 - S0)
spread_bps = ceil(2 * diff * 10_000 / (Q0 + S0))
```

Use widened integer arithmetic (`u128`/BigInt) and checked operations.

This represents two-sided friction at the configured probe size. The UI should call it **effective two-sided spread** or **probe round-trip spread**, not a CLOB bid/ask spread.

### 7.5 Buy-side executable depth

Goal: largest USDC exact-input buy whose average execution price remains within `depth_band_bps` of the baseline buy probe and is fully consumable.

For candidate `Q` producing `B` base raw:

Baseline buy price proportional to `Q0 / B0`.

Candidate passes the impact band when:

```text
Q / B <= (Q0 / B0) * (10_000 + band_bps) / 10_000
```

Cross-multiplied exact integer form:

```text
Q * B0 * 10_000 <= Q0 * B * (10_000 + band_bps)
```

Also require full candidate input consumed.

Use deterministic exponential search to establish an upper failing bound, then integer binary search to the configured resolution. Hard-cap search at protocol/observer safety maximum to avoid unbounded RPC work.

Report:

```text
pool_buy_depth_quote_raw = max passing Q
```

### 7.6 Sell-side executable depth

Use candidate base input `B` producing quote output `S`.

Baseline sell effective price is `S0 / B0`.

Candidate passes when:

```text
S / B >= (S0 / B0) * (10_000 - band_bps) / 10_000
```

Exact form:

```text
S * B0 * 10_000 >= S0 * B * (10_000 - band_bps)
```

Require full base input consumed.

Search maximum passing `B`, then report its actual quote output:

```text
pool_sell_depth_quote_raw = S_at_max_passing_B
```

This makes both depth metrics USDC-denominated raw amounts.

### 7.7 Search determinism

All observers must use identical:

- SDK version;
- search initial size;
- growth factor;
- maximum iterations;
- binary-search stopping resolution;
- partial-fill policy;
- account snapshot policy.

These are constants of `algorithm_version`, not mandate-specific hidden config.

### 7.8 Provider in-band contribution

Load each registered position using official DLMM position APIs/state.

Verify:

- position belongs to selected pool;
- expected provider ownership/operator semantics;
- position is active/readable;
- no duplicate position counted twice.

Define the measurement price band around the active market according to `depth_band_bps` using pinned SDK price/bin helpers and canonical decimal rounding documented by algorithm version.

For all provider position bins inside the band, sum raw token quantities according to base/quote orientation:

```text
provider_quote_in_band_raw = sum(quote raw amounts)
provider_base_in_band_raw = sum(base raw amounts)
```

Convert base to quote-equivalent using baseline midpoint derived from the same probe:

Midpoint quote raw per base raw:

```text
(Q0 + S0) / (2 * B0)
```

Canonical floor conversion:

```text
provider_base_quote_eq_in_band_raw =
    floor(provider_base_in_band_raw * (Q0 + S0) / (2 * B0))
```

Use widened checked integer arithmetic.

The mandate has separate minimum thresholds for quote-side and base-side equivalent. This prevents a one-sided position from satisfying a two-sided mandate merely through total value.

### 7.9 What provider contribution does not mean

It does not claim that all registered liquidity would be consumed before other LPs. It proves the accepted provider actually has a minimum amount of both token sides allocated inside the relevant market band.

Actual trader experience is checked independently through aggregate executable-depth metrics.

### 7.10 Evidence bundle

Canonical evidence JSON/CBOR should include at minimum:

```text
schema_version
algorithm_version
algorithm_source_commit
lockfile_hash
cluster
mandate_pubkey
epoch_index
market_config_pubkey
dlmm_pool_pubkey
base_mint
quote_mint
position_set_pubkey
registered_position_pubkeys
observer_pubkey
observed_slot
observed_unix_ts
rpc_context metadata
probe inputs + SDK quote outputs
search trace or compact boundary proof
position per-bin normalized data
final metrics
raw account snapshot references/hashes
evidence_created_at
```

Serialize canonically and hash with SHA-256.

Observers signing identical market state must converge on identical `payload_hash` and final metrics. Evidence may include observer-specific transport metadata outside the canonical payload.

---

## 8. Attestation/quorum model

### 8.1 Why not a single backend

A single operator could fabricate metrics and redirect economic outcome. Threshold observers reduce this trust and make discrepancies visible.

### 8.2 Observer operation

Recommended Stocklana minimum:

- 3 observer keys/processes;
- threshold 2-of-3;
- preferably at least two separate RPC endpoints/providers;
- identical pinned code/algorithm.

Production should diversify operators and infrastructure further.

### 8.3 Signing path

Observers submit their own `submit_attestation` Solana transaction signed by the configured observer key.

This avoids detached-signature parsing complexity and makes identity explicit onchain.

### 8.4 Finalization

Scheduler/indexer sees threshold matching attestations and calls `finalize_epoch`.

`finalize_epoch` is permissionless: any caller can provide valid matching attestation accounts.

### 8.5 Observer disagreement

If observers produce different hashes/metrics:

- no quorum finalization occurs;
- alert immediately;
- preserve all evidence;
- retry/recompute if within observation/recovery window;
- never choose the "majority-looking" value offchain unless the exact onchain observer-set threshold is met.

---

## 9. Time/epoch semantics

For mandate:

```text
start_at
end_at = start_at + epoch_seconds * total_epochs
```

Epoch `i` covers:

```text
[start_at + i*epoch_seconds,
 start_at + (i+1)*epoch_seconds)
```

Choose one designated observation point per epoch, recommended near epoch end or midpoint; lock this into algorithm semantics.

Attestations must be within allowed time/slot drift.

Do not use client wall clocks for settlement; program uses Solana Clock sysvar.

---

## 10. Exact reward accounting

At award:

```text
N = total_epochs
R = accepted_reward_raw
base = floor(R / N)
extra = R % N
```

Reward for compliant epoch `i`:

```text
if i == N - 1:
    base + extra
else:
    base
```

NonCompliant/Unavailable: 0 earned.

Maximum earned exactly equals R if every epoch Compliant.

Sponsor withdrawable after full resolution:

```text
max_reward_raw
- accepted provider earned_reward_raw
- already sponsor-withdrawn amounts
- any provider amounts still owed/claimable
```

Implement this from invariants, not duplicated ad-hoc branches.

The reference implementation is `crates/mandate-core` (Rust) and `packages/domain` (TypeScript),
verified against shared golden vectors from an independent oracle (ADR 0009):

```text
earned + forfeited + unresolved == accepted
claimed <= earned <= accepted <= max
vault == max - claimed - sponsor_withdrawn
sponsor_withdrawable == (max - accepted) + (all epochs resolved ? accepted - earned : 0) - sponsor_withdrawn
```

Forfeited rewards are released to the sponsor only once **every** epoch is resolved (literal reading of
section 6.15), never per epoch.

---

## 11. Position ownership verification

The program does not blindly assert that a registered pubkey is a provider-owned DLMM position.

Observer algorithm must read current Meteora position state and verify exact ownership semantics according to the pinned SDK/program version.

At minimum evidence should show:

- position account key;
- owner/operator/fee owner fields relevant to the selected position type;
- selected provider key relationship;
- pool relationship;
- token amounts/bins.

If Meteora introduces new position/operator types that make ownership ambiguous, fail closed until adapter support is reviewed.

---

## 12. Database/read model

Suggested PostgreSQL tables:

```text
chain_cursor
markets
mandates
bids
position_sets
observer_sets
epoch_attestations
epoch_results
reward_claims
sponsor_withdrawals
prestocks_assets
measurement_evidence
jobs_audit
```

Key rules:

- use chain addresses/signatures as unique identifiers;
- chain events/accounts overwrite derived DB state, not vice versa;
- keep raw event payload/signature/slot;
- transactions with rollback/reorg must reconcile on chosen commitment strategy;
- support full destructive rebuild from chain + evidence store.

---

## 13. Indexer design

Responsibilities:

- WebSocket subscribe to Mandate program logs/accounts where appropriate;
- persist signature/slot/events;
- backfill via signatures after disconnect;
- update materialized views;
- trigger scheduler on award/active/end transitions;
- reconcile reward-vault token balances periodically;
- detect DB/chain mismatch loudly.

Never infer financial state solely from emitted logs when account state is available.

---

## 14. Scheduler/worker design

Use an idempotent queue.

Canonical job keys:

```text
observe:<mandate>:<epoch>:<observer>
finalize:<mandate>:<epoch>
backfill:<mandate>:<epoch>
reconcile:<mandate>
```

Observation jobs:

- scheduled according to epoch boundaries;
- safe to rerun before an attestation exists;
- once attestation PDA exists, verify rather than duplicate.

Finalization jobs:

- detect quorum;
- submit finalization once;
- on `already exists`, reconcile result instead of error-looping.

---

## 15. API design

Public API is read-oriented. Financial writes should return unsigned/partially built transactions for wallet signing or be built client-side through canonical package.

Suggested routes:

```text
GET  /v1/markets
GET  /v1/markets/:pool/quality
GET  /v1/mandates
GET  /v1/mandates/:pubkey
GET  /v1/mandates/:pubkey/bids
GET  /v1/mandates/:pubkey/epochs
GET  /v1/mandates/:pubkey/evidence/:epoch
GET  /v1/provider/:wallet/mandates
GET  /v1/prestocks
POST /v1/tx/create-mandate
POST /v1/tx/submit-bid
POST /v1/tx/accept-bid
POST /v1/tx/register-positions
POST /v1/tx/claim
POST /v1/tx/withdraw
```

If server builds transaction messages:

- never signs for users;
- recompute all economic values from request + chain state;
- no arbitrary instruction injection;
- short TTL/blockhash;
- client displays human-readable economic summary before signing.

---

## 16. Frontend architecture

Recommended current Next.js App Router or equivalent with Wallet Standard/current Solana integration.

State categories must be explicit:

- chain-confirmed;
- indexed-confirmed;
- observer-latest/read-only;
- pending transaction;
- unavailable/stale.

Never merge them into a single green "live" state.

### Core routes

```text
/
/markets
/mandates
/mandates/new
/mandates/[address]
/provider
/methodology
/evidence/[mandate]/[epoch]
```

### Transaction UX

For every wallet signature show:

- action;
- exact USDC amount;
- market/pool;
- mandate ID;
- relevant immutable thresholds/timing;
- destination/recipient.

---

## 17. PreStocks market approval pipeline

Admin approval is an explicit operational process, not automatic API ingestion.

Pipeline:

1. fetch current PreStocks API;
2. validate exact object/mint;
3. inspect Solana mint/token program/extensions;
4. discover candidate Meteora DLMM base/USDC pools using official Meteora state/search methods;
5. verify pool program/account/mints;
6. load pool via official SDK;
7. reproduce buy/sell probe quotes;
8. inspect at least one real position path;
9. confirm no active PreStocks lifecycle/action-required issue that makes market use inappropriate;
10. store dated research evidence;
11. admin creates MarketConfig.

No step may be replaced by hardcoding a pair from a third-party website.

---

## 18. Token-2022 handling

PreStocks may use Token-2022 or token features requiring careful transfers/interpretation.

Mandate's core Anchor program moves only USDC reward funds, not PreStocks tokens. This deliberately reduces Token-2022 transfer risk in the program.

Observer/Meteora adapter still must:

- inspect base mint program/extensions;
- use official Meteora handling;
- interpret position amounts as raw units;
- account for transfer-fee-excluded fields where the SDK exposes them;
- fail closed on unsupported active hooks/extensions.

---

## 19. Pause/emergency semantics

`paused_new_risk` should block:

- new mandates;
- new market approval if desired;
- new bids/awards depending on incident scope.

It must **not** block:

- provider claiming already earned USDC;
- sponsor withdrawing already-defined surplus/refundable amounts;
- epoch finalization for already active mandates;
- evidence/indexing.

Admin cannot seize escrow.

A separate market `enabled=false` prevents future mandates; it must not silently change existing active contracts.

---

## 20. Error taxonomy

Use explicit errors such as:

```text
ProtocolPaused
MarketDisabled
InvalidMarket
InvalidTiming
InvalidEpochLength
TooManyEpochs
InvalidBudget
InvalidThreshold
BiddingClosed
BidExpired
BidAlreadyAccepted
UnauthorizedSponsor
UnauthorizedProvider
UnauthorizedObserver
ObserverNotInSet
DuplicateObserver
PositionSetLocked
InvalidPositionSet
MandateNotAwarded
MandateNotActive
EpochNotReady
EpochOutOfRange
AttestationMismatch
InsufficientQuorum
EpochAlreadyFinalized
RecoveryWindowOpen
NothingToClaim
NothingToWithdraw
ArithmeticOverflow
InvalidUsdcAccount
```

Do not collapse settlement failures into generic `InvalidArgument`.

---

## 21. Events

Emit enough data for deterministic indexing without bloating logs.

Suggested:

```text
ProtocolInitialized
ObserverSetCreated
MarketConfigured
MandateCreated
MandateCancelled
BidSubmitted
BidCancelled
BidAccepted
PositionSetLocked
MandateActivated
EpochAttested
EpochFinalized
ProviderRewardClaimed
SponsorFundsWithdrawn
MandateClosed
```

Include mandate/bid/epoch identifiers and exact raw USDC amounts where relevant.

---

## 22. Security invariants

The following must be proven by tests/review.

### Reward invariants

1. Sponsor cannot withdraw earned provider reward.
2. Provider cannot earn more than accepted total reward.
3. Provider cannot claim more than earned.
4. Total token outflow never exceeds deposited reward vault balance.
5. Admin cannot move reward vault funds.

### Epoch invariants

6. Each epoch finalizes at most once.
7. One observer counts at most once toward quorum.
8. All quorum attestations must match exactly.
9. Attestations must be from the mandate's snapshotted observer set.
10. Metrics cannot be changed after EpochResult creation.

### Identity invariants

11. Only sponsor awards/cancels pre-award/withdraws sponsor funds.
12. Only accepted provider registers the position set and claims provider reward.
13. Accepted provider/bid/terms are immutable after award.

### Market invariants

14. Mandate binds exact MarketConfig/pool/mints.
15. PositionSet is bounded and immutable after lock.
16. Observer payload is bound to the exact PositionSet and pool.

### Time invariants

17. Bid acceptance cannot occur after configured cutoff.
18. Epoch index maps deterministically to time.
19. unavailable finalization cannot occur before recovery deadline.

---

## 23. Threat model

### Malicious sponsor

Attempts:

- take reward back after provider commits capital;
- change requirements mid-mandate;
- accept fake bid;
- redirect provider earnings.

Mitigation: immutable award, program vault, fixed provider, exact claim destination/account constraints.

### Malicious provider

Attempts:

- get paid for another LP's liquidity;
- register someone else's positions;
- temporarily flash liquidity around snapshots;
- manipulate pool price so range metrics look good;
- use one-sided liquidity to satisfy total value.

Mitigation:

- provider-position ownership verification by observer;
- provider-specific two-sided thresholds;
- aggregate executable-depth thresholds;
- randomized/jittered observation within a committed epoch window is a possible future anti-gaming measure, but if used it must be deterministic/auditable and specified before mandate creation;
- multiple epochs make one-time snapshots less valuable;
- no fair-value claim.

For Stocklana v1, observation timing should be known/deterministic for reproducibility. Do not secretly randomize and call it trustless.

### Malicious observer

Attempts to fabricate metrics.

Mitigation:

- threshold quorum;
- immutable observer set per mandate;
- public deterministic algorithm;
- evidence hashes/raw snapshots;
- independent infrastructure;
- monitor disagreement.

### Compromised admin

Can configure future markets/observer sets but cannot steal existing vaults or rewrite active mandate terms.

### RPC failure/manipulation

Mitigation:

- multiple observer processes/providers;
- slot/account evidence;
- quorum;
- unavailable state rather than invented value.

---

## 24. Testing architecture

### Rust unit tests

- reward split/remainder;
- epoch schedule boundaries;
- bps/threshold comparisons;
- withdrawable/claimable accounting;
- status transitions.

### Anchor integration tests

Every instruction and attack path.

### TypeScript domain tests

Mirror reward/time/validation logic.

### Measurement golden vectors

Capture deterministic real/forked DLMM account snapshots for tests, clearly labelled fixtures.

Golden tests should prove:

- spread formula;
- buy-depth search;
- sell-depth search;
- partial-fill rejection;
- base/quote orientation both ways;
- provider in-band totals;
- position duplication rejection;
- rounding boundaries;
- algorithm determinism across repeated runs.

### Surfpool integration

Use a current mainnet fork with real PreStocks mint and real Meteora DLMM program/pool state.

Test:

- live SDK load;
- real quote math;
- real position creation/adjustment if feasible on fork;
- observer evidence generation;
- quorum attestation submission to fork-deployed Mandate program;
- compliant/noncompliant epochs;
- reward claim/refund.

### Tiny mainnet proof

After security checklist:

- deploy verified program;
- create small real mandate;
- two real bid wallets;
- one real provider position on approved pool;
- short but legitimate epoch schedule within program minimums;
- real observers;
- claim actual small USDC reward.

No fabricated success.

---

## 25. Mainnet/fork distinction

Every UI/docs/demo artifact must label network:

- Local validator
- Surfpool mainnet fork
- Devnet
- Mainnet-beta

Never present fork signatures as mainnet.

---

## 26. Observability/SLO suggestions

Operational metrics:

```text
observer_epoch_jobs_total
observer_epoch_failures_total
observer_payload_disagreements_total
observer_rpc_slot_skew
attestation_submission_latency_seconds
epoch_quorum_latency_seconds
epoch_finalization_latency_seconds
indexer_slot_lag
reward_vault_reconciliation_error_raw
api_request_latency
queue_depth
```

Alerts:

- quorum not reached within expected window;
- observer disagreement;
- vault reconciliation non-zero;
- market pool no longer readable;
- base mint lifecycle/metadata changed;
- indexer > configured slots behind;
- duplicate/conflicting job attempts.

---

## 27. Clawpump optional architecture gate

Do not implement until core Mandate works.

If current `/pump-pairs` supports an economically relevant stock pair and the sponsor requirement is still the same, a Mandate Market Maker Agent can:

- run an autonomous strategy outside the Mandate program;
- bid on mandates through its agent wallet;
- own/manage Meteora liquidity positions;
- receive Mandate rewards to its wallet;
- optionally launch its own agent token through Clawpump with the required stock-paired Meteora liquidity setup.

The Mandate program treats the agent wallet like any provider. No special bypass.

Creator-fee revenue can fund the agent's operating capital only if this is real, disclosed and technically implemented.

If the exact bounty requirement cannot be satisfied naturally, omit this extension.

---

## 28. Meteora DBC optional gate

Core v1 is DLMM and must not be marketed as a DBC project.

Only pursue DBC if a later product flow genuinely needs:

- equity-like launch price discovery;
- curve/fee configuration;
- graduation into DAMM v2;
- and a Mandate after graduation that purchases ongoing market quality.

The DBC component must have original design value beyond launching a decorative token.

---

## 29. Deployment identities/secrets

Separate keys:

- program deploy authority;
- protocol admin (prefer multisig post-hackathon);
- observer 1/2/3 keys;
- indexer/API no signing key;
- optional scheduler relayer fee-payer key with limited SOL only;
- optional Clawpump API key/agent wallet.

Never reuse deploy authority as observer.

Never put user keys in backend environment.

---

## 30. Definition of technical completion

The build is technically complete only when:

- all program security invariants pass tests;
- measurement algorithm has deterministic golden vectors;
- two or more observer instances independently converge on real market data;
- the exact provider positions are attributable and visible;
- a full real/fork mandate lifecycle reconciles at raw-token level;
- mainnet/fork provenance is explicit;
- environment/runbooks allow another engineer to reproduce deployment;
- dependency/API versions are pinned and current-doc assumptions are recorded;
- final code has no fake runtime path used by the production UI.

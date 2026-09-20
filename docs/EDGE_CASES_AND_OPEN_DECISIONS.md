# Mandate — Edge Cases, Product Boundaries and Open Decisions

This document prevents implementation agents from silently resolving financially important ambiguity.

## 1. Decisions already made

These are **not open** unless the product owner explicitly changes them.

### 1.1 No Pyth

Do not use Pyth in core or optional scope.

### 1.2 Core venue is Meteora DLMM only

V1 does not generically support DAMM v2, Raydium, Orca, order books or cross-venue aggregation.

### 1.3 Core target asset is PreStocks/USDC

For PreStocks bounty eligibility, do not integrate competing non-PreStocks pre-IPO tokens.

### 1.4 No provider-capital custody

The provider owns/manages its Meteora liquidity. Mandate measures it and pays USDC; it does not custody/manage that liquidity.

### 1.5 No slashing in v1

A bad epoch earns zero. There is no subjective penalty/bond seizure.

### 1.6 Provider-specific attribution is mandatory

Aggregate pool depth alone cannot earn reward.

### 1.7 Position keys fixed for active v1 mandate

Provider registers a bounded set before start. No active-mandate replacement of position account keys in v1.

### 1.8 Binary per-epoch reward

All required thresholds pass -> epoch reward. Any required threshold fails -> zero. No weighted partial score in settlement.

### 1.9 Observer quorum is explicit trust

V1 is auditable threshold attestation over public chain state, not fully trustless onchain recomputation.

### 1.10 Sponsor cannot cancel after award/start for convenience

The sponsor's accepted reward is committed. They cannot rug the maker after capital is deployed. Only defined refund paths apply.

---

## 2. Market/asset edge cases

### PreStocks API disappears or schema changes

- market already approved onchain remains identifiable by mint/pool;
- no automatic destructive action;
- UI marks upstream metadata unavailable;
- new market approval fails closed;
- active mandate measurement continues if exact pool/mint state remains valid, unless a separate lifecycle safety rule says otherwise.

### PreStocks asset gets an action-required/deprecation event during mandate

Potentially material because the secondary market may become inappropriate.

V1 recommendation:

- observer/indexer raises critical incident;
- protocol admin may pause **new risk** and disable market for new mandates;
- existing mandate economic terms cannot be rewritten;
- product owner/operator must decide whether a future explicit emergency termination mechanism is needed.

Do not invent an admin cancellation that confiscates provider earned reward.

### Base mint freezes/pauses/transfers fail

Mandate itself holds no base token. Measurement likely shows provider contribution/market execution degradation and epochs fail/unavailable accordingly.

UI must explain issuer-level token controls.

### Multiple Meteora pools for same PreStock/USDC

Each MarketConfig is exact pool address. Mandate measures only the selected pool.

Do not silently aggregate across pools.

### Pool migrates or is replaced

DLMM pool identity is fixed. If a project wants a new pool, create a new MarketConfig/new mandate.

No active-mandate pool migration in v1.

### Pool orientation reversed

Meteora adapter must normalize base/quote regardless of X/Y ordering.

### Token decimals change

Mint decimals generally immutable, but config stores validated values. Any discrepancy is a fatal adapter/config error.

---

## 3. Liquidity measurement edge cases

### No buy probe liquidity

If `Q0` cannot be fully consumed or base output is zero, valid measurement returns metrics that cannot pass; observer should encode deterministic failure rather than crash.

Whether this is `NonCompliant` or `Unavailable`:

- **NonCompliant** if chain state is readable and genuinely lacks executable liquidity.
- **Unavailable** only if measurement cannot be established because required state/infrastructure is unavailable.

### Buy probe works, reverse sell probe fails

Readable state + insufficient reverse liquidity -> NonCompliant.

### Exact metric equals threshold

Equality passes (`<=` for max spread, `>=` for minimum depths/contribution).

### Partial fill

A quote that consumes less than requested amount cannot be presented as that requested executable depth.

Depth search rejects candidate unless full-consumption condition passes.

### Search upper bound reached without failure

Report the configured maximum-search cap and set evidence flag. If a mandate minimum is below/equal to cap it can still pass; UI should show depth is "at least" cap, not an exact maximum.

Do not perform unbounded search.

### Tiny probe dominated by rounding

Protocol config sets minimum probe raw amount. Market creation UI warns if probe is economically nonsensical.

### Huge probe itself causes material impact

Probe is part of immutable mandate and visible before bidding. It should be small enough to approximate two-sided execution friction but not so small it rounds to zero.

### Active price manipulated

Mandate does not claim fair value. Aggregate executable depth and provider contribution are measured around current pool state. A provider manipulating price can still create a market that is liquid at a bad price; this is outside v1's guarantee.

The UI must never upgrade "compliant" into "fairly priced."

### Provider positions all one-sided

Separate provider quote-side and base-side minimums prevent passing a two-sided mandate.

### Provider supplies liquidity outside band

Does not count toward provider in-band thresholds.

### Provider has broad position mostly outside band

Only per-bin amounts inside configured band count.

### Duplicate registered position

Reject registration and observer double counting.

### Position closes mid-mandate

Observer reads zero/unavailable state as defined by SDK. If closed and state is readable, contribution fails -> NonCompliant.

### Position ownership changes

If position NFT/ownership semantics allow transfer and registered position no longer belongs to accepted provider, provider contribution is invalid and epoch is NonCompliant (assuming state is readable).

### Provider uses operator-managed position

Only support if current Meteora SDK/program semantics allow observer to prove a deterministic provider/control relationship. Otherwise fail closed as unsupported position type.

### Provider adds/removes liquidity seconds around known snapshot

V1 fixed observation schedule is gameable at the margin. Multiple epochs and actual market cost reduce but do not remove this.

Future options:

- secret/randomized observation committed via VRF;
- time-weighted state sampling;
- multiple intra-epoch samples.

Do not secretly randomize v1 without changing the public methodology.

---

## 4. Bidding/award edge cases

### No bids

After bidding closes with no award, sponsor can cancel/withdraw full budget under explicit instruction.

### All bids exceed budget

Cannot accept. Sponsor can wait until bidding close/cancel. No hidden negotiation state.

### Provider bids then expires before sponsor accepts

Reject acceptance.

### Same provider has multiple bids

Allowed via nonce. Sponsor chooses one. Acceptance fixes only that bid; other bids become economically irrelevant/cancellable.

### Sponsor accepts a non-lowest bid

Allowed by product design. Bid price is not the only possible criterion. UI should make this transparent.

### Sponsor accepts at last moment before start

Require minimum setup buffer so provider has time to lock/register positions.

### Sponsor wants to increase budget after creation

Out of scope v1. Create a new mandate or future top-up feature. Do not mutate reward terms casually.

### Provider disappears after award

They simply fail future epochs and earn zero. Sponsor funds become refundable after epoch finalization/end according to rules.

No slashing in v1.

---

## 5. Time/epoch edge cases

### Duration not divisible by epoch size

V1 rejects mandate creation. Simpler exact accounting.

### Clock boundary

Use Solana Clock sysvar. Epoch intervals are half-open; document exact observation point/window.

### Chain stalls

Observation uses slots + block time and availability rules. Do not use backend wall time to pretend an epoch happened normally.

### Epoch finalization delayed

Can be finalized later as long as a valid quorum attested the correct historical observation. Reward timing delay does not change result.

### Mandate ends while final epochs not finalized

Status AwaitingFinalization; provider claims finalized earned amounts, sponsor cannot withdraw unresolved amounts prematurely.

---

## 6. Observer/quorum edge cases

### One observer offline in 2-of-3

Other two can finalize.

### Two observers offline

No quorum -> recover/backfill within recovery window; otherwise Unavailable after deadline.

### Observers disagree because RPC states differ

No finalization until matching threshold. Alert and re-read/reconstruct.

Never average metrics.

### One observer compromised

2-of-3 threshold prevents unilateral finalization.

### Two observers compromised

They can collude. This is a documented v1 trust assumption. Production must diversify operators/keys and potentially increase threshold.

### Observer key rotation

Active mandate snapshots immutable ObserverSet. Rotation creates a new set for future mandates. Emergency active-set replacement is not supported in v1 because it would alter trust terms after award.

If enough active observer keys are irrecoverably lost, remaining epochs may eventually become Unavailable; this is why key operations matter.

### Attestation replay

Payload/PDAs bind mandate + epoch + observer + position set + algorithm version. Replay to another mandate/epoch must fail.

### Algorithm bug discovered mid-mandate

Do not silently change algorithm version for an active mandate.

Possible paths:

- if safe, continue exact contracted algorithm and disclose limitation;
- pause new mandates;
- if bug makes settlement materially wrong/security-critical, escalate to product owner for explicit emergency policy.

No admin rewrite of historical earned reward.

---

## 7. Unavailable epoch policy

This is the most sensitive unresolved/trust edge.

The current v1 decision is:

1. missing measurement is not provider failure;
2. reward remains unresolved during recovery window;
3. historical state/backfill may produce normal quorum result;
4. only after recovery deadline can the epoch finalize Unavailable;
5. Unavailable reward becomes sponsor-refundable, not provider-earned.

This creates provider exposure to observer/system outages. It must be disclosed before bidding.

### Open decision if product owner wants stronger provider protection

Alternative: pay provider for unavailable epochs unless sponsor proves noncompliance. That shifts observer-infrastructure risk to sponsor and can be gamed by outages.

Do not switch without product-owner decision.

---

## 8. Reward/accounting edge cases

### Accepted reward not divisible by epoch count

Remainder allocated to final epoch only.

### Final epoch noncompliant

Its `base + remainder` stays unearned/refundable to sponsor.

### Provider claims mid-mandate

Allowed. Only finalized earned amount.

### Sponsor withdraws award surplus early

Allowed after award; cannot touch accepted reserved amount.

### Sponsor tries final refund before unresolved epochs finish

Reject.

### Token account receives accidental USDC transfer

Accounting/vault balance can exceed expected program obligations. Decide whether protocol has a permissionless/admin sweep of **excess only** calculated above all obligations.

Recommended v1: no generic sweep before security review; reconciliation should flag accidental excess. If implementing excess recovery, program must mathematically prove it cannot touch obligations.

### USDC changes token program/mint

Protocol config fixed. Future protocol version/new deployment required; active mandates unaffected.

---

## 9. Program/admin edge cases

### Protocol paused during active mandate

Continue attestations/finalization/claims/refunds. Pause is for new risk.

### Market disabled during active mandate

Disabling prevents new mandates. It does not rewrite active economics.

### Upgrade authority compromised

Upgradeable program remains a trust surface. Before real scale, use multisig/timelock and publish authority.

### Admin tries to alter observer set

Existing immutable version can't change. New version only for future mandates.

---

## 10. Frontend/data edge cases

### Indexer behind chain

Show explicit stale/indexing state and query chain for critical write preconditions. Do not show stale DB as definitive.

### Latest observer preview differs from finalized epoch

Label preview as read-only/latest; finalized chain result is historical financial truth.

### DexScreener differs from Meteora SDK

Settlement uses official onchain/Meteora adapter. Third-party values are not authoritative.

### PreStocks API tokenPrice differs materially from Meteora pool

Show as context only if desired, clearly labelled. Mandate compliance can still pass because fair-value correctness is out of scope.

---

## 11. Clawpump optional edge cases

### Intended PreStocks pair absent from `/pump-pairs`

Do not fake/invent. Either omit bounty or present another genuinely coherent stock pair only if doing so does not undermine PreStocks eligibility/product story.

### Agent wallet vs creator wallet confusion

Current docs distinguish agent wallets from Clawpump-controlled creator wallet/payout mechanics for launches. Record exact current behavior in ADR/UI.

### Launch retry

Current docs indicate some write endpoints are non-idempotent. Use preflight/payment proof/idempotency mechanisms exactly as documented and persist operation state before retry.

### Agent becomes unavailable

Core Mandate must remain usable by human market makers. Clawpump cannot be a single point of failure.

---

## 12. Meteora DBC optional edge cases

Normal DLMM integration does not qualify for DBC bounty.

If adding DBC later:

- do not launch a useless service token;
- do not misrepresent a synthetic token as actual stock exposure;
- DBC config must solve a real launch/market-quality lifecycle problem;
- prove mainnet working code if entering sponsor bounty, per current guidance.

---

## 13. Questions Codex should ask only if encountered

Codex should stop for product-owner input if implementation uncovers:

1. a real Meteora position type whose ownership cannot be mapped unambiguously to provider;
2. inability to reconstruct historical observations reliably enough for unavailable recovery;
3. a need for sponsor emergency cancellation after award;
4. a need to rotate observer set for an active mandate;
5. an accidental-vault-excess recovery mechanism;
6. a Clawpump integration that requires using a competing pre-IPO asset;
7. any sponsor rule conflict with core product;
8. any legal copy implying PreStocks token holders own actual underlying shares.

Everything else should be handled through senior engineering judgement + ADR.

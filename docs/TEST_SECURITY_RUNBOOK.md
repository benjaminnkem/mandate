# Mandate — Test and Security Runbook

Mandate moves real USDC based on observed market state. Treat the observer algorithm, attestation path and reward accounting as settlement-critical code.

## 1. Test pyramid

Required layers:

1. pure Rust financial/state unit tests;
2. pure TypeScript domain unit/property tests;
3. deterministic Meteora measurement golden tests;
4. Anchor instruction/invariant integration tests;
5. observer quorum integration tests;
6. DB/indexer/scheduler integration tests;
7. Surfpool mainnet-fork end-to-end tests against real PreStocks/Meteora state;
8. browser E2E tests;
9. load/restart/failure tests;
10. tiny real mainnet proof only after all prior gates.

A polished frontend does not compensate for missing settlement tests.

---

## 2. Mandatory pure financial tests

### Reward allocation

For many `(accepted_reward, epochs)` combinations verify:

```text
sum(max reward for each epoch) == accepted_reward
```

Cases:

- 1 raw USDC unit;
- reward smaller than epoch count;
- reward exactly divisible;
- one-unit remainder;
- large maximum values;
- overflow-adjacent values.

Note: if `accepted_reward < total_epochs`, many epochs would have zero base reward. Decide in validation whether this is allowed. Recommended: require accepted reward >= total_epochs raw units so every compliant epoch can earn at least one raw unit, or explicitly document zero-reward early epochs. Tests must match the final policy.

### Compliance equality

Pass on exact equality:

- spread == max;
- pool depths == minimums;
- provider contributions == minimums.

Fail one unit beyond threshold.

### Claim/refund conservation

Property:

```text
earned >= claimed
accepted_reward >= earned
max_reward >= accepted_reward
```

and no combination makes sponsor/provider total rights exceed vault funding.

---

## 3. Measurement-engine tests

### Spread formula

Verify exact integer formula:

```text
ceil(2 * abs(Q0-S0) * 10_000 / (Q0+S0))
```

Against hand-calculated vectors.

### Buy depth

For known quote responses test:

- candidate exactly within band;
- one raw/ratio unit beyond;
- partial fill;
- exponential upper-bound search;
- binary convergence;
- configured search cap;
- low-liquidity pool.

### Sell depth

Equivalent cases using sell inequality.

### Orientation

Run same economic fixture with:

- base token X / quote Y;
- base token Y / quote X.

Final metrics should be economically equivalent.

### Provider contribution

Test:

- one position;
- multiple positions;
- one-sided quote only;
- one-sided base only;
- bins on exact band boundary;
- bins outside by one step;
- duplicate position pubkey;
- closed/empty position;
- ownership mismatch;
- position on wrong pool.

### Determinism

Same snapshot + algorithm version must generate byte-identical canonical payload/hash across observer processes and repeated runs.

Run on Linux CI, local macOS and containerized Node where possible to detect serialization/decimal differences.

---

## 4. Anchor instruction security matrix

Every instruction needs tests for:

- correct happy path;
- missing signer;
- wrong signer;
- PDA substitution;
- wrong mandate/market/bid/observer set;
- wrong USDC mint/token program;
- writable/read-only account mistakes;
- duplicate initialization;
- invalid state transition;
- exact timestamp boundary;
- arithmetic overflow/underflow;
- protocol pause behavior.

### `create_mandate`

Test invalid:

- disabled market;
- observer set mismatch;
- bidding after start;
- zero/too-large budget;
- invalid epoch duration;
- non-divisible duration if prohibited;
- too many epochs;
- invalid spread/depth/probe thresholds;
- insufficient USDC;
- fake USDC account.

Assert exact reward vault delta.

### `submit_bid`

- bidding closed;
- bid > max reward;
- zero bid;
- expired validity;
- nonce collision;
- after award.

### `accept_bid`

- stranger tries acceptance;
- expired bid;
- bid from another mandate;
- second acceptance;
- too late for setup;
- reward math exact;
- surplus cannot consume accepted reserved reward.

### `register_positions`

- stranger;
- wrong provider;
- too many;
- duplicate/default keys;
- after lock/start;
- position set from another mandate.

### `submit_attestation`

- non-observer signer;
- observer from newer/older set;
- duplicate observer/epoch;
- wrong epoch time;
- wrong position set;
- unsupported algorithm version;
- absurd metric values if sanity caps exist.

### `finalize_epoch`

- insufficient quorum;
- duplicate same observer account supplied twice;
- mismatched payload hashes;
- mismatched slots/times/metrics;
- attestation from another mandate;
- exact threshold pass;
- one-unit fail;
- duplicate finalization;
- final-epoch remainder.

### `finalize_unavailable_epoch`

- before recovery deadline -> fail;
- after recovery -> success once;
- cannot overwrite normal final result.

### `claim_provider_reward`

- stranger redirect attempt;
- wrong destination token owner;
- claim before earned;
- double claim;
- partial/multiple claims if supported;
- pause still permits claim.

### Sponsor withdrawal

- cannot withdraw accepted reserved early except explicit surplus;
- cannot withdraw earned provider amount;
- final refund exact;
- pause still permits valid refund.

---

## 5. Observer quorum tests

Run three observer identities.

### Matching 2-of-3

Observers 1 and 2 attest identical payload; 3 offline. Finalize successfully.

### 1-of-3

No finalize.

### Malicious disagreement

Observer 3 signs changed depth by one unit. 1+2 still form valid quorum; 1+3 cannot match exact payload.

### Split 1/1/1

No finalization. Alert.

### Replay

Copy signed/attested values from epoch N to N+1: program rejects because PDA/payload binding differs.

### Observer key loss

Simulate one lost key; 2-of-3 continues. Simulate two lost; no quorum and eventually unavailable path.

---

## 6. Free-rider / attribution red-team

This is critical.

Try to make a provider earn while contributing nothing.

Attack cases:

1. register someone else's DLMM position;
2. register position on another pool;
3. register position then transfer ownership before epoch;
4. register empty position while unrelated LP provides deep pool;
5. register one-sided position;
6. duplicate same position in list;
7. put liquidity outside measurement band;
8. close position immediately after registration;
9. rely on overall pool quality only.

Expected: observer contribution metrics fail and epoch is NonCompliant or unsupported measurement fails closed.

---

## 7. Snapshot/gaming red-team

### Just-in-time liquidity

Provider adds liquidity immediately before known observation and removes after.

V1 may still reward if state truly satisfies exact contracted snapshot. This is a known product limitation, not a hidden test failure. Measure/quantify it.

Future time-weighted/random sampling should be documented, not silently added.

### Price manipulation

Provider trades pool to move active center then concentrates liquidity around manipulated price.

Mandate may still pass. Confirm UI/methodology never calls this fair pricing.

### Wash volume

Volume is not a core v1 settlement metric, so wash volume should not improve compliance.

### Far-away TVL

Add large liquidity outside band. Provider attribution remains below threshold.

---

## 8. Real Meteora integration tests

Before money-moving mainnet proof, verify against real/fork state:

- exact pool loads through official SDK;
- active bin readable;
- both quote directions work;
- partial fill behavior understood;
- position per-bin amounts match external/onchain inspection;
- Token-2022 transfer-fee/excluded amount semantics are correctly interpreted;
- transaction compute/account sizes for actual LP operations are measured if provider setup tooling creates positions.

Save dated research logs.

---

## 9. Surfpool end-to-end test

Required flow:

1. start Surfpool from real mainnet upstream;
2. verify PreStocks mint + Meteora pool are real forked accounts;
3. deploy Mandate program to fork;
4. initialize protocol/observer set/market;
5. fund sponsor/provider test wallets on fork using documented safe fork mechanisms;
6. sponsor creates real escrow mandate;
7. provider A/B bids;
8. sponsor accepts B;
9. provider B creates or uses real DLMM position through real Meteora program on fork;
10. register position;
11. activate;
12. observer 1 and 2 measure same real state and attest;
13. finalize compliant epoch;
14. alter real fork liquidity through Meteora so metrics genuinely fail;
15. observers attest failure;
16. finalize NonCompliant;
17. restore liquidity and pass a later epoch;
18. provider claims reward;
19. sponsor withdraws unearned amounts after complete finalization;
20. reconciliation returns zero mismatch.

No direct editing of pool accounts/DB metrics to create desired result.

---

## 10. Failure-injection tests

### RPC timeout

Observer retries boundedly; no invented result.

### RPC inconsistent slot

Observation invalid/retry; evidence records skew.

### Indexer crash

Restart and backfill with no duplicate DB rows/economic actions.

### Scheduler crash after submitting tx but before recording success

On retry, query chain/signature/PDA before re-submitting.

### DB unavailable

Chain settlement remains valid; API degrades honestly; workers avoid blind duplicate writes.

### Evidence object store unavailable

Do not submit attestation if required evidence durability policy says evidence must be stored first. Better miss/retry an observation than sign data whose proof artifact was lost.

### One observer corrupted config

Payload disagreement; no matching quorum with honest observer unless another honest one matches.

---

## 11. Database/indexer reconciliation tests

Build a clean database from chain.

Compare:

- number/status of mandates;
- bids;
- position sets;
- attestations;
- epoch results;
- earned/claimed/sponsor withdrawn amounts;
- reward vault balance.

Then delete DB and repeat. Result must match.

---

## 12. Property/state-machine testing

Generate random valid sequences such as:

```text
create -> bids -> award -> position -> activate -> attest/finalize -> claim -> close
```

with invalid interleavings injected.

Properties:

- vault never negative;
- provider claims <= earned;
- earned <= accepted reward;
- sponsor+provider rights <= max funded;
- exactly one award;
- exactly one result per epoch;
- no state returns from terminal to active.

Use Rust proptest/current equivalent where practical and TypeScript property testing for domain code.

---

## 13. Frontend E2E tests

Playwright/current equivalent:

- wallet connect/disconnect;
- create mandate validation;
- signature rejection;
- pending -> confirmed;
- two bidders visible;
- award;
- provider registration;
- compliant/noncompliant/unavailable labels;
- evidence inspector;
- claim;
- sponsor refund;
- mobile viewport;
- accessibility basics;
- stale indexer messaging.

Production UI must not include a hidden `?demo=true` fake data mode.

---

## 14. Load tests

Synthetic test data is allowed for load testing only and cannot enter production-visible runtime.

Test:

- 1,000 mandates;
- thousands of epoch rows;
- concurrent read requests;
- scheduler fanout;
- observer job throughput;
- DB indexes/query plans;
- WebSocket/indexer reconnect.

Do not load-test mainnet by hammering public RPC.

---

## 15. Security review checklist

### Anchor

- [ ] account owner/program constraints
- [ ] signer constraints
- [ ] PDA seeds/bump canonical
- [ ] token account mint/authority checks
- [ ] checked integer math
- [ ] bounded remaining accounts
- [ ] no duplicate observers counted
- [ ] immutable accepted terms
- [ ] no admin vault withdrawal
- [ ] pause exits safe

### Observer

- [ ] key files not in repo
- [ ] evidence deterministic
- [ ] correct pool/position ownership
- [ ] exact slot provenance
- [ ] pinned SDK/lockfile
- [ ] no third-party settlement dependency
- [ ] no float settlement comparisons
- [ ] disagreement alarm

### Backend

- [ ] no user keys
- [ ] rate limits
- [ ] input schemas
- [ ] tx builder cannot inject arbitrary destination
- [ ] idempotent queue
- [ ] SSRF prevention on any external URL handling
- [ ] secret redaction
- [ ] dependency audit

### Web

- [ ] no secrets
- [ ] no blind transaction signing
- [ ] human-readable transaction summary
- [ ] external links safe
- [ ] correct network banner
- [ ] unavailable != failed

---

## 16. Mainnet proof gate

Do not use mainnet until:

- all CI green;
- Surfpool flow passes;
- reconciliation zero;
- security checklist reviewed by someone other than primary implementer;
- deploy/admin/observer keys separated;
- program ID/build hash recorded;
- amounts capped to intentionally tiny values;
- provider understands real LP risk;
- sponsor understands reward cannot be clawed back once earned.

For mainnet, prefer proving one short real compliant lifecycle rather than risking capital to manufacture every failure mode. Failure modes can be proven on fork if clearly labelled.

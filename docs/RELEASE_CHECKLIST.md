# Mandate — Release Checklist

Use this as a hard gate before submitting Mandate.

> **Audit pass (2026-09-24)**: every item below was checked against the actual code/docs/tests in this
> repository, not assumed. `[x]` means verified with a citation. `[ ]` carries a note explaining exactly what
> is missing or why it is intentionally deferred. Nothing here is a guess.

## Product

- [x] One-sentence product description matches the actual live build. — `README.md` header, the Hero
      (`apps/web/components/landing/Hero.tsx`) and `Footer.tsx` all state the same claim: "pay for [verified]
      market quality, not deposited TVL."
- [x] Primary user and painful moment are obvious on the landing page. — Hero states the pain point directly;
      `AudienceSplit.tsx` splits the pitch by sponsor vs. provider.
- [ ] Happy path can be completed end-to-end by a fresh wallet/user following documented instructions. —
      **Blocked on two things**: (1) `README.md`'s clean-clone gap (missing clone step, env setup, per-app run
      commands) is fixed in this pass; (2) `README.md`'s own "Repository status" section states **no market is
      approved yet**, so there is currently no live approved market for a fresh user to walk the happy path
      against.
- [x] No broad feature claims point to unfinished routes or fake data. — all 4 navbar links
      (`apps/web/components/Shell.tsx`) and every footer link (`Footer.tsx`) resolve to an implemented page
      under `apps/web/app/`.
- [x] Sponsor integrations are load-bearing, not logo decoration. — `packages/meteora` (canonical measurement
      engine, pinned `@meteora-ag/dlmm`) and `packages/prestocks` are real, tested packages the program and
      observer depend on, not marketing.
- [x] Legal/economic language accurately describes PreStocks exposure rather than calling it direct company
      ownership. — no copy anywhere calls PreStocks "ownership"; the landing page's "Know the limits" section
      explicitly flags the Token-2022 permanent delegate, transfer fee and issuer pause switch as unmitigated
      risks (`apps/web/app/page.tsx`).

## Onchain program

- [x] Program builds reproducibly. — local `cargo clean -p mandate` + fresh build reproduced the identical
      hash `89c19e90d89c191fe68896c2579fb7e4b5dba920df4e95618be5a2178e858d36` (Prompt 15). The pinned
      `solana-verify` Docker image cannot currently build this program at all (bundled Cargo 1.84 lacks the
      `edition2024` feature Anchor 1.2.0's own `sha2`/`digest` chain requires) — documented honestly in
      `docs/FINAL_HANDOFF.md`, not glossed over.
- [x] Program ID/address is recorded. — `Anchor.toml`: `T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc`
      (localnet/devnet). Not yet deployed to any real devnet/mainnet cluster.
- [ ] IDL/client artifacts match deployed binary. — N/A until a real deploy happens. Locally, `pnpm idl:sync`
      keeps `packages/solana/idl/mandate.json` in sync with the compiled program (last verified during the
      Prompt 15 `error.rs` fix).
- [x] Upgrade authority/admin authorities are documented and secured. — `docs/FINAL_HANDOFF.md` §13 gives the
      full rotation plan; currently still the local dev keypair pending a real deployment decision.
- [x] Program verification/current equivalent completed where feasible. — see build-reproducibility note
      above; local determinism confirmed, third-party verifier blocked by an external tooling gap.
- [x] Every financial state transition has boundary/adversarial tests. — 199 LiteSVM tests in
      `crates/program-tests/tests/`. Confirmed per-transition: escrow creation (`create_mandate.rs:156,177,582,658`),
      bid accept (`bids.rs:383,445,507,568`), position registration (`positions.rs:229,256,280,394`), epoch
      finalize (`finalize.rs:231,245,401,441`), reward claim (`exits.rs:28-54`, over-claim/zero-claim/double-claim),
      sponsor refund/withdraw (`bids.rs:867,905,927`, `positions.rs:541,553`).
- [x] Program pause preserves legitimate exits according to specification. — `exits.rs:124-134`
      (`exits_survive_a_pause`) plus pause-path tests in `bids.rs:990`, `positions.rs:326,458,654`,
      `finalize.rs:486`, `create_mandate.rs:811`.
- [x] No admin instruction can seize active user funds outside documented rules. — `admin.rs:1-90` only exposes
      admin-transfer and pause instructions; neither touches a vault. `claim_provider_reward.rs:11-52` requires
      the provider's own signature (`has_one = provider`) — doc comment: "the sponsor, the admin and observers
      have no path to this money."
- [x] No unchecked arithmetic in settlement-critical code. — `crates/mandate-core/src/math.rs:5-21` wraps every
      add/sub/mul/div/rem in `checked_*`; `accounting.rs:208-220` uses `checked_add`. No raw arithmetic on
      token/bps values found anywhere in `programs/mandate/src`.

## Token handling

- [x] Every enabled mint is exact-address allowlisted. — `MarketConfig` PDA (`state/market_config.rs:8-11`),
      `enabled` flag enforced at `create_mandate.rs:41-46`.
- [x] Token program and decimals verified onchain. — `market.rs:29,32` asserts `quote_mint == protocol.usdc_mint`
      and `quote_mint.decimals == USDC_DECIMALS`; base token program/decimals are read from the mint account
      itself, never taken from client input (`market.rs:67-68`).
- [ ] Token-2022 extensions inspected and documented. — **Gap.** `crates/mandate-core/src/meteora.rs:7-8` states
      plainly that extension review (permanent delegate, transfer fee, transfer hook, etc.) is an **off-chain**
      admin judgment call baked into `prestocks_metadata_hash`, not something the program itself inspects. No
      `ExtensionType`/permanent-delegate/transfer-fee/transfer-hook check exists anywhere in
      `programs/mandate/src` or `crates/mandate-core/src`.
- [ ] Transfer Hook/fee/other active extensions handled correctly. — same root cause as above: there is no
      on-chain handling at all today.
- [ ] Unsupported extension state fails closed. — not true today: an unreviewed/unexpected mint extension does
      not cause any on-chain rejection: it is only excluded if a human admin catches it during off-chain review
      before approving the market.
  - **This is a real, product-owner-level decision, not a routine fix**: either (a) accept the documented
    off-chain-review-only trust model for v1 and say so explicitly in `FINAL_HANDOFF.md`/submission material, or
    (b) add an on-chain mint-extension check to `create_mandate`/market registration that fails closed on an
    unrecognized active extension. Option (b) is a real Anchor program change requiring new tests, an IDL
    resync and a fresh security pass — not attempted in this audit pass without your sign-off.

## Backend/indexer

- [x] Chain state can be rebuilt from a clean database. — `pnpm indexer:rebuild` command exists and is
      documented (`docs/FINAL_HANDOFF.md`); durable-cursor resume is tested (`apps/indexer/test/indexer.test.ts:153-167`).
- [ ] WebSocket disconnect/backfill tested. — **Gap.** The only related test
      (`indexer.test.ts:153-167`, "resumes after an interruption without skipping or duplicating anything")
      simulates an RPC call failure mid-backfill, not the `onLogs` WebSocket subscription itself
      dropping/reconnecting. `apps/indexer/src/main.ts:100-108` has a comment acknowledging "a dropped WebSocket
      costs latency, never correctness" but no test proves it.
- [ ] Duplicate events do not double-count state. — **Partially covered, not fully tested.** Real protection
      exists at the DB layer: `PRIMARY KEY (signature, event_index)` on `indexed_events`, `reward_claims`,
      `sponsor_withdrawals` (`packages/db/src/migrations.ts:35,127,137`) plus `ON CONFLICT DO NOTHING` inserts
      (`apps/indexer/src/indexer.ts:213-214,230-231,244-245`). No test explicitly redelivers the _same_
      signature twice to prove the guard actually fires (existing tests only replay after the cursor already
      advanced).
- [ ] External API schema failure tested. — **Gap.** No test feeds a malformed/schema-violating response from
      the Meteora SDK or RPC. Closest existing coverage is undecodable-account handling
      (`indexer.test.ts:97-103`) and known pool-state error paths (`packages/meteora/test/real-state.test.ts:241-270`),
      neither of which is a garbled-payload test.
- [ ] Rate limits/timeouts/retries documented. — **Partially done.** `docs/ENGINEERING_STANDARDS.md:201-212`
      _requires_ timeout + bounded retry with jitter + circuit breaker per external adapter, but no concrete
      timeout/retry values exist yet in the actual outbound RPC/Meteora call sites
      (`apps/indexer/src/chain.ts`, `packages/meteora/src/*`). Only inbound API rate limiting has a concrete
      configured value (`RATE_LIMIT_PER_MINUTE`, `packages/config/src/schemas.ts:66`, applied in
      `apps/api/src/server.ts:28-32`).
- [x] No server endpoint can move a user's funds without the user's required signature/protocol authority. —
      `apps/api/src/tx.ts` never holds or uses a signing keypair; every route (`claim`, `withdraw`, `submit-bid`,
      `accept-bid`, `register-positions`) returns an unsigned transaction (`requireAllSignatures: false`) with an
      explicit "this server cannot sign for you" notice.

## Frontend

- [ ] Wallet connect/disconnect/reload tested. — **Gap.** Every e2e spec exercises connect only
      (`apps/web/e2e/mandate-flows.spec.ts`, `content.spec.ts:127-142`, `create-mandate.spec.ts:32`,
      `mobile.spec.ts:53`). The mock wallet fixture supports a disconnect feature
      (`apps/web/e2e/fixtures.ts:50`), but no spec calls it or reloads the page afterward to check the
      disconnected state persists correctly.
- [x] Every money-moving action shows exact terms before signature. — `TransactionAction.tsx`'s review phase
      renders the action name (`DialogTitle`, line 172) plus a `SummaryList` of amount/token/destination/dates
      (lines 53-85, 203), populated per-flow (e.g. `apps/web/lib/solana/create-mandate.ts:81-93`). One caveat:
      `TxBundle.network.programId` (`apps/web/lib/types.ts:287`) is dropped before reaching the UI
      (`apps/web/lib/solana/transactions.ts:34-40`), so for API-built transactions (claim/withdraw/bid/accept)
      the displayed destination/terms depend entirely on the backend-populated summary, not an independent
      frontend check of the program ID.
- [x] Pending vs confirmed/finalized state is clear. — the `Phase` state machine
      (`idle→building→review→signing→pending→confirmed/failed/expired→error`) with `aria-live="polite"`/`"assertive"`
      regions.
- [ ] Error messages map to stable program/API codes. — **Gap.** `apps/web/lib/api.ts:18-26,52` populates an
      `ApiError.code` field from the server, but nothing in `apps/web` ever reads `.code` — confirmed by a
      repo-wide grep. `ErrorNotice.tsx:12` renders the raw `error.message` string as-is; there is no
      code-to-friendly-message mapping.
- [x] Mobile viewport works for the primary flow. — `mobile.spec.ts` asserts no horizontal overflow
      (`scrollWidth - clientWidth <= 1`) and exercises the primary flow at phone width.
- [x] No console errors on the happy path. — the duplicate-React-key bug found during live testing was fixed;
      the full Playwright suite (15/15, including both axe scans) passes clean after the shadcn/landing
      redesigns.
- [x] Contextual prices show source/freshness. — **N/A by design.** Grep of `apps/web` for "price" returns only
      disclaimer prose ("does not price fair value", "does not claim the pool's price is economically
      correct"). The product deliberately shows no USD-equivalent/fair-value figure anywhere, so there is
      nothing to attach a freshness label to.

## Security

- [x] Threat model updated to match final code. — `docs/TECHNICAL_SPEC.md` §23 "Threat model" (malicious
      sponsor/provider/observer, compromised admin, RPC failure/manipulation) plus
      `docs/EDGE_CASES_AND_OPEN_DECISIONS.md` §6 (observer/quorum collusion scenarios).
- [x] Dependency audit reviewed. — `cargo audit` clean (0 vulnerabilities); `pnpm audit --prod` found one real
      unpatched HIGH (`bigint-buffer`, a known unpatched Solana-JS-ecosystem issue with no fix available) plus a
      few lower-relevance findings, all recorded in `docs/FINAL_HANDOFF.md` (Prompt 15).
- [ ] Secret scanner passes. — **Not run in this pass.** Neither `gitleaks` nor `trufflehog` is installed
      locally; a manual `git log --all` search for env/keypair/secret-named files found nothing, but that is
      not a substitute for an actual scanner run. Recommend running one before submission.
- [x] No `.env`, keypair, API key or seed phrase committed in Git history. — `git log --all --oneline` for
      `*.env`/`*id.json`/`*keypair*`/`*secret*` paths returns nothing; the Surfpool rehearsal's `.surfpool/` and
      `.keys/` directories are untracked (`git ls-files` confirms empty).
- [x] Logs scrub authorization headers/private material. — `packages/observability/src/logger.ts`'s
      `REDACTED_PATHS` now covers request **and response** authorization headers plus `set-cookie` (added in
      this pass, `res.headers.authorization`, `res.headers['set-cookie']`), alongside RPC URLs, DB/Redis URLs
      and key material; covered by `packages/observability/test/logger.test.ts`.
- [x] Admin/observer/deployer keys are separated appropriately. — `docs/ENVIRONMENT_SETUP.md` key-separation
      section; `admin.rs` exposes no fund-moving instruction to the admin authority at all.
- [ ] Mainnet transactions use tiny intentional values during proof. — **N/A/deferred.** No mainnet proof has
      been executed yet, by your explicit prior decision (Prompt 15: "not yet — hold off").

## Infrastructure

Everything in this section is **documentation-only today**, per your explicit Prompt 15 answer
("documentation-only for now") — none of it is a code gap, it simply hasn't been provisioned:

- [ ] Production RPC configured with WebSocket. — no production RPC provider account exists yet.
- [ ] Database backups configured. — no production database exists yet.
- [ ] Migrations applied through CI/release process. — `pnpm db:migrate` exists; no CI/release pipeline runs it
      yet.
- [ ] Health/readiness endpoints monitored. — the endpoints themselves exist and work
      (`apps/api/src/server.ts:64,66` `/healthz`, `/readyz`; `apps/indexer/src/main.ts:54`,
      `apps/scheduler/src/main.ts:52` readiness hooks) — nothing is deployed/alerting on them yet.
- [ ] Indexer lag alert configured. — Prometheus metrics/alert rules exist in code (ADR 0018) but nothing is
      deployed to alert on them yet.
- [ ] External provider outage behavior documented. — partially: see the backend-section rate-limit/retry gap
      above; the requirement is written down, concrete retry/circuit-breaker behavior isn't implemented yet.
- [ ] Rollback strategy exists for web/API/indexer releases. — not yet defined; no deploy pipeline exists yet.
- [ ] Onchain upgrades require explicit release procedure. — `docs/FINAL_HANDOFF.md` §13 sketches the plan; it
      has never been exercised for a real deployment.

## Evidence

- [x] `docs/FINAL_HANDOFF.md` generated by final Codex audit prompt. — done, 429 lines (Prompt 15).
- [ ] Mainnet-fork E2E transcript committed under `docs/evidence/`. — **Wording mismatch, not a missing
      deliverable.** Prompt 13 explicitly instructed the transcript to be written to
      `docs/runbooks/surfpool-e2e.md`, and it was (395 lines, full golden path + failure injection +
      observer-disagreement scenarios). `docs/evidence/` itself does not exist. Recommend either treating
      `docs/runbooks/surfpool-e2e.md` as satisfying this item, or adding a short pointer file under
      `docs/evidence/` that references it, rather than duplicating 395 lines.
- [ ] Mainnet proof signatures recorded under `docs/evidence/mainnet.md`. — **Deferred**, no mainnet proof has
      been executed yet (explicit prior decision).
- [x] No mainnet-fork signature is labeled mainnet. — every "mainnet" mention in `docs/runbooks/surfpool-e2e.md`
      (lines 1, 5-7, 10, 16, 81, 84) explicitly qualifies it as a fork ("surfnet"), e.g. line 5: "Everything in
      this document ran on a Surfpool mainnet fork ('surfnet'), never on mainnet-beta."
- [ ] Video/demo uses current deployed product, not an obsolete local build. — no video/demo has been produced
      yet.
- [x] README setup works from a clean clone. — **fixed in this pass**: added the missing clone step, `.env`
      copy commands for every app (`.env.example` files confirmed to exist for all six), and explicit
      `pnpm --filter @mandate/<app> dev` commands verified against each app's actual `package.json` name and
      script.

## Stocklana submission

None of these should be marked done speculatively — hackathon pages and sponsor requirements can change
between now and actual submission, so re-check all of them live, immediately before submitting:

- [ ] Re-open current official hackathon page.
- [ ] Re-open current sponsor requirements.
- [ ] Confirm selected bounty eligibility.
- [ ] If claiming PreStocks, verify no competing pre-IPO asset integration was introduced. — currently true
      (only `packages/prestocks` exists; no competing pre-IPO package found) — re-verify at submission time in
      case that changes.
- [ ] If claiming Clawpump, verify the required Clawpump + stock-paired Meteora launch exists live. — N/A,
      Prompt 14 has not been run.
- [ ] If claiming Meteora DBC, verify DBC is genuinely central and working. — N/A, not attempted (core Mandate
      uses DLMM only, per scope lock).
- [ ] Project name, live app, repository and technical/demo video URLs all resolve without authentication
      surprises. — N/A until a real deploy/demo exists.
- [ ] Team members are registered correctly. — product-owner action.

## Open items requiring your decision before this gate can close

In priority order:

1. **Token-2022 extension enforcement** (Token handling section) — decide whether v1 ships with the documented
   off-chain-review-only trust model, or whether `create_mandate`/market registration should add an on-chain
   fail-closed check for unsupported active extensions. The latter is a real program change (new tests, IDL
   resync, fresh security pass), not a quick fix.
2. **Outbound RPC/Meteora retry, timeout and circuit-breaker values** (Backend/indexer + Infrastructure) —
   `docs/ENGINEERING_STANDARDS.md` requires this; no concrete values are implemented yet.
3. **Secret scanner run** (Security) — install and run `gitleaks` or equivalent once before submission.
4. Smaller, boundedly-scoped test gaps that can be closed without any product decision: WebSocket
   disconnect/backfill test, duplicate-event redelivery test, malformed external-API-response test, wallet
   disconnect/reload e2e test, and a frontend error-code-to-message mapping. None of these change money-moving
   logic; they close testing/UX gaps only.

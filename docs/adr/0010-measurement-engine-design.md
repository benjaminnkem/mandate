# ADR 0010: Measurement engine design

- Status: accepted for Prompt 3; two items deferred to Prompt 8 (below)
- Date: 2026-09-20

## Decisions

1. **Pure algorithm behind a `QuoteEngine`.** `measureQuality` depends only on `buy(quoteIn)` / `sell(baseIn)` returning `{consumedIn, out}`. The official SDK sits behind an adapter, so the algorithm is tested exhaustively offline (synthetic venue with brute-force cross-checks) and against real state (recorded snapshot). We never reimplement DLMM quote math (AGENTS.md rule 4).
2. **One atomic snapshot per observation.** The first design recorded the SDK's four separate reads. A replay of that recording differed from the live run, because the reads were served across an 11-slot window and the recorder kept one version per address: the live measurement had been a blend of slots. Fixed by discover-then-atomic-fetch (`observePool`): a single `getMultipleAccounts` at one slot, then a pure measurement from that snapshot. This is what makes replay exact and gives skew 0.
3. **Pin the SDK's wall clock.** `swapQuote` reads `Date.now()` to evaluate the volatility accumulator, so quotes depend on when they are computed. Each quote runs under `withPinnedClock(snapshot Clock timestamp)`. A test raises the accumulator on a loaded SDK object and shows the raw quote varies with the clock while the engine's does not.
4. **Quotes are transfer-fee aware on both legs**, straight from the SDK source: `consumedInAmount` is the fee-inclusive input, `outAmount` is net of the output transfer fee. The spread therefore includes pool fee plus transfer fee on both legs (measured 251 bps at the current 50 bps transfer fee).
5. **Exact integer comparisons and band bins.** No SDK float is used to decide anything.
6. **Failures are typed, and none is a compliance verdict.** `MeasurementError` (no valid probe, invalid band, duplicate position), `UnobservableError` (paused mint, active hook, wrong pool), `SnapshotSkewError`, `ReplayMissError`. All map to an `Unavailable` epoch, never `NonCompliant`.
7. **Load the SDK, `web3.js` and `spl-token` so that only one instance of each class exists** (ADR 0005); verified `web3.js` ESM and CJS resolve to the identical `PublicKey`.
8. **Position classification** as in ADR 0008; position bin amounts are the SDK's raw per-bin holdings.

## Deferred to Prompt 8 (must be decided before attestations exist)

- **Observer convergence.** Onchain quorum needs identical `payload_hash` from independent observers, but two observers reading at different moments see different pool state and so produce different hashes. Options: (a) a designated observation slot per epoch that every observer reads at or as close as possible to, with a tolerance-based quorum rule; (b) quantise metrics before hashing; (c) a single leader produces the payload and others verify by replaying its snapshot, signing only if their recomputation matches. Option (c) fits what is built here: replaying a leader's snapshot reproduces the hash exactly, so verification is a strict equality check. Recommended, to be confirmed in Prompt 8.
- **Historical observation.** Reading account state at a past slot is not generally available from RPC, so recovery (`Unavailable` backfill, PRD 6.9) may need an archival provider or observers persisting snapshots.

## Limitations

- Depth is measured within `BIN_ARRAYS_PER_DIRECTION = 24` bin arrays per direction; liquidity beyond that window is not counted (conservative).
- Only `PositionV2` positions are supported; legacy position accounts are `ExcludedNotAPosition`.
- The snapshot is read at `confirmed` commitment. Finalized-only reads are a later option.

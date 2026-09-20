# ADR 0014: Position sets, activation and the unactivated refund (Prompt 7)

- Status: accepted
- Date: 2026-09-20

## Decisions

1. **The program checks the shape of a position set, never its truth.** `register_positions` enforces 1 to
   `min(protocol.max_positions, 8)` keys, none default, none duplicated (`mandate_core::positions`, mirrored in the
   TypeScript inspector). It makes no claim that a key is a real DLMM position or that the provider owns it; observers
   measure that and record why any position counted or not (ADR 0008).
2. **The set is mutable only before the lock, and is replaced wholesale.** `position_lock_at = start_at - lock_buffer`;
   registration requires `now < position_lock_at` and an `Awarded` mandate, and every call fully replaces the previous
   set (no stale keys survive; tested). The set that exists at the lock is the set for the mandate's whole life, so a
   provider cannot swap positions after seeing a measurement.
3. **Deadlines are stored, not recomputed.** `acceptance_cutoff` and `position_lock_at` are computed once at creation
   and written into the `Mandate`. Bids, award and registration read the stored values, so a later change to protocol
   parameters can never move a live mandate's deadlines.
4. **Activation is permissionless and moves nothing.** `activate_mandate` needs no signer beyond the fee payer, requires
   `now >= start_at`, an `Awarded` mandate, and an existing position set derived from that very mandate. Neither sponsor
   nor provider can hold a ready mandate hostage. It ignores the pause flag: it finishes a commitment already made. It
   is listed in the structural tests as the only reviewed permissionless instruction, and that test also asserts it
   touches no funds.
5. **A liveness path the original prompt lacked: `refund_unactivated_mandate`.** Epochs can only be attested on an
   `Active` mandate, and activation needs a registered set. A provider who wins the award and never registers would
   otherwise strand the sponsor's reserved funds forever. After the lock, if the position-set account does not exist,
   the sponsor can recover everything in the vault and the mandate becomes `Cancelled`. It is impossible while the
   provider can still register, and impossible once any set exists (from then on the mandate can start and the ordinary
   epoch rules, including `Unavailable`, apply). This is a refund, not a penalty: v1 has no slashing, and the provider
   earned nothing by doing nothing. It is never gated on the pause flag. EDGE_CASES section 4 is updated accordingly.
6. **Pre-signature tooling.** `inspectPositionsForRegistration` (`@mandate/meteora`, CLI `pnpm positions:inspect`) reads
   each position through the official SDK and says which would count and which would silently count as zero: missing
   account, unsupported (non-`PositionV2`) type, wrong pool, not owned by the provider (with specific messages when the
   provider is only the operator or only the fee owner), plus warnings for an operator that can change liquidity, an
   empty position, an out-of-range position, and nothing inside the mandate's band. It also warns when the base mint is
   currently unmeasurable (paused or hooked). Its in-band totals equal the measurement engine's for the same snapshot.

## Verification

29 program tests (lock exact to the second, wholesale replacement, bounds, provider-only registration, activation timing
and permissionlessness, substitution of another mandate's set, refund conditions, pause behaviour), 13 inspector tests on
real accounts, and 10 deliberate program mutations. Two apparent "survivors" were harness artifacts (the mutation text
did not match the formatted code, so the unmutated program was tested); the harness now aborts on an unapplied mutation.
Re-run correctly, both were killed. The earlier equivalence claim in ADR 0013 (bid-to-mandate binding) was re-verified
with an applied mutation.

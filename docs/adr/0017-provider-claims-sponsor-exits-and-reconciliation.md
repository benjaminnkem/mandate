# ADR 0017: Provider claims, sponsor exits, closing and reconciliation (Prompt 10)

- Status: accepted
- Date: 2026-09-21

## Decisions

1. **`claim_provider_reward(amount_raw)` moves only `earned - claimed`.** The provider must sign; the destination
   token account must be owned by the provider and hold USDC; the amount is checked by the same pure accounting code
   the TypeScript domain uses. An explicit zero is `NothingToClaim`, not "claim everything". The sponsor, admin and
   observers have no path to this money. It is not pause-gated.
2. **Sponsor exits reuse `withdraw_surplus_after_award`.** It already releases the award surplus at any time and
   forfeited rewards once every epoch is resolved, never the earned amount, so no second instruction was added. It
   is not pause-gated, and (Prompt 10 tests) survives a pause.
3. **`close_mandate` closes only an empty vault.** It requires every epoch resolved, nothing claimable, nothing
   withdrawable by the sponsor and a zero vault balance; it closes the vault token account (rent to the sponsor,
   enforced by an address constraint) and sets `Closed`. The `Mandate` and all `EpochResult` accounts are kept as the
   permanent record, so no unclaimed entitlement can be destroyed by closing. Anyone may call it.
4. **Conservation is enforced on every fund movement:** after each transfer the vault balance must equal
   `max - claimed - sponsor_withdrawn` and `assert_invariants` must hold, else the transaction fails with
   `VaultMismatch`.
5. **Reconciliation** (`@mandate/solana` `reconcileMandate`, CLI `pnpm reconcile:mandate <mandate>`) compares the
   mandate's counters, every `EpochResult` and the vault balance, and reports deposits, earned, forfeited,
   unresolved, claimed, claimable, sponsor withdrawn and remaining obligations. The CLI exits 1 on any mismatch and
   2 if the mandate cannot be read. It reports impossible data as findings rather than throwing.
6. **Tests:** a randomized state machine (12 seeds, deterministic PRNG) applies random finalizations, claims,
   sponsor withdrawals and close attempts against the compiled program and checks after every step that the chain
   equals the pure model, the invariants hold, the vault covers every provider entitlement, and every raw unit ends
   with exactly one party.

## Known limits

- `Cancelled` mandates (unawarded cancel, unactivated refund) are terminal by their own instructions and are not
  closed by `close_mandate`; their vault rent stays with the program-owned token account. A follow-up can close
  those vaults the same way.

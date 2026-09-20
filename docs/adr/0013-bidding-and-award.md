# ADR 0013: Open bidding and award (Prompt 6)

- Status: accepted
- Date: 2026-09-20

## Decisions

1. **A bid holds nothing but a proposal.** PDA `[b"bid", mandate, provider, nonce]`; the provider pays only rent. No
   provider capital and no sponsor reward moves at bid or at award.
2. **Nonces preserve history.** One provider can hold many bids on a mandate with distinct nonces; a nonce cannot be
   reused while its account exists. "Update" is cancel plus a new nonce.
3. **The acceptance cutoff is one canonical definition**, `start_at - position_lock_buffer - min_setup_window`,
   implemented identically in the Python oracle, `mandate-core` and `@mandate/domain` (14 golden vectors including i64
   edges). Bids may not be valid past it, and the sponsor may accept only at or before it, so a provider is never left
   less than the setup window (ADR 0009).
4. **Award is one atomic, final act.** It fixes provider, reward and the exact split (`base = floor(R/N)`, remainder to
   the last epoch, computed by the same core math the TypeScript domain uses) and moves the mandate to `Awarded`. A
   second award, a cheaper bid, or any change is impossible because the mandate is no longer `Bidding`; the award
   account bytes are asserted unchanged after failed attempts. There is no lowest-price rule.
5. **Pause blocks new risk only.** `submit_bid` and `accept_bid` are refused while paused (an award is a new
   commitment). `cancel_bid`, `close_bid`, `withdraw_surplus_after_award` and `cancel_unawarded_mandate` are never
   gated: nobody can be trapped by a pause.
6. **Cancel versus accept has exactly one winner**, decided by transaction order: whichever runs first makes the other
   fail because the bid is no longer `Active`. A provider can cancel at any time while active, including after bidding
   closes or after the bid expires. An accepted bid can never be cancelled.
7. **Closing bids.** `close_bid` (added beyond the four instructions in the prompt) lets a provider reclaim rent once a
   bid cannot matter: after cancelling it, or once its mandate has left `Bidding` (awarded elsewhere or cancelled). The
   accepted bid is a permanent record and is never closable. Closing a bid frees its nonce; history is preserved in
   events. `BidStatus::RejectedByAward` exists for indexers but the program need not write it.
8. **Surplus withdrawal uses the shared accounting.** `withdraw_surplus_after_award(amount)` asks
   `AccountingState::sponsor_withdraw` what is releasable (`max - accepted` now; forfeited rewards after all epochs
   resolve, later prompts), moves exactly that, and afterwards requires the vault to equal the accounting's view and all
   conservation invariants to hold. A zero amount is an error, not "withdraw all". The reserved reward is never
   releasable: the mutation that made it so was caught by five tests.
9. **Sponsor may bid on their own mandate.** It harms no one (their own funds) and is not prevented.

## Verification

39 program tests (bounds to one raw unit and one second, both cancel/accept orders, expiry and cutoff edges, foreign-bid
and vault substitution, signer requirements, pause behaviour, conservation). Twelve deliberate breakages were run; eleven
were caught directly. The twelfth removed only `has_one = mandate` on the accepted bid: it survives because the bid's PDA
seeds independently bind it to the mandate, and removing both guards was confirmed to fail a test.

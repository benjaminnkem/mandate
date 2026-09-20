# ADR 0012: Mandate creation and USDC escrow (Prompt 5)

- Status: accepted
- Date: 2026-09-20

## Decisions

1. **The vault is a PDA token account whose token authority is the Mandate account.** Address `[b"vault", mandate]`,
   `token::authority = mandate`. Only this program, signing with the mandate's seeds, can ever move it; there is no
   admin path (asserted by the IDL structure tests, which fail if a fund-moving instruction appears that is not on
   the reviewed list, that takes an admin-like account, or that is not sponsor-signed). The vault is closed on
   cancellation and its rent returns to the sponsor.
2. **Creation is atomic.** In one transaction the mandate and vault are created and exactly `max_reward_raw` moves
   from the sponsor's USDC account; afterwards the vault balance is re-read and must equal it. Any failure (including
   one raw unit of shortfall) leaves no mandate, no vault and no funds moved.
3. **Reward asset is never client input.** The USDC mint and token program are checked by address against
   `ProtocolConfig`. The sponsor's source account must be USDC owned by the sponsor.
4. **All timing and threshold rules live in `mandate-core`** (`validate_create_mandate`, `build_schedule`), shared with
   the TypeScript domain through the golden vectors. The program returns the highest-priority error (declaration order)
   rather than several. The program test table covers 36 edge cases, including one-second and one-raw-unit
   boundaries and i64 overflow.
5. **Duplicate ids are prevented by the address.** `[b"mandate", sponsor, id]`: reuse fails because the account exists,
   ids are scoped per sponsor, and a cancelled mandate's id stays burned.
6. **Cancellation reading.** The spec says "before a configured cutoff". After the acceptance deadline an unawarded
   mandate can never be awarded, so refusing to refund it would strand the sponsor's own funds; before award no
   provider has committed anything. Cancellation is therefore allowed any time while status is `Bidding` and no bid
   is accepted (the spec text is updated). It is never gated on the pause flag and does not depend on the market
   still being enabled.
7. **Observer set snapshot.** A mandate stores the address of the observer set current at creation. The account is
   derived from `protocol.current_observer_set_version`, so before any set exists no valid address can be supplied
   (the failure is Anchor's `AccountNotInitialized`, not a custom code).
8. **Error ordering caveat.** Anchor runs `init` CPIs before evaluating later fields' constraints, so a wrong token
   program can surface as the token program's own error instead of `InvalidUsdcAccount`. The transaction still fails
   atomically; tests assert that safety property for that case.

## Client

`@mandate/solana` derives every PDA and builds every instruction from the program IDL (account order and
signer/writable flags come from the IDL; the Anchor Borsh coder encodes data). Its tests reproduce, byte for byte, the
PDAs, instruction data and account metas the Rust program generates for all ten instructions
(`packages/solana/vectors/client-vectors.json`, written by `crates/program-tests/tests/client_vectors.rs`). A Rust test
fails if the client's IDL copy drifts from the program build (`pnpm idl:sync`).

## Verification

25 program tests for create/cancel plus the structural guards. Eight deliberate breakages (escrow or refund one raw unit
short, sponsor check removed, pause ignored, accepted-bid guard removed, status guard removed, vault authority changed,
epoch-count check removed) were each caught; the last is masked at program level by a second, independent check and is
caught by the core's golden vectors.

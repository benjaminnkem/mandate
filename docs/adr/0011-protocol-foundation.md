# ADR 0011: Protocol foundation (Prompt 4)

- Status: accepted
- Date: 2026-09-20

## Scope

`initialize_protocol`, two-step admin transfer, new-risk pause, immutable versioned `ObserverSet`, and the approved
`MarketConfig` registry. No mandates, bids, vaults or settlement exist yet, so the admin has no instruction that can
move funds (asserted by `crates/program-tests/tests/structure.rs`, which fails if one appears).

## Decisions

1. **Initialisation is gated to the program's upgrade authority.** Anchor's `ProgramData` constraint ties the caller
   to the upgrade authority, so nobody can front-run initialisation of a freshly deployed program on mainnet. The
   *admin* is an argument, deliberately separate from that deploy key. An immutable program (authority revoked)
   can never be initialised, which is tested.
2. **The reward mint is exact: classic SPL Token, 6 decimals, the configured address.** Token-2022 reward mints are
   refused in v1: their fees, hooks and freezing would put reward accounting at the mercy of the mint. Mainnet USDC
   has a freeze authority held by Circle; a frozen vault is an accepted, disclosed risk.
3. **Observer sets are immutable and strictly sequential.** Version `n+1`'s address is derived from
   `protocol.current_observer_set_version`, so a caller can neither skip nor overwrite a version. Creating a set also
   makes it current, which affects only mandates created afterwards. An observer may not be the admin, be the default
   key, or be duplicated. Creation is allowed while new risk is paused (observer rotation is an incident tool).
4. **New risk only.** Pause blocks creating a market and enabling one. It never blocks disabling, refreshing a review,
   observer-set creation, or (later) claims, refunds, attestation or finalisation, which will not read the flag.
5. **Market binding, and its trust boundary.** The program verifies on chain that the pool is owned by the configured
   DLMM program, is exactly a 904-byte `LbPair` with the right discriminator, and trades exactly the base mint
   against the configured USDC, and it reads the pool's orientation. It reads three fields at fixed offsets taken
   from the official IDL and verified against real mainnet bytes (`crates/mandate-core/tests/meteora.rs`); any
   deviation fails closed. **Not verifiable on chain, hence an off-chain admin control:** that the pool is
   appropriate to pay for (liquidity, PreStocks lifecycle, Token-2022 extensions). That review is pinned by
   `prestocks_metadata_hash`. If Meteora changes the `LbPair` layout, market creation fails closed rather than
   binding the wrong mints.
6. **Bindings never change.** New markets start disabled. A refresh only updates the review hash and timestamp and
   re-checks that pool, mints, token program, decimals and orientation still match.
7. **Added to `ProtocolConfig`:** `dlmm_program` (which program a pool must be owned by, so tests and devnet can point
   elsewhere) and the parameters from ADR 0009. **Added to `MarketConfig`:** `base_is_x`.
8. **Validation lives in `mandate-core`** (`protocol`, `observers`, `meteora`), pure and independently tested, and the
   program calls it.

## Test harness

`crates/program-tests` runs the **compiled SBF binary** inside LiteSVM 0.16 (in-process, no validator), loaded through
the upgradeable loader with a real upgrade authority. Pool data is the real OPENAI/USDC `LbPair`. 55 tests cover
signer and account-substitution attacks, bounds, pause semantics, admin transfer, observer-set immutability and the
market registry. Five deliberate breakages of the program (removing the upgrade-authority check, the pause check on
enabling, the admin check, the pool-mint binding, and duplicate-observer detection) were each caught, and the clean
binary was restored.

Host toolchain: Agave 4.x crates used by LiteSVM need a newer Rust than the Anchor template's 1.89, so the host is
pinned to 1.98.1; the SBF program still builds with Solana's platform-tools rustc (1.95). Crate `rust-version`
therefore stays 1.89.0 except for `program-tests` (1.98.1).

## Not done here

Events are emitted but indexed later (Prompt 11). Sponsor/provider flows begin in Prompt 5.

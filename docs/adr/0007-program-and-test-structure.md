# ADR 0007: Anchor program and Rust test structure

- Status: accepted
- Date: 2026-09-20

## Decision

- `programs/mandate`: the Anchor program (`anchor-lang` 1.2.0, `overflow-checks = true` in release).
- `crates/mandate-core`: a **pure, dependency-free** crate for settlement math (reward split, epoch indexing, compliance predicate, accounting). The program depends on it; TypeScript golden vectors are cross-checked against it (Prompt 2). Keeping it free of Solana types lets it be tested exhaustively and reused by tooling.
- Workspace lints deny `arithmetic_side_effects`, `unwrap_used`, `expect_used`, `panic` and `indexing_slicing`. Settlement code must use checked arithmetic and typed errors. Test modules opt out explicitly.
- Program instruction tests run in-process in **LiteSVM 0.16 executing the compiled SBF binary** (`crates/program-tests`); chosen in Prompt 4 after confirming it builds with Anchor 1.2 crates and loads the real binary through the upgradeable loader (ADR 0011). Fork-level behaviour is tested against Surfpool in Prompt 13.
- The program keypair lives in `.keys/` (gitignored) and is copied to `target/deploy/`. Only the public program id is committed (`Anchor.toml`, `declare_id!`).

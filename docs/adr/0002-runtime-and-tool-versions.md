# ADR 0002: Runtime and tool versions

- Status: accepted
- Date: 2026-09-20 (verified against live sources that day)

| Tool | Version | Source / note |
| --- | --- | --- |
| Node.js | >= 24 (local 24.11.0), `.nvmrc` = 24 | required for native TypeScript execution |
| pnpm | 11.25.0 | `packageManager` field |
| TypeScript | 6.0.3 | see ADR 0001 |
| Rust (host) | 1.98.1 via `rust-toolchain.toml` | LiteSVM 0.16 / Agave 4.x crates need a newer Rust than the Anchor template's 1.89; SBF programs still build with platform-tools' rustc 1.95, so crate `rust-version` stays 1.89.0 (ADR 0011) |
| LiteSVM | 0.16.0 | in-process program tests |
| Solana CLI (Agave) | 4.2.2 | `release.anza.xyz/stable` |
| Anchor CLI / `anchor-lang` | 1.2.0 | current stable; `v2.0.0-rc.1` exists and is deliberately not used |
| Surfpool | 1.6.0 | GitHub release `txtx/surfpool` |
| `@meteora-ag/dlmm` | 1.9.14 | pinned exactly, recorded in every evidence bundle |
| `@solana/web3.js` | 1.99.0 | required by the Meteora SDK (web3.js 1.x) |
| Next.js / React | 16.3.5 / 19.3.0 | |
| Fastify | 5.12.5 | API |
| zod | 4.6.5 | validation |
| pino | 10.3.1 | logging |
| Vitest | 5.0.1 | |

## Client stack decision

The Meteora SDK is built on `@solana/web3.js` 1.x and `@coral-xyz/anchor` 0.31. Observers, scheduler and the SDK-facing packages therefore use web3.js 1.x. `@solana/kit` 8 is current for new applications, but mixing two client generations inside the measurement path adds risk for no benefit. The program client (`packages/solana`) will use the Anchor 1.2 TypeScript client (`@anchor-lang/core`) generated from the IDL. The browser application signs through Wallet Standard and converts to `VersionedTransaction`; that choice is finalised in Prompt 12.

## Consequences

Toolchain bumps are ADR-worthy changes. CI pins the same versions.

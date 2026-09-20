# ADR 0001: Monorepo layout and TypeScript tooling

- Status: accepted
- Date: 2026-09-20

## Context

`docs/TECHNICAL_SPEC.md` section 3 prescribes a pnpm/Turborepo workspace with five apps, eight packages, an Anchor program, infra and scripts. The repository started from the `create-turbo` starter.

## Decision

- **pnpm 11 + Turborepo 2** workspace: `apps/*`, `packages/*`, `scripts`, plus Cargo workspace `programs/*`, `crates/*`.
- **TypeScript 6.0.3, not 7.** The starter pinned 7.0.2, but `typescript-eslint` 8.70 declares `typescript >=4.8.4 <6.1.0` and needs the TypeScript compiler API, which the native 7.x compiler does not provide. Type-aware linting on settlement code is non-negotiable, so we stay on 6.0.3 until typescript-eslint supports 7.
- **No build step for internal libraries.** Packages export `./src/index.ts`; Node 24 runs TypeScript directly (type stripping), so TS files use `.ts` import extensions and `erasableSyntaxOnly`. `tsc --noEmit` is the type gate. Only `apps/web` has a real `build`.
- **Strict compiler flags**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnused*`.
- **ESLint 10 + typescript-eslint `strictTypeChecked`**, with errors kept as errors. The starter's `eslint-plugin-only-warn` was removed: it downgrades every error to a warning, which is the wrong default for financial code. `parseFloat` is banned to discourage float money math.
- **Vitest 5** for unit tests; `--passWithNoTests` while packages are still shells.
- Removed the starter's `packages/ui` and `apps/docs`: neither is in the spec tree.
- Optional native accelerators (`bigint-buffer`, `bufferutil`, `utf-8-validate`) have their install scripts denied (`allowBuilds: false`); pure-JS fallbacks are used. Dependency lifecycle scripts stay off by default.
- All dependency versions are pinned exactly.

## Consequences

Re-evaluate the TypeScript pin when typescript-eslint publishes TS 7 support. `pnpm peers check` reports third-party unmet peers (`@solana/codecs-*` want TS ^5; `ws` wants optional `utf-8-validate`); these are type-only or optional and are tracked in `docs/research/current-docs-lock.md`.

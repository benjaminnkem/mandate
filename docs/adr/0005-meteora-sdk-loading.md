# ADR 0005: Loading the Meteora DLMM SDK

- Status: accepted
- Date: 2026-09-20

## Context

`@meteora-ag/dlmm` 1.9.14 ships a dual CJS/ESM package. Verified behaviour:

1. `import` resolves to `dist/index.mjs`, which **fails under native Node ESM** with `ERR_UNSUPPORTED_DIR_IMPORT` (it imports the directory `@coral-xyz/anchor/dist/cjs/utils/bytes`).
2. The CJS build loads. At runtime `module.exports` **is the `DLMM` class**, with every other export attached as a property. The bundled `.d.ts` instead declares a module object with a `default` member, so `require(...).default` is `undefined` even though the types claim otherwise.

## Decision

`packages/meteora/src/sdk.ts` loads the SDK through `createRequire(import.meta.url)` and exposes `DLMM` (the class, via an explicit documented cast) and `meteoraSdk` (named exports). Nothing else in the repository imports `@meteora-ag/dlmm` directly. A unit test proves the class loads and that the recorded SDK version equals the pinned dependency.

## Consequences

If a future SDK release fixes its ESM entry, revisit this ADR and delete the cast. Measurement code must treat the SDK as the source of quote math (AGENTS.md rule 4) but must not trust its typings blindly.

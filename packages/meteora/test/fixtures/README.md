# Fixtures

`openai-usdc-mainnet.snapshot.json` is a **REAL Solana mainnet-beta snapshot**, not synthetic data.

- Captured 2026-09-20 with `pnpm --filter @mandate/scripts market:measure ... --record`.
- One atomic `getMultipleAccounts` read, so every account is from **one slot** (448786149).
- Contains the real OPENAI/USDC Meteora DLMM pool `4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH`, its
  bin arrays, both mints (Token-2022 OPENAI with its extensions), the Clock sysvar, and real position
  accounts of wallet `2KmmUnQ6nscD7j6siUjZMbDoT1u6jnjfZWF386CcRjak` plus one position owned by another
  wallet and one address that does not exist (used to test attribution rules on real data).

Tests replay it offline through the real SDK, so results depend only on these bytes. The golden values in
`real-state.test.ts` change if and only if the algorithm or the evidence schema changes; that requires a
new `ALGORITHM_VERSION` (docs/TECHNICAL_SPEC.md section 7.7).

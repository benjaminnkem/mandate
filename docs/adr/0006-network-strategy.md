# ADR 0006: Network strategy and provenance

- Status: accepted
- Date: 2026-09-20

## Decision

Four labelled networks, matching `SOLANA_CLUSTER`: `localnet`, `surfpool` (mainnet fork), `devnet`, `mainnet-beta`.

- Program logic is tested on localnet with explicitly labelled test mints (fixtures only).
- Measurement and end-to-end flows are proven on **Surfpool** against real PreStocks mint, USDC and Meteora DLMM state.
- Meteora DLMM is not deployed with real PreStocks pools on devnet; devnet is used only for program-deploy rehearsal.
- A tiny real **mainnet-beta** proof is the last step, after the security checklist (Prompt 15).
- Every API response, UI page, transcript and evidence file names its network. A fork signature is never labelled mainnet. The API `/v1/meta` endpoint already returns the cluster.
- The shared public mainnet RPC is rejected for `mainnet-beta` by config validation; a dedicated provider is required.

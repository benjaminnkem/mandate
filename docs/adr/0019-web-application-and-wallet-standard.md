# ADR 0019: Web application and Wallet Standard integration (Prompt 12)

- Status: accepted
- Date: 2026-09-22

## Decisions

1. **A direct, hand-rolled Wallet Standard integration, not a legacy adapter registry.** `lib/solana/wallet-standard.tsx`
   uses `@wallet-standard/app`'s `getWallets()` directly plus the `standard:connect` / `standard:disconnect` /
   `standard:events` / `solana:signTransaction` / `solana:signAndSendTransaction` feature calls. No wallet name is
   hardcoded: any installed extension that registers itself into the page (per the Wallet Standard's own
   `wallet-standard:app-ready` / `wallet-standard:register-wallet` handshake) is discovered automatically. Signing
   is never anything but a call to the connected wallet's own feature; the app never accepts, stores, or
   constructs a private key or seed phrase, and no UI anywhere has a field for one.
2. **The client stays on `@solana/web3.js` 1.x** (ADR 0002's choice), decoding an API-returned legacy `Transaction`
   and recompiling it into a `VersionedTransaction` against a freshly fetched blockhash immediately before
   signing, so time spent reading the confirmation dialog never eats into the transaction's validity window.
3. **A same-origin RPC proxy (`app/api/rpc/route.ts`) is the only way the browser reaches Solana.** The real
   endpoint (`SOLANA_RPC_HTTP_URL`, possibly a paid/private one) is a server-only environment variable, read
   nowhere else; the browser always calls `/api/rpc`. The proxy allow-lists a fixed set of read/send methods and
   refuses everything else, including unbounded scans like `getProgramAccounts`, so it cannot become an open
   relay. Confirmation is by polling `getSignatureStatuses`/`getBlockHeight` over that same HTTP proxy, not a
   WebSocket subscription, since the proxy is HTTP-only by design.
4. **One financial-write component, `TransactionAction`, is shared by every write flow** (claim, withdraw,
   submit-bid, accept-bid, register-positions, create-mandate). It always shows the exact raw and display USDC
   values and the quoted expiry before asking for a signature, signs only through the connected wallet, and
   reports pending/confirmed/failed/expired strictly from what the chain itself returns — it never renders
   "success" before a confirmed status arrives, and a failed or expired outcome is shown as such, never silently
   upgraded. The dialog cannot be dismissed while a signature is in flight, so a result is never lost from view.
5. **`create_mandate` is built client-side**, not by the API: it is the one write the API's tx-builder endpoints
   don't cover (`docs/adr/0018` deferred it here). The wizard reads the protocol account directly over the RPC
   proxy for its live bounds (budget range, epoch length range, spread/depth/probe ranges, the pause flag, the
   current observer set version) and validates every field against them before a signature is ever requested,
   in addition to the program's own on-chain checks.
6. **Every required surface exists:** landing, approved markets (aggregate pool figures kept visibly separate
   from the accepted provider's own contribution), explore mandates with filters, the create-mandate wizard,
   mandate detail (exact SLA, parties, reward accounting, position set, bids, epoch timeline), a provider
   workspace, the methodology page, and an evidence inspector (attestation agreement, the finalized result, and
   the exact parameters to reproduce the measurement offline).
7. **Critical copy is stated plainly, not implied:** the landing and methodology pages state that Mandate
   measures liquidity/execution quality, not fair value; the three epoch outcomes (Compliant, Non-compliant,
   Unavailable) are each explained and are visually distinguished by shape and text, never color alone; and a
   dedicated section states that PreStocks base mints are Token-2022 assets whose issuer can hold a permanent
   delegate, a transfer fee and a pause switch, grounded in the mainnet evidence recorded in
   `docs/research/current-market.md`.
8. **No mock-data switch exists in the application.** Every page reads the real read API and the real chain
   (through the proxy); nothing branches on an environment flag to show fabricated data. The Playwright suite
   achieves realistic data by intercepting network requests at the browser/test level (`e2e/fixtures.ts`), which
   never touches application code.

## Testing

- Unit tests (`apps/web/test/`) cover the framework-free logic: exact USDC formatting, the API client's error
  handling, and transaction decoding/confirmation-polling state machine.
- Playwright end-to-end tests (`apps/web/e2e/`) run a real Chromium (and, for one spec, a real mobile Safari/
  WebKit profile) against the actual Next.js dev server, with the read/write API and the RPC proxy intercepted
  per test with realistic fixture data, and a Wallet Standard mock wallet injected the same way a real extension
  registers itself. They cover: landing/methodology copy and an axe accessibility scan; the markets, explore and
  provider-workspace pages; the create-mandate wizard's on-chain validation; the claim, withdraw and accept-bid
  write flows end to end including a chain-reported failure case; the evidence inspector's agreement and
  disagreement states; and mobile-viewport layout with a second accessibility scan. This caught two real bugs
  before they shipped: a Next.js dev-only cross-origin block that silently prevented all client-side hydration
  under Playwright's `127.0.0.1` origin (fixed via `allowedDevOrigins`), and a double-indexing mistake in the
  hand-rolled Wallet Standard client that made every `connect()` call throw (fixed in `wallet-standard.tsx`).
- This is a UI-correctness suite, not the fork/mainnet rehearsal: nothing here has run against a live Solana
  RPC, a live indexer/API, or a real wallet extension. That is Prompt 13.

## Known limits

- The RPC proxy has no rate limiting of its own (relies on the API's separate rate limiter for the read/write
  API; the RPC path is unauthenticated same-origin traffic only).
- `close_mandate` has no web UI or API tx-builder yet (also noted in ADR 0018).
- The create-mandate wizard is a single well-labelled form with the confirmation dialog as its final step, not a
  multi-page wizard; given the small number of fields this was judged sufficient without adding a separate
  step framework.
- No live wallet extension (Phantom, Solflare, Backpack, …) has been exercised yet, only the Wallet Standard
  mock; the integration follows the published spec exactly, but a real-extension pass belongs with Prompt 13's
  rehearsal.

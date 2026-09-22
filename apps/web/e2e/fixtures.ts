import { BorshAccountsCoder } from "@anchor-lang/core";
import { findProtocolPda, MANDATE_IDL } from "@mandate/solana";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { Page, Route } from "@playwright/test";
import BN from "bn.js";

/** One fixed identity used as both sponsor and provider across the e2e fixtures, so a single connected mock
 * wallet can exercise every sponsor- and provider-only action in one test session. */
export const WALLET = Keypair.generate();
export const WALLET_ADDRESS = WALLET.publicKey.toBase58();

export const MANDATE_ADDRESS = Keypair.generate().publicKey.toBase58();
export const POOL_ADDRESS = Keypair.generate().publicKey.toBase58();
export const MARKET_ADDRESS = Keypair.generate().publicKey.toBase58();
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BID_ADDRESS = Keypair.generate().publicKey.toBase58();

/**
 * A Wallet Standard mock, injected as a page-context script (no imports — it runs before the app's own code).
 * It registers itself using the exact protocol `@wallet-standard/app` implements (see `getWallets()`'s
 * source): dApps listen for `wallet-standard:register-wallet` and dispatch `wallet-standard:app-ready`, in
 * either order, so a wallet can register whichever loads first. `signAndSendTransaction` never inspects the
 * transaction bytes; it just manufactures a deterministic 64-byte "signature" and lets the test's own
 * `/api/rpc` mock decide what that signature's status resolves to.
 */
function mockWalletScript(address: string, publicKeyBytes: number[]): string {
  return `(() => {
    const account = {
      address: ${JSON.stringify(address)},
      publicKey: new Uint8Array(${JSON.stringify(publicKeyBytes)}),
      chains: ["solana:mainnet", "solana:devnet", "solana:localnet"],
      features: ["solana:signAndSendTransaction", "solana:signTransaction"],
      label: "E2E Test Wallet",
    };
    let sigCounter = 0;
    const wallet = {
      version: "1.0.0",
      name: "E2E Test Wallet",
      icon: "data:image/svg+xml;base64,",
      chains: account.chains,
      accounts: [],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            wallet.accounts = [account];
            return { accounts: wallet.accounts };
          },
        },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: async (...inputs) => {
            return inputs.map(() => {
              sigCounter += 1;
              const sig = new Uint8Array(64);
              sig.set([sigCounter % 256, 1, 2, 3]);
              return { signature: sig };
            });
          },
        },
      },
    };
    // Matches @wallet-standard/app's own two-way handshake exactly: 'wallet-standard:app-ready' carries the
    // API object itself as event.detail, while 'wallet-standard:register-wallet' expects event.detail to BE
    // the callback the app invokes with that API object — not an object wrapping one.
    window.addEventListener("wallet-standard:app-ready", (event) => {
      event.detail.register(wallet);
    });
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
      detail: (api) => { api.register(wallet); },
    }));
  })();`;
}

export async function installMockWallet(page: Page): Promise<void> {
  await page.addInitScript(
    mockWalletScript(WALLET_ADDRESS, Array.from(WALLET.publicKey.toBytes())),
  );
}

const coder = new BorshAccountsCoder(MANDATE_IDL);
type TypeDef = {
  name: string;
  type: { kind: string; fields?: { name: string; type: unknown }[]; variants?: { name: string }[] };
};
const types = (MANDATE_IDL as unknown as { types: TypeDef[] }).types;

function zero(type: unknown): unknown {
  if (typeof type === "string") {
    if (type === "bool") return false;
    if (type === "pubkey") return PublicKey.default;
    if (/^[ui](8|16|32)$/.test(type)) return 0;
    return new BN(0);
  }
  const t = type as { array?: [unknown, number]; defined?: { name: string } };
  if (t.array) return Array.from({ length: t.array[1] }, () => zero(t.array?.[0]));
  if (t.defined) {
    const def = types.find((d) => d.name === t.defined?.name);
    if (!def) throw new Error(`unknown type ${t.defined.name}`);
    if (def.type.kind === "enum") return { [def.type.variants?.[0]?.name ?? ""]: {} };
    return Object.fromEntries((def.type.fields ?? []).map((f) => [f.name, zero(f.type)]));
  }
  throw new Error(`unsupported type ${JSON.stringify(type)}`);
}

/** Base64-encode a program account exactly as `getAccountInfo` would return its `data[0]`. */
export async function encodeAccountBase64(
  name: string,
  over: Record<string, unknown>,
): Promise<string> {
  const buffer = await coder.encode(name, {
    ...(zero({ defined: { name } }) as Record<string, unknown>),
    ...over,
  });
  return buffer.toString("base64");
}

const bn = (n: bigint | number | string): BN => new BN(n.toString());
const key = (b58: string): PublicKey => new PublicKey(b58);

export const PROTOCOL_ADDRESS = findProtocolPda().toBase58();

export async function protocolConfigAccount(over: Record<string, unknown> = {}): Promise<string> {
  return encodeAccountBase64("ProtocolConfig", {
    admin: Keypair.generate().publicKey,
    usdc_mint: key(USDC_MINT),
    usdc_token_program: key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    dlmm_program: key("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
    paused_new_risk: false,
    min_budget_raw: bn(1_000_000),
    max_budget_raw: bn("1000000000000"),
    min_epoch_seconds: bn(60),
    max_epoch_seconds: bn(3600),
    max_duration_seconds: bn(2_592_000),
    max_epochs: 2016,
    max_spread_bps: 20_000,
    max_depth_band_bps: 5_000,
    max_positions: 8,
    min_probe_quote_raw: bn(1_000_000),
    max_probe_quote_raw: bn("1000000000"),
    min_start_lead_seconds: bn(3600),
    position_lock_buffer_seconds: bn(1800),
    min_setup_window_seconds: bn(900),
    unavailable_recovery_seconds: bn(3600),
    current_observer_set_version: 1,
    ...over,
  });
}

const NOW = Math.floor(Date.now() / 1000);
export const START_AT = NOW + 3600;
export const EPOCH_SECONDS = 300;

export function mandateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sponsor: WALLET_ADDRESS,
    mandateId: "7",
    marketConfig: MARKET_ADDRESS,
    observerSet: Keypair.generate().publicKey.toBase58(),
    vault: Keypair.generate().publicKey.toBase58(),
    createdAt: String(NOW),
    biddingEndsAt: String(NOW + 1800),
    startAt: String(START_AT),
    epochSeconds: String(EPOCH_SECONDS),
    totalEpochs: 3,
    endAt: String(START_AT + 3 * EPOCH_SECONDS),
    acceptanceCutoff: String(NOW + 1200),
    positionLockAt: String(START_AT - 600),
    algorithmVersion: 1,
    unavailableRecoverySeconds: "3600",
    maxRewardRaw: "1000000000",
    acceptedRewardRaw: "900000000",
    baseEpochRewardRaw: "300000000",
    finalEpochExtraRaw: "0",
    maxEffectiveSpreadBps: 400,
    depthBandBps: 500,
    minPoolBuyDepthQuoteRaw: "5000000000",
    minPoolSellDepthQuoteRaw: "5000000000",
    minProviderQuoteInBandRaw: "2000000000",
    minProviderBaseQuoteEqInBandRaw: "2000000000",
    probeQuoteRaw: "10000000",
    acceptedBid: BID_ADDRESS,
    provider: WALLET_ADDRESS,
    positionSet: PublicKey.default.toBase58(),
    compliantEpochs: 1,
    noncompliantEpochs: 0,
    unavailableEpochs: 0,
    finalizedEpochs: 1,
    earnedRewardRaw: "300000000",
    forfeitedRewardRaw: "0",
    claimedRewardRaw: "100000000",
    sponsorWithdrawnRaw: "50000000",
    status: "Active",
    ...over,
  };
}

export function mandateAccounting(over: Record<string, unknown> = {}): Record<string, unknown> {
  const pair = (raw: string) => ({ raw, usdc: (Number(raw) / 1e6).toFixed(6) });
  return {
    deposited: pair("1000000000"),
    accepted: pair("900000000"),
    earned: pair("300000000"),
    forfeited: pair("0"),
    unresolved: pair("600000000"),
    claimed: pair("100000000"),
    claimableByProvider: pair("200000000"),
    sponsorWithdrawn: pair("50000000"),
    withdrawableBySponsor: pair("50000000"),
    expectedVault: pair("850000000"),
    ...over,
  };
}

const hex32 = (b: number): string => b.toString(16).padStart(2, "0").repeat(32);

export interface AttestationRow {
  readonly address: string;
  readonly asOfSlot: string;
  readonly account: {
    readonly mandate: string;
    readonly epochIndex: number;
    readonly observer: string;
    readonly observedSlot: string;
    readonly observedUnixTs: string;
    readonly algorithmVersion: number;
    readonly positionSet: string;
    readonly payloadHash: string;
    readonly evidenceHash: string;
    readonly metrics: {
      readonly effectiveSpreadBps: number;
      readonly poolBuyDepthQuoteRaw: string;
      readonly poolSellDepthQuoteRaw: string;
      readonly providerQuoteInBandRaw: string;
      readonly providerBaseQuoteEqInBandRaw: string;
    };
    readonly createdAt: string;
  };
}

export function attestationRow(observer: string, byte: number, epochIndex = 0): AttestationRow {
  return {
    address: Keypair.generate().publicKey.toBase58(),
    asOfSlot: "1000",
    account: {
      mandate: MANDATE_ADDRESS,
      epochIndex,
      observer,
      observedSlot: "448786149",
      observedUnixTs: String(START_AT + EPOCH_SECONDS - 5),
      algorithmVersion: 1,
      positionSet: PublicKey.default.toBase58(),
      payloadHash: hex32(byte),
      evidenceHash: hex32(byte + 1),
      metrics: {
        effectiveSpreadBps: 251,
        poolBuyDepthQuoteRaw: "63491020966",
        poolSellDepthQuoteRaw: "49065543907",
        providerQuoteInBandRaw: "91107867",
        providerBaseQuoteEqInBandRaw: "81314309",
      },
      createdAt: String(START_AT + EPOCH_SECONDS),
    },
  };
}

/** A real, serializable-but-harmless unsigned legacy transaction, as a `POST /v1/tx/*` response would carry
 * it: a single SystemProgram transfer of 0 lamports, so it decodes and re-compiles like the real thing. */
export function sampleTxBase64(feePayer: string): string {
  const payerKey = new PublicKey(feePayer);
  const tx = new Transaction({
    feePayer: payerKey,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1_000,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payerKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 0,
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

export function txBundle(
  feePayer: string,
  summary: Record<string, unknown>,
): Record<string, unknown> {
  return {
    transaction: sampleTxBase64(feePayer),
    encoding: "base64-legacy-transaction-unsigned",
    signer: feePayer,
    expiresAfterBlockHeight: 999_999,
    network: { cluster: "surfpool", programId: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc" },
    summary,
    notice: "Review before signing.",
  };
}

export function envelope<T>(data: T): { data: T; meta: Record<string, unknown> } {
  return {
    data,
    meta: {
      cluster: "surfpool",
      programId: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc",
      indexedSlot: "1000",
      indexedAt: new Date().toISOString(),
      staleSeconds: 2,
      stale: false,
      source: "indexed-chain-state",
    },
  };
}

/** Register JSON GET responses for exact `/mocked-api/...` paths (matched by prefix + query-agnostic path). */
export async function mockApiRoutes(page: Page, routes: Record<string, unknown>): Promise<void> {
  await page.route("**/mocked-api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/mocked-api/, "");
    const body = routes[path];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        body: JSON.stringify({ error: { code: "not_mocked", message: path } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** Register a POST responder for `/api/rpc`, keyed by JSON-RPC method. `accountsByAddress` answers
 * `getAccountInfo`/`getMultipleAccounts` with a base64 account or `null`. */
export async function mockChainRpc(
  page: Page,
  options: {
    accountsByAddress?: Record<string, string>;
    signatureStatus?: "confirmed" | "failed" | "pending";
  } = {},
): Promise<void> {
  let blockHeight = 100;
  await page.route("**/api/rpc", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      id: unknown;
      method: string;
      params?: unknown[];
    };
    const ok = (result: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      });
    switch (body.method) {
      case "getLatestBlockhash":
        return ok({
          context: { slot: 1 },
          value: {
            blockhash: Keypair.generate().publicKey.toBase58(),
            lastValidBlockHeight: blockHeight + 150,
          },
        });
      case "getBlockHeight":
        blockHeight += 1;
        return ok(blockHeight);
      case "getAccountInfo": {
        const address = (body.params?.[0] as string | undefined) ?? "";
        const data = options.accountsByAddress?.[address];
        return ok(
          data
            ? {
                context: { slot: 1 },
                value: {
                  data: [data, "base64"],
                  owner: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc",
                  lamports: 1,
                  executable: false,
                  rentEpoch: 0,
                },
              }
            : { context: { slot: 1 }, value: null },
        );
      }
      case "getMultipleAccounts": {
        const addresses = (body.params?.[0] as string[] | undefined) ?? [];
        const values = addresses.map((a) => {
          const data = options.accountsByAddress?.[a];
          return data
            ? {
                data: [data, "base64"],
                owner: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc",
                lamports: 1,
                executable: false,
                rentEpoch: 0,
              }
            : null;
        });
        return ok({ context: { slot: 1 }, value: values });
      }
      case "sendTransaction":
        return ok("5".padEnd(88, "1"));
      case "getSignatureStatuses": {
        const status = options.signatureStatus ?? "confirmed";
        if (status === "pending") return ok({ context: { slot: 1 }, value: [null] });
        return ok({
          context: { slot: 1 },
          value: [
            {
              slot: 1,
              confirmations: 1,
              err: status === "failed" ? { InstructionError: [0, "Custom"] } : null,
              confirmationStatus: "confirmed",
            },
          ],
        });
      }
      default:
        return ok(null);
    }
  });
}

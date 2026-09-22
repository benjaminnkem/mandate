"use client";

/**
 * A minimal, direct integration of the Wallet Standard (https://github.com/wallet-standard/wallet-standard) — no
 * legacy adapter registry, just `@wallet-standard/app`'s wallet directory plus the `solana:*` feature calls. Any
 * installed wallet extension registers itself into `window.navigator.wallets`; this module only ever discovers
 * and calls into wallets that way. It never accepts, stores, or asks for a private key or seed phrase — signing
 * happens exclusively through a wallet's own `solana:signTransaction` / `solana:signAndSendTransaction` feature.
 */
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, StandardDisconnect, StandardEvents } from "@wallet-standard/features";
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
  StandardEventsFeature,
} from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import bs58 from "bs58";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { chainIdentifier, env } from "../env.ts";
import { compileVersioned, type UnsignedBundle } from "./transactions.ts";
import { getConnection } from "./connection.ts";

// F is the caller's stated expectation of one named feature's shape; `Wallet.features` itself is untyped.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function feature<F>(wallet: Wallet, name: string): F | undefined {
  const features = wallet.features as Record<string, unknown>;
  return name in features ? (features[name] as F) : undefined;
}

// The *Feature types nest one level (`{ "standard:connect": { version, connect } }`) so they can be unioned
// into `Wallet['features']`, but `wallet.features["standard:connect"]` at runtime IS that inner `{version,
// connect}` object already. These aliases name the inner shape so `feature()` returns what's really there.
type Connect = StandardConnectFeature[typeof StandardConnect];
type Disconnect = StandardDisconnectFeature[typeof StandardDisconnect];
type Events = StandardEventsFeature[typeof StandardEvents];
type SendAndSign = SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction];
type Sign = SolanaSignTransactionFeature[typeof SolanaSignTransaction];

/** A wallet is a candidate here only if it can connect and can sign a Solana transaction one way or the other. */
function isSolanaWallet(wallet: Wallet): boolean {
  const canConnect = Boolean(feature<Connect>(wallet, StandardConnect));
  const canSign =
    Boolean(feature<SendAndSign>(wallet, SolanaSignAndSendTransaction)) ||
    Boolean(feature<Sign>(wallet, SolanaSignTransaction));
  return canConnect && canSign;
}

const STORAGE_KEY = "mandate:selected-wallet";

/** Best-effort, per-browser convenience: which wallet to silently reconnect to on the next visit. Never required
 * state — if it throws (private browsing, blocked storage) the app just asks the person to connect again. */
function readRememberedWallet(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function rememberWallet(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(STORAGE_KEY, name);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored: nothing depends on this succeeding
  }
}

export interface SendResult {
  readonly signature: string;
  readonly lastValidBlockHeight: number;
}

interface WalletContextValue {
  readonly wallets: readonly Wallet[];
  readonly account: WalletAccount | null;
  readonly walletName: string | null;
  readonly connecting: boolean;
  readonly error: string | null;
  connect: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Compile the bundle against a fresh blockhash, have the connected wallet sign (and where supported, send)
   * it, and return the signature. The caller polls for confirmation — this never claims success itself. */
  signAndSend: (bundle: UnsignedBundle) => Promise<SendResult>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selected, setSelected] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const registry = getWallets();
    // Populating the wallet list from the registry the first time this mounts synchronizes with an external
    // system (window.navigator.wallets), which is exactly what an effect is for here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWallets(registry.get().filter(isSolanaWallet));
    const offRegister = registry.on("register", () => {
      setWallets(registry.get().filter(isSolanaWallet));
    });
    const offUnregister = registry.on("unregister", (...unregistered) => {
      setWallets(registry.get().filter(isSolanaWallet));
      if (unregistered.some((w) => w === selected)) {
        setSelected(null);
        setAccount(null);
      }
    });
    return () => {
      offRegister();
      offUnregister();
    };
    // Re-subscribing per render would drop the closure over `selected`; the effect intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async (name: string) => {
    const wallet = getWallets()
      .get()
      .find((w) => w.name === name);
    if (!wallet) {
      setError(`Wallet "${name}" is no longer available.`);
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const connectFeature = feature<Connect>(wallet, StandardConnect);
      if (!connectFeature) throw new Error(`${name} does not support connecting.`);
      const { accounts } = await connectFeature.connect();
      const first = accounts[0];
      if (!first) throw new Error(`${name} did not authorize any account.`);
      setSelected(wallet);
      setAccount(first);
      rememberWallet(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not connect to ${name}.`);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (selected) {
      const disconnectFeature = feature<Disconnect>(selected, StandardDisconnect);
      try {
        await disconnectFeature?.disconnect();
      } catch {
        // The wallet's own cleanup failing does not stop us from forgetting it here.
      }
    }
    setSelected(null);
    setAccount(null);
    rememberWallet(null);
  }, [selected]);

  // Silent reconnect to a remembered wallet once it appears in the registry.
  useEffect(() => {
    if (selected) return;
    const remembered = readRememberedWallet();
    if (!remembered) return;
    const wallet = wallets.find((w) => w.name === remembered);
    if (!wallet) return;
    const connectFeature = feature<Connect>(wallet, StandardConnect);
    if (!connectFeature) return;
    connectFeature
      .connect({ silent: true })
      .then(({ accounts }) => {
        const first = accounts[0];
        if (first) {
          setSelected(wallet);
          setAccount(first);
        }
      })
      .catch(() => {
        // A silent reconnect that the wallet refuses just means the person connects again by hand.
      });
  }, [wallets, selected]);

  // React to the wallet changing its own account list (switched account, or revoked authorization).
  useEffect(() => {
    if (!selected) return;
    const events = feature<Events>(selected, StandardEvents);
    if (!events) return;
    return events.on("change", (properties) => {
      if (!properties.accounts) return;
      const next = properties.accounts[0] ?? null;
      setAccount(next);
      if (!next) setSelected(null);
    });
  }, [selected]);

  const signAndSend = useCallback(
    async (bundle: UnsignedBundle): Promise<SendResult> => {
      if (!selected || !account) throw new Error("Connect a wallet first.");
      const connection = getConnection();
      const { transaction, lastValidBlockHeight } = await compileVersioned(connection, bundle);
      const wireBytes = transaction.serialize();
      const chain = chainIdentifier(env.cluster);

      const sendFeature = feature<SendAndSign>(selected, SolanaSignAndSendTransaction);
      if (sendFeature) {
        const [output] = await sendFeature.signAndSendTransaction({
          account,
          transaction: wireBytes,
          chain,
        });
        if (!output) throw new Error("The wallet returned no result for signAndSendTransaction.");
        return { signature: bs58.encode(output.signature), lastValidBlockHeight };
      }

      const signFeature = feature<Sign>(selected, SolanaSignTransaction);
      if (signFeature) {
        const [output] = await signFeature.signTransaction({
          account,
          transaction: wireBytes,
          chain,
        });
        if (!output) throw new Error("The wallet returned no result for signTransaction.");
        const signature = await connection.sendRawTransaction(output.signedTransaction, {
          skipPreflight: false,
        });
        return { signature, lastValidBlockHeight };
      }

      throw new Error("This wallet does not support signing Solana transactions.");
    },
    [selected, account],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      account,
      walletName: selected?.name ?? null,
      connecting,
      error,
      connect,
      disconnect,
      signAndSend,
    }),
    [wallets, account, selected, connecting, error, connect, disconnect, signAndSend],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet() must be used inside <WalletProvider>.");
  return value;
}

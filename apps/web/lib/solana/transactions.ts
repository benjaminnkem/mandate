import {
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { TxBundle } from "../types.ts";

/** What the wallet ends up signing, built either from the API's unsigned transaction or a local instruction. */
export interface UnsignedBundle {
  readonly feePayer: PublicKey;
  readonly instructions: readonly TransactionInstruction[];
}

/** Decode a `POST /v1/tx/*` response's base64 legacy transaction into fee payer and instructions. */
export function bundleFromApiTransaction(base64: string, feePayer: string): UnsignedBundle {
  const legacy = Transaction.from(Buffer.from(base64, "base64"));
  return { feePayer: new PublicKey(feePayer), instructions: legacy.instructions };
}

/** What a confirmation dialog needs: the bundle to sign, its exact economic summary, and how long the API's
 * quoted blockhash was good for. Shared by every write flow, whether the transaction came from the API or was
 * built locally (the create-mandate wizard). */
export interface PreparedTransaction {
  readonly bundle: UnsignedBundle;
  readonly summary: Record<string, unknown>;
  readonly expiresAfterBlockHeight?: number;
}

/** Turn a `POST /v1/tx/*` response into a `PreparedTransaction`. */
export function preparedFromApiBundle(tx: TxBundle): PreparedTransaction {
  return {
    bundle: bundleFromApiTransaction(tx.transaction, tx.signer),
    summary: tx.summary,
    expiresAfterBlockHeight: tx.expiresAfterBlockHeight,
  };
}

export interface CompiledTransaction {
  readonly transaction: VersionedTransaction;
  readonly lastValidBlockHeight: number;
}

/**
 * Compile a bundle into a `VersionedTransaction` against a FRESH blockhash fetched right now, so the tens of
 * seconds a person spends reading the confirmation dialog never eats into the transaction's validity window.
 */
export async function compileVersioned(
  connection: Connection,
  bundle: UnsignedBundle,
): Promise<CompiledTransaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: bundle.feePayer,
    recentBlockhash: blockhash,
    instructions: [...bundle.instructions],
  }).compileToV0Message();
  return { transaction: new VersionedTransaction(message), lastValidBlockHeight };
}

export type ConfirmOutcome =
  | { readonly status: "confirmed" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "expired" };

/**
 * Poll for a signature's outcome by HTTP (no websocket subscription — see `./connection.ts`), stopping the
 * moment the chain confirms, fails, or the blockhash's last valid block height passes. Never returns
 * "confirmed" before the RPC itself reports the transaction as processed with no error.
 */
export async function pollForConfirmation(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  options: { intervalMs?: number; onTick?: (blockHeight: number) => void } = {},
): Promise<ConfirmOutcome> {
  const intervalMs = options.intervalMs ?? 1500;
  for (;;) {
    const [statuses, blockHeight] = await Promise.all([
      connection.getSignatureStatuses([signature]),
      connection.getBlockHeight("confirmed"),
    ]);
    options.onTick?.(blockHeight);
    const status = statuses.value[0];
    if (status) {
      if (status.err) return { status: "failed", reason: JSON.stringify(status.err) };
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return { status: "confirmed" };
      }
    }
    if (blockHeight > lastValidBlockHeight) return { status: "expired" };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

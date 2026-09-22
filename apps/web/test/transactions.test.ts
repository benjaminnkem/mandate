import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  bundleFromApiTransaction,
  pollForConfirmation,
  preparedFromApiBundle,
  type ConfirmOutcome,
} from "../lib/solana/transactions.ts";
import type { TxBundle } from "../lib/types.ts";

function sampleBase64Transaction(feePayer: string): string {
  const payerKey = new PublicKey(feePayer);
  const tx = new Transaction({
    feePayer: payerKey,
    // Any real 32-byte base58 value works for serialization; it never touches the network in this test.
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1_000,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payerKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

describe("bundleFromApiTransaction", () => {
  it("decodes the API's base64 legacy transaction back into a fee payer and its instructions", () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const bundle = bundleFromApiTransaction(sampleBase64Transaction(payer), payer);
    expect(bundle.feePayer.toBase58()).toBe(payer);
    expect(bundle.instructions).toHaveLength(1);
    expect(bundle.instructions[0]?.programId.toBase58()).toBe(SystemProgram.programId.toBase58());
  });
});

describe("preparedFromApiBundle", () => {
  it("carries the summary and expiry straight through, only decoding the transaction", () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const tx: TxBundle = {
      transaction: sampleBase64Transaction(payer),
      encoding: "base64-legacy-transaction-unsigned",
      signer: payer,
      expiresAfterBlockHeight: 4242,
      network: { cluster: "surfpool", programId: "T2GzQeoAYprQyUorm7r6jaRvmoPhtXuZ6vJYYBS1pzc" },
      summary: { action: "Claim" },
      notice: "test",
    };
    const prepared = preparedFromApiBundle(tx);
    expect(prepared.summary).toEqual({ action: "Claim" });
    expect(prepared.expiresAfterBlockHeight).toBe(4242);
    expect(prepared.bundle.feePayer.toBase58()).toBe(payer);
  });
});

/** Just the two RPC calls `pollForConfirmation` actually uses. */
function fakeConnection(
  statuses: readonly (null | { err: unknown; confirmationStatus?: string })[],
  blockHeights: readonly number[],
): Connection {
  let call = 0;
  return {
    getSignatureStatuses: () => {
      const status = statuses[Math.min(call, statuses.length - 1)];
      return Promise.resolve({ context: { slot: 1 }, value: [status] });
    },
    getBlockHeight: () => {
      const height = blockHeights[Math.min(call, blockHeights.length - 1)];
      call += 1;
      return Promise.resolve(height ?? 0);
    },
  } as unknown as Connection;
}

describe("pollForConfirmation", () => {
  const SIG = "5" + "1".repeat(87);

  it("reports confirmed the moment the RPC says so, with no error", async () => {
    const connection = fakeConnection([{ err: null, confirmationStatus: "confirmed" }], [100]);
    const outcome: ConfirmOutcome = await pollForConfirmation(connection, SIG, 200, {
      intervalMs: 0,
    });
    expect(outcome).toEqual({ status: "confirmed" });
  });

  it("reports failed with the chain's own error, never a generic message", async () => {
    const connection = fakeConnection([{ err: { InstructionError: [0, "Custom"] } }], [100]);
    const outcome = await pollForConfirmation(connection, SIG, 200, { intervalMs: 0 });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toContain("InstructionError");
  });

  it("reports expired once the block height passes lastValidBlockHeight with no status yet", async () => {
    const connection = fakeConnection([null], [201]);
    const outcome = await pollForConfirmation(connection, SIG, 200, { intervalMs: 0 });
    expect(outcome).toEqual({ status: "expired" });
  });

  it("keeps polling while pending, and only resolves once a terminal state appears", async () => {
    const connection = fakeConnection(
      [
        null,
        { err: null, confirmationStatus: "processed" },
        { err: null, confirmationStatus: "confirmed" },
      ],
      [50, 60, 70],
    );
    const ticks: number[] = [];
    const outcome = await pollForConfirmation(connection, SIG, 200, {
      intervalMs: 0,
      onTick: (h) => ticks.push(h),
    });
    expect(outcome).toEqual({ status: "confirmed" });
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });
});

import { readFileSync, statSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { ObserverConfigError } from "./errors.ts";

/**
 * Load the ONE observer key this process signs with. The file is a Solana CLI keypair (a JSON array of 64 bytes).
 * The derived public key must equal `OBSERVER_EXPECTED_PUBKEY`, so a swapped or mis-mounted file fails at startup
 * instead of signing as the wrong identity. Secret bytes are never logged or returned outside the Keypair.
 */
export function loadObserverKeypair(path: string, expectedPubkey: string): Keypair {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new ObserverConfigError(`observer keypair file not found at ${path}`);
  }
  // Group/other permission bits on a secret key file are a misconfiguration worth stopping for.
  if ((mode & 0o077) !== 0) {
    throw new ObserverConfigError(
      `observer keypair ${path} is readable by other users; run chmod 600 on it`,
    );
  }
  let keypair: Keypair;
  try {
    const secret = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      secret.some((b) => !Number.isInteger(b) || (b as number) < 0 || (b as number) > 255)
    ) {
      throw new Error("not a 64-byte array");
    }
    keypair = Keypair.fromSecretKey(Uint8Array.from(secret as number[]));
  } catch {
    throw new ObserverConfigError(`observer keypair at ${path} is not a valid Solana keypair file`);
  }
  if (keypair.publicKey.toBase58() !== expectedPubkey) {
    throw new ObserverConfigError(
      `observer keypair public key ${keypair.publicKey.toBase58()} does not match OBSERVER_EXPECTED_PUBKEY ${expectedPubkey}`,
    );
  }
  return keypair;
}

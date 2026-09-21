import { readFileSync, statSync } from "node:fs";

import {
  decodeAccount,
  findAttestationPda,
  findEpochResultPda,
  setObservers,
  type EpochAttestationAccount,
  type MandateAccount,
  type ObserverSetAccount,
} from "@mandate/solana";
import type { Connection } from "@solana/web3.js";
import {
  Keypair,
  Transaction,
  type Commitment,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { FinalizePorts } from "./finalize.ts";

/**
 * Load the optional relayer key. It only pays transaction fees: it holds no protocol authority (finalization is
 * permissionless), so losing it costs at most its small SOL balance. The file must not be readable by others.
 */
export function loadRelayerKeypair(path: string): Keypair {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0)
    throw new Error(
      `relayer key file ${path} must not be readable by group/others (mode ${mode.toString(8)})`,
    );
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function createFinalizePorts(
  connection: Connection,
  relayer: Keypair,
  commitment: Commitment,
): FinalizePorts {
  return {
    payer: relayer.publicKey,
    now: () => new Date(),
    async loadMandate(mandate) {
      const info = await connection.getAccountInfo(mandate, commitment);
      return info ? decodeAccount<MandateAccount>("Mandate", info.data) : null;
    },
    async loadObserverSet(address) {
      const info = await connection.getAccountInfo(address, commitment);
      if (!info) throw new Error(`observer set ${address.toBase58()} not found`);
      const set = decodeAccount<ObserverSetAccount>("ObserverSet", info.data);
      return { observers: setObservers(set), threshold: set.threshold };
    },
    async epochResultExists(mandate, epoch) {
      return (
        (await connection.getAccountInfo(findEpochResultPda(mandate, epoch), commitment)) !== null
      );
    },
    async loadAttestations(mandate, epoch, observers) {
      const keys = observers.map((o) => findAttestationPda(mandate, epoch, o));
      const infos = await connection.getMultipleAccountsInfo(keys, commitment);
      const out = new Map<string, EpochAttestationAccount>();
      infos.forEach((info, i) => {
        const observer = observers[i];
        if (info && observer)
          out.set(
            observer.toBase58(),
            decodeAccount<EpochAttestationAccount>("EpochAttestation", info.data),
          );
      });
      return out;
    },
    async submit(ix: TransactionInstruction) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
      const tx = new Transaction({
        feePayer: relayer.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);
      tx.sign(relayer);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: commitment,
      });
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment,
      );
      if (result.value.err)
        throw new Error(`transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
      return signature;
    },
  };
}

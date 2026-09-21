import type { Connection } from "@solana/web3.js";
import { PublicKey, type Commitment, type Finality } from "@solana/web3.js";

export interface ChainAccount {
  readonly address: string;
  readonly data: Uint8Array;
}

export interface SignatureInfo {
  readonly signature: string;
  readonly slot: bigint;
  readonly blockTime: number | null;
  readonly failed: boolean;
}

export interface TransactionLogs {
  readonly slot: bigint;
  readonly blockTime: number | null;
  readonly logs: readonly string[];
}

/**
 * Everything the indexer needs from the chain, behind one interface: the real implementation uses JSON-RPC, tests
 * use an in-memory chain that behaves the same way. Every read reports the slot it was made at.
 */
export interface ChainReader {
  getSlot(): Promise<bigint>;
  /** All program-owned accounts at one slot. */
  getProgramAccounts(): Promise<{ slot: bigint; accounts: ChainAccount[] }>;
  getAccounts(
    addresses: readonly string[],
  ): Promise<{ slot: bigint; accounts: (ChainAccount | null)[] }>;
  /** Newest first, stopping before `until` (exclusive). */
  getSignatures(options: {
    until?: string;
    before?: string;
    limit: number;
  }): Promise<SignatureInfo[]>;
  getTransactionLogs(signature: string): Promise<TransactionLogs | null>;
  /** Token balance of a token account, or `null` if the account does not exist. */
  getTokenBalance(address: string): Promise<{ slot: bigint; amount: bigint } | null>;
}

export function createRpcChainReader(
  connection: Connection,
  programId: PublicKey,
  commitment: Commitment,
): ChainReader {
  const finality: Finality = commitment === "finalized" ? "finalized" : "confirmed";
  return {
    async getSlot() {
      return BigInt(await connection.getSlot(commitment));
    },
    async getProgramAccounts() {
      const result = await connection.getProgramAccounts(programId, {
        commitment,
        withContext: true,
      });
      return {
        slot: BigInt(result.context.slot),
        accounts: result.value.map((a) => ({ address: a.pubkey.toBase58(), data: a.account.data })),
      };
    },
    async getAccounts(addresses) {
      const keys = addresses.map((a) => new PublicKey(a));
      const out: (ChainAccount | null)[] = [];
      let slot = 0n;
      for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        const r = await connection.getMultipleAccountsInfoAndContext(chunk, { commitment });
        slot = BigInt(r.context.slot);
        r.value.forEach((info, j) => {
          const key = chunk[j];
          out.push(info && key ? { address: key.toBase58(), data: info.data } : null);
        });
      }
      return { slot, accounts: out };
    },
    async getSignatures({ until, before, limit }) {
      const list = await connection.getSignaturesForAddress(
        programId,
        { limit, ...(until ? { until } : {}), ...(before ? { before } : {}) },
        finality,
      );
      return list.map((s) => ({
        signature: s.signature,
        slot: BigInt(s.slot),
        blockTime: s.blockTime ?? null,
        failed: s.err !== null,
      }));
    },
    async getTransactionLogs(signature) {
      const tx = await connection.getTransaction(signature, {
        commitment: finality,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta) return null;
      return {
        slot: BigInt(tx.slot),
        blockTime: tx.blockTime ?? null,
        logs: tx.meta.logMessages ?? [],
      };
    },
    async getTokenBalance(address) {
      const key = new PublicKey(address);
      const info = await connection.getAccountInfoAndContext(key, { commitment });
      if (!info.value) return null;
      const balance = await connection.getTokenAccountBalance(key, commitment);
      return { slot: BigInt(info.context.slot), amount: BigInt(balance.value.amount) };
    },
  };
}

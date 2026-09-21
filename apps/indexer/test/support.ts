import { BorshAccountsCoder } from "@anchor-lang/core";
import { MANDATE_IDL, MANDATE_PROGRAM_ID, findVaultPda } from "@mandate/solana";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { ChainAccount, ChainReader, SignatureInfo, TransactionLogs } from "../src/chain.ts";

const coder = new BorshAccountsCoder(MANDATE_IDL);
interface TypeDef {
  name: string;
  type: { kind: string; fields?: { name: string; type: unknown }[]; variants?: { name: string }[] };
}
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

/** Encode a program account exactly as the chain would store it. Unspecified fields are zero. */
export function encodeAccount(name: string, over: Record<string, unknown>): Promise<Buffer> {
  return coder.encode(name, {
    ...(zero({ defined: { name } }) as Record<string, unknown>),
    ...over,
  });
}

export const key = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));
export const bn = (n: bigint | number): BN => new BN(n.toString());

export function mandateFields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sponsor: key(1),
    mandate_id: bn(1),
    market_config: key(2),
    observer_set: key(3),
    vault: key(4),
    start_at: bn(1_000_000),
    end_at: bn(1_000_000 + 3 * 300),
    epoch_seconds: bn(300),
    total_epochs: 3,
    algorithm_version: 1,
    unavailable_recovery_seconds: bn(3600),
    max_reward_raw: bn(130),
    accepted_reward_raw: bn(100),
    provider: key(9),
    status: { Active: {} },
    ...over,
  };
}

/** Event bytes as they appear in a `Program data:` log line. */
export function eventLog(name: string, body: Buffer): string {
  const event = (MANDATE_IDL.events ?? []).find((e) => e.name === name);
  if (!event) throw new Error(`no event ${name}`);
  return `Program data: ${Buffer.concat([Buffer.from(event.discriminator), body]).toString("base64")}`;
}

export const u64 = (n: bigint | number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

/** ProviderRewardClaimed { mandate, provider, amount_raw, total_claimed_raw, vault_balance_raw } */
export function claimedEvent(
  mandate: PublicKey,
  provider: PublicKey,
  amount: bigint,
  total: bigint,
  vault: bigint,
): string {
  return eventLog(
    "ProviderRewardClaimed",
    Buffer.concat([mandate.toBuffer(), provider.toBuffer(), u64(amount), u64(total), u64(vault)]),
  );
}

/** An in-memory chain. Slots advance only when tests say so, so ordering scenarios are exact. */
export class MemoryChain implements ChainReader {
  slot = 100n;
  readonly accounts = new Map<string, Uint8Array>();
  readonly tokens = new Map<string, bigint>();
  /** Oldest first. */
  readonly txs: (SignatureInfo & { logs: string[] })[] = [];
  failLogsFor = new Set<string>();
  reads = { programAccounts: 0, accounts: 0 };

  set(address: PublicKey, data: Uint8Array): void {
    this.accounts.set(address.toBase58(), data);
  }

  addTx(signature: string, logs: string[], failed = false): void {
    this.slot += 1n;
    this.txs.push({
      signature,
      slot: this.slot,
      blockTime: 1_700_000_000 + Number(this.slot),
      failed,
      logs,
    });
  }

  getSlot(): Promise<bigint> {
    return Promise.resolve(this.slot);
  }
  getProgramAccounts(): Promise<{ slot: bigint; accounts: ChainAccount[] }> {
    this.reads.programAccounts += 1;
    return Promise.resolve({
      slot: this.slot,
      accounts: [...this.accounts].map(([address, data]) => ({ address, data })),
    });
  }
  getAccounts(
    addresses: readonly string[],
  ): Promise<{ slot: bigint; accounts: (ChainAccount | null)[] }> {
    this.reads.accounts += addresses.length;
    return Promise.resolve({
      slot: this.slot,
      accounts: addresses.map((a) => {
        const data = this.accounts.get(a);
        return data ? { address: a, data } : null;
      }),
    });
  }
  getSignatures(o: { until?: string; before?: string; limit: number }): Promise<SignatureInfo[]> {
    let list = [...this.txs].reverse();
    if (o.before) list = list.slice(list.findIndex((t) => t.signature === o.before) + 1);
    if (o.until) {
      const i = list.findIndex((t) => t.signature === o.until);
      if (i >= 0) list = list.slice(0, i);
    }
    return Promise.resolve(list.slice(0, o.limit));
  }
  getTransactionLogs(signature: string): Promise<TransactionLogs | null> {
    if (this.failLogsFor.has(signature)) return Promise.reject(new Error("rpc unavailable"));
    const tx = this.txs.find((t) => t.signature === signature);
    return Promise.resolve(tx ? { slot: tx.slot, blockTime: tx.blockTime, logs: tx.logs } : null);
  }
  getTokenBalance(address: string): Promise<{ slot: bigint; amount: bigint } | null> {
    const amount = this.tokens.get(address);
    return Promise.resolve(amount === undefined ? null : { slot: this.slot, amount });
  }
}

export const programLog = (...lines: string[]): string[] => [
  `Program ${MANDATE_PROGRAM_ID.toBase58()} invoke [1]`,
  ...lines,
  `Program ${MANDATE_PROGRAM_ID.toBase58()} success`,
];

export const vaultOf = (mandate: PublicKey): string => findVaultPda(mandate).toBase58();

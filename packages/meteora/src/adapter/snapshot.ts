import {
  Connection,
  PublicKey,
  type AccountInfo,
  type Commitment,
  type RpcResponseAndContext,
} from "@solana/web3.js";

import { sha256Hex } from "../hash.ts";

/** One account exactly as read from an RPC node. `null` records a confirmed-missing account. */
export interface SnapshotAccount {
  readonly owner: string;
  readonly lamports: string;
  readonly executable: boolean;
  readonly rentEpoch: string;
  readonly dataBase64: string;
}

export interface SnapshotCall {
  readonly method: string;
  readonly contextSlot: number;
  readonly addresses: readonly string[];
}

/**
 * Every account an observation read, with the slot each read was served at. Replaying a snapshot
 * reproduces the observation byte for byte with no network access, which is what makes golden
 * tests and independent verification possible (docs/TECHNICAL_SPEC.md section 7.1).
 */
export interface AccountSnapshot {
  readonly schema: "mandate-account-snapshot";
  readonly version: 1;
  readonly cluster: string;
  /** Free-text provenance: what this snapshot is and where it came from. */
  readonly label: string;
  readonly capturedAt: string;
  readonly calls: readonly SnapshotCall[];
  readonly accounts: Readonly<Record<string, SnapshotAccount | null>>;
}

export class SnapshotSkewError extends Error {
  override readonly name = "SnapshotSkewError";
  readonly minSlot: number;
  readonly maxSlot: number;
  readonly allowed: number;

  constructor(minSlot: number, maxSlot: number, allowed: number) {
    super(
      `account reads span ${String(maxSlot - minSlot)} slots (${String(minSlot)}..${String(maxSlot)}), allowed ${String(allowed)}`,
    );
    this.minSlot = minSlot;
    this.maxSlot = maxSlot;
    this.allowed = allowed;
  }
}

export interface SlotRange {
  readonly minSlot: number;
  readonly maxSlot: number;
}

export function slotRange(snapshot: Pick<AccountSnapshot, "calls">): SlotRange {
  if (snapshot.calls.length === 0) throw new Error("snapshot has no recorded reads");
  const slots = snapshot.calls.map((call) => call.contextSlot);
  return { minSlot: Math.min(...slots), maxSlot: Math.max(...slots) };
}

/** Reject observations whose reads are spread over too many slots to be one coherent state. */
export function assertSlotSkew(range: SlotRange, allowedSkewSlots: number): void {
  if (range.maxSlot - range.minSlot > allowedSkewSlots) {
    throw new SnapshotSkewError(range.minSlot, range.maxSlot, allowedSkewSlots);
  }
}

/** Hash of every account's owner and data, keyed by address. Goes into the canonical evidence. */
export function accountHashes(snapshot: Pick<AccountSnapshot, "accounts">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const address of Object.keys(snapshot.accounts).sort()) {
    const account = snapshot.accounts[address];
    out[address] =
      account === null || account === undefined
        ? "missing"
        : sha256Hex(`${account.owner}:${account.dataBase64}`);
  }
  return out;
}

const toSnapshotAccount = (info: AccountInfo<Buffer>): SnapshotAccount => ({
  owner: info.owner.toBase58(),
  lamports: info.lamports.toString(),
  executable: info.executable,
  rentEpoch: String(info.rentEpoch ?? 0),
  dataBase64: info.data.toString("base64"),
});

const toAccountInfo = (account: SnapshotAccount): AccountInfo<Buffer> => ({
  owner: new PublicKey(account.owner),
  lamports: Number(account.lamports),
  executable: account.executable,
  rentEpoch: Number(account.rentEpoch),
  data: Buffer.from(account.dataBase64, "base64"),
});

/** Anything that hands the SDK a `Connection` and can describe what was read through it. */
export interface SnapshotSource {
  readonly connection: Connection;
  /** The snapshot of everything read so far. */
  snapshot(): AccountSnapshot;
}

/**
 * Wraps a real connection, forwarding reads and recording every account the SDK asks for together
 * with the context slot it was served at. Because the SDK issues several separate reads, what this
 * records is a blend of slots and is NOT a reproducible observation: use it only to discover which
 * accounts a measurement needs, then fetch them atomically with `fetchAtomicSnapshot`. Only the four account-read methods the SDK uses are
 * intercepted; anything else passes straight through (and would not be recorded).
 */
export class RecordingSource implements SnapshotSource {
  readonly connection: Connection;
  readonly #calls: SnapshotCall[] = [];
  readonly #accounts = new Map<string, SnapshotAccount | null>();
  readonly #meta: { cluster: string; label: string };

  constructor(real: Connection, meta: { cluster: string; label: string }) {
    this.#meta = meta;
    const record = (
      keys: readonly PublicKey[],
      slot: number,
      infos: readonly (AccountInfo<Buffer> | null)[],
      method: string,
    ): void => {
      this.#calls.push({ method, contextSlot: slot, addresses: keys.map((key) => key.toBase58()) });
      keys.forEach((key, i) => {
        const info = infos[i];
        this.#accounts.set(
          key.toBase58(),
          info === null || info === undefined ? null : toSnapshotAccount(info),
        );
      });
    };
    const handler: ProxyHandler<Connection> = {
      get: (target, property, receiver) => {
        switch (property) {
          case "getMultipleAccountsInfo":
          case "getMultipleAccountsInfoAndContext":
            return async (keys: PublicKey[], commitment?: Commitment) => {
              const response = await target.getMultipleAccountsInfoAndContext(keys, commitment);
              record(keys, response.context.slot, response.value, property);
              return property === "getMultipleAccountsInfo" ? response.value : response;
            };
          case "getAccountInfo":
          case "getAccountInfoAndContext":
            return async (key: PublicKey, commitment?: Commitment) => {
              const response = await target.getAccountInfoAndContext(key, commitment);
              record([key], response.context.slot, [response.value], property);
              return property === "getAccountInfo" ? response.value : response;
            };
          default:
            return Reflect.get(target, property, receiver) as unknown;
        }
      },
    };
    this.connection = new Proxy(real, handler);
  }

  snapshot(): AccountSnapshot {
    return {
      schema: "mandate-account-snapshot",
      version: 1,
      cluster: this.#meta.cluster,
      label: this.#meta.label,
      capturedAt: new Date().toISOString(),
      calls: [...this.#calls],
      accounts: Object.fromEntries(
        [...this.#accounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    };
  }
}

export class ReplayMissError extends Error {
  override readonly name = "ReplayMissError";
}

/**
 * A `Connection` that serves reads only from a recorded snapshot and can never touch the network.
 * Asking for an account that was not recorded is an error: it means the code under test read
 * something the original observation did not, i.e. it is not reproducing that observation.
 */
class ReplayConnection extends Connection {
  readonly #accounts: Readonly<Record<string, SnapshotAccount | null>>;
  readonly #slot: number;

  constructor(snapshot: AccountSnapshot) {
    super("http://127.0.0.1:9", "confirmed"); // discard port: any accidental network use fails immediately
    this.#accounts = snapshot.accounts;
    this.#slot = slotRange(snapshot).maxSlot;
  }

  #read(key: PublicKey): AccountInfo<Buffer> | null {
    const address = key.toBase58();
    if (!(address in this.#accounts))
      throw new ReplayMissError(`account ${address} is not in the snapshot`);
    const account = this.#accounts[address];
    return account === null || account === undefined ? null : toAccountInfo(account);
  }

  override getAccountInfoAndContext(
    publicKey: PublicKey,
  ): Promise<RpcResponseAndContext<AccountInfo<Buffer> | null>> {
    return Promise.resolve({ context: { slot: this.#slot }, value: this.#read(publicKey) });
  }

  override getAccountInfo(publicKey: PublicKey): Promise<AccountInfo<Buffer> | null> {
    return Promise.resolve(this.#read(publicKey));
  }

  override getMultipleAccountsInfoAndContext(
    publicKeys: PublicKey[],
  ): Promise<RpcResponseAndContext<(AccountInfo<Buffer> | null)[]>> {
    return Promise.resolve({
      context: { slot: this.#slot },
      value: publicKeys.map((key) => this.#read(key)),
    });
  }

  override getMultipleAccountsInfo(
    publicKeys: PublicKey[],
  ): Promise<(AccountInfo<Buffer> | null)[]> {
    return Promise.resolve(publicKeys.map((key) => this.#read(key)));
  }
}

export class ReplaySource implements SnapshotSource {
  readonly connection: Connection;
  readonly #snapshot: AccountSnapshot;

  constructor(snapshot: AccountSnapshot) {
    this.#snapshot = snapshot;
    this.connection = new ReplayConnection(snapshot);
  }

  snapshot(): AccountSnapshot {
    return this.#snapshot;
  }
}

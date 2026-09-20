import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";

import { measurePool, type MeasurePoolParams, type PoolObservation } from "./pool.ts";
import {
  RecordingSource,
  ReplayMissError,
  ReplaySource,
  type AccountSnapshot,
  type SnapshotAccount,
  type SnapshotCall,
} from "./snapshot.ts";

/** `getMultipleAccounts` accepts at most 100 keys; each chunk is served at one slot. */
export const MAX_ACCOUNTS_PER_READ = 100;

export interface ObservePoolParams extends Omit<MeasurePoolParams, "source"> {
  readonly connection: Connection;
  readonly cluster: string;
  /** Free-text provenance stored in the snapshot. */
  readonly label: string;
  readonly commitment?: Commitment;
  /** How many times to redo discovery if the pool moved enough to need accounts we did not fetch. */
  readonly maxAttempts?: number;
}

/**
 * Fetch `addresses` in as few round trips as the RPC allows (one, for up to 100 accounts), so every
 * account in the snapshot comes from the same slot. That single-slot property is what makes an
 * observation a coherent state instead of a blend of several moments.
 */
export async function fetchAtomicSnapshot(
  connection: Connection,
  addresses: readonly string[],
  meta: { cluster: string; label: string; commitment?: Commitment },
): Promise<AccountSnapshot> {
  const calls: SnapshotCall[] = [];
  const accounts: Record<string, SnapshotAccount | null> = {};
  const sorted = [...addresses].sort();
  for (let i = 0; i < sorted.length; i += MAX_ACCOUNTS_PER_READ) {
    const chunk = sorted.slice(i, i + MAX_ACCOUNTS_PER_READ);
    const response = await connection.getMultipleAccountsInfoAndContext(
      chunk.map((address) => new PublicKey(address)),
      meta.commitment,
    );
    calls.push({
      method: "getMultipleAccountsInfoAndContext",
      contextSlot: response.context.slot,
      addresses: chunk,
    });
    chunk.forEach((address, index) => {
      const info = response.value[index];
      accounts[address] =
        info === null || info === undefined
          ? null
          : {
              owner: info.owner.toBase58(),
              lamports: info.lamports.toString(),
              executable: info.executable,
              rentEpoch: String(info.rentEpoch ?? 0),
              dataBase64: info.data.toString("base64"),
            };
    });
  }
  return {
    schema: "mandate-account-snapshot",
    version: 1,
    cluster: meta.cluster,
    label: meta.label,
    capturedAt: new Date().toISOString(),
    calls,
    accounts,
  };
}

/**
 * Observe a pool as one coherent state.
 *
 *  1. Discovery: run the measurement against the live RPC only to learn which accounts it needs.
 *  2. Atomic read: fetch exactly those accounts in a single request, at one slot.
 *  3. Measure again, purely from that snapshot. This second run is the observation that is reported.
 *
 * If the pool moved between steps 1 and 2 so far that step 3 needs an account the snapshot lacks,
 * the whole procedure is retried a bounded number of times, then the error propagates. The result's
 * snapshot can be replayed offline to reproduce the observation exactly.
 */
export async function observePool(params: ObservePoolParams): Promise<PoolObservation> {
  const attempts = params.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const discovery = new RecordingSource(params.connection, {
      cluster: params.cluster,
      label: "discovery",
    });
    await measurePool({ ...params, source: discovery, maxSlotSkew: Number.MAX_SAFE_INTEGER });

    const snapshot = await fetchAtomicSnapshot(
      params.connection,
      Object.keys(discovery.snapshot().accounts),
      {
        cluster: params.cluster,
        label: params.label,
        ...(params.commitment === undefined ? {} : { commitment: params.commitment }),
      },
    );

    try {
      return await measurePool({ ...params, source: new ReplaySource(snapshot) });
    } catch (error) {
      if (!(error instanceof ReplayMissError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Re-run an observation from a stored snapshot, offline. Must reproduce the original payload hash. */
export function replayPool(
  snapshot: AccountSnapshot,
  params: Omit<MeasurePoolParams, "source">,
): Promise<PoolObservation> {
  return measurePool({ ...params, source: new ReplaySource(snapshot) });
}

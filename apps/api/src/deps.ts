import type { Db } from "@mandate/db";
import type { Metrics } from "@mandate/observability";
import type { PrestocksClient } from "@mandate/prestocks";
import type { PublicKey } from "@solana/web3.js";

/** What the API needs from the chain, only to BUILD transactions (reads for the UI come from the read model). */
export interface ApiChain {
  getAccount(address: PublicKey): Promise<{ data: Uint8Array; owner: string } | null>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

export interface ApiConfig {
  readonly cluster: string;
  readonly programId: string;
  readonly usdcMint: string;
  readonly rateLimitPerMinute: number;
  readonly maxStalenessSeconds: number;
  readonly evidencePublicBaseUrl?: string | undefined;
}

export interface ApiDeps {
  readonly db: Db;
  readonly chain: ApiChain;
  readonly prestocks: Pick<PrestocksClient, "getSnapshot">;
  readonly metrics: Metrics;
  readonly config: ApiConfig;
  readonly now?: () => Date;
}

import { prestocksResponseSchema, type PrestocksAsset } from "./schema.ts";

export const DEFAULT_PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

export interface PrestocksSnapshot {
  readonly assets: readonly PrestocksAsset[];
  /** When this process fetched the data. Always surface it next to any displayed value. */
  readonly fetchedAt: Date;
  readonly sourceUrl: string;
}

export class PrestocksApiError extends Error {
  override readonly name = "PrestocksApiError";
}

export interface PrestocksClientOptions {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Fail-closed reader for the PreStocks public API: explicit timeout, runtime schema
 * validation, bounded cache. An invalid or unreachable upstream throws; it never
 * yields partial or stale-as-fresh data. API presence alone never makes a mint
 * eligible; onchain mint inspection is a separate mandatory step.
 */
export class PrestocksClient {
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #cacheTtlMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  #cached: PrestocksSnapshot | undefined;

  constructor(options: PrestocksClientOptions = {}) {
    this.#url = options.url ?? DEFAULT_PRESTOCKS_API_URL;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async getSnapshot(): Promise<PrestocksSnapshot> {
    const now = this.#now();
    if (this.#cached && now.getTime() - this.#cached.fetchedAt.getTime() < this.#cacheTtlMs) {
      return this.#cached;
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#url, { signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (cause) {
      throw new PrestocksApiError("PreStocks API request failed", { cause });
    }
    if (!response.ok)
      throw new PrestocksApiError(`PreStocks API returned HTTP ${String(response.status)}`);
    const parsed = prestocksResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new PrestocksApiError(`PreStocks API schema drift: ${parsed.error.message}`);
    }
    this.#cached = { assets: parsed.data, fetchedAt: now, sourceUrl: this.#url };
    return this.#cached;
  }

  /** Resolve by exact mint. Never by ticker. */
  async findByMint(mint: string): Promise<PrestocksAsset | undefined> {
    return (await this.getSnapshot()).assets.find((asset) => asset.contract_address === mint);
  }
}

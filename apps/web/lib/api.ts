import { env } from "./env.ts";
import type {
  ApiErrorBody,
  Envelope,
  EpochTimeline,
  EvidenceResponse,
  MandateDetail,
  MandateListResponse,
  MarketQuality,
  PrestocksAsset,
  Row,
  MandateAccountJson,
  BidAccountJson,
  MarketConfigAccountJson,
  TxBundle,
} from "./types.ts";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      // Every call site here passes a JSON string body or none; there is no array/Headers-object form to
      // worry about, so this is a plain, safe object literal rather than a spread of arbitrary HeadersInit.
      headers: init?.body ? { "content-type": "application/json" } : {},
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the Mandate API. Check your connection and try again.",
    );
  }
  const text = await res.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (body as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `request failed with HTTP ${String(res.status)}`,
    );
  }
  return body as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);
const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const listMarkets = (): Promise<Envelope<readonly Row<MarketConfigAccountJson>[]>> =>
  get("/v1/markets");

export const getMarketQuality = (pool: string): Promise<Envelope<MarketQuality>> =>
  get(`/v1/markets/${encodeURIComponent(pool)}/quality`);

export interface MandateFilters {
  readonly status?: string;
  readonly provider?: string;
  readonly sponsor?: string;
  readonly market?: string;
  readonly after?: string;
  readonly limit?: number;
}
export function listMandates(filters: MandateFilters = {}): Promise<Envelope<MandateListResponse>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined) params.set(key, String(value));
  const qs = params.toString();
  return get(`/v1/mandates${qs ? `?${qs}` : ""}`);
}

export const getMandate = (address: string): Promise<Envelope<MandateDetail>> =>
  get(`/v1/mandates/${encodeURIComponent(address)}`);

export const listBids = (address: string): Promise<Envelope<readonly Row<BidAccountJson>[]>> =>
  get(`/v1/mandates/${encodeURIComponent(address)}/bids`);

export const getEpochTimeline = (address: string): Promise<Envelope<EpochTimeline>> =>
  get(`/v1/mandates/${encodeURIComponent(address)}/epochs`);

export const getEvidence = (address: string, epoch: number): Promise<Envelope<EvidenceResponse>> =>
  get(`/v1/mandates/${encodeURIComponent(address)}/evidence/${String(epoch)}`);

export const getProviderMandates = (
  wallet: string,
  after?: string,
): Promise<
  Envelope<readonly (Row<MandateAccountJson> & { accounting: MandateDetail["accounting"] })[]>
> =>
  get(
    `/v1/provider/${encodeURIComponent(wallet)}/mandates${after ? `?after=${encodeURIComponent(after)}` : ""}`,
  );

export const getPrestocksAssets = (): Promise<{
  readonly data: readonly PrestocksAsset[];
  readonly meta: Record<string, unknown>;
}> => get("/v1/prestocks");

export const buildClaimTx = (body: {
  wallet: string;
  mandate: string;
  destinationUsdc: string;
  amountRaw: string;
}): Promise<TxBundle> => post("/v1/tx/claim", body);

export const buildWithdrawTx = (body: {
  wallet: string;
  mandate: string;
  destinationUsdc: string;
  amountRaw: string;
}): Promise<TxBundle> => post("/v1/tx/withdraw", body);

export const buildSubmitBidTx = (body: {
  wallet: string;
  mandate: string;
  nonce: string;
  requestedRewardRaw: string;
  validUntil: string;
}): Promise<TxBundle> => post("/v1/tx/submit-bid", body);

export const buildAcceptBidTx = (body: {
  wallet: string;
  mandate: string;
  provider: string;
  nonce: string;
}): Promise<TxBundle> => post("/v1/tx/accept-bid", body);

export const buildRegisterPositionsTx = (body: {
  wallet: string;
  mandate: string;
  positions: readonly string[];
}): Promise<TxBundle> => post("/v1/tx/register-positions", body);

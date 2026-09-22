/**
 * Same-origin JSON-RPC proxy to the configured Solana RPC. This is the ONLY place `SOLANA_RPC_HTTP_URL` (a
 * private or paid endpoint, never `NEXT_PUBLIC_`) is read, so the browser never sees it and can never leak it.
 * Only the read/send methods the app actually uses are forwarded; everything else, including unbounded scans
 * like `getProgramAccounts`, is refused so this proxy cannot become an open relay for someone else's RPC usage.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountBalance",
  "getBalance",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSignatureStatuses",
  "getMinimumBalanceForRentExemption",
  "sendTransaction",
  "simulateTransaction",
  "getVersion",
]);

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: unknown;
}

function rpcError(id: unknown, code: number, message: string): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: 400 },
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const upstream = process.env.SOLANA_RPC_HTTP_URL;
  if (!upstream) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "SOLANA_RPC_HTTP_URL is not configured on the server" },
      },
      { status: 500 },
    );
  }

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = (await req.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return rpcError(null, -32700, "invalid JSON");
  }
  const calls = Array.isArray(body) ? body : [body];
  for (const call of calls) {
    if (!call.method || !ALLOWED_METHODS.has(call.method)) {
      return rpcError(
        call.id,
        -32601,
        `method not allowed through this proxy: ${call.method ?? "(missing)"}`,
      );
    }
  }

  const upstreamResponse = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await upstreamResponse.text();
  return new NextResponse(text, {
    status: upstreamResponse.status,
    headers: { "content-type": "application/json" },
  });
}

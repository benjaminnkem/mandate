import { Connection } from "@solana/web3.js";

/**
 * The browser always talks to `/api/rpc`, a same-origin proxy (`app/api/rpc/route.ts`). This is what keeps a
 * paid or private RPC endpoint out of the bundle: no `NEXT_PUBLIC_` variable ever names it. `wsEndpoint` is set
 * to the same URL to stop `web3.js` from guessing a websocket endpoint and trying to open one; nothing here
 * uses it, since confirmation is done by polling (`./transactions.ts`), not by subscription. Client-side only.
 */
let shared: Connection | undefined;

export function getConnection(): Connection {
  if (typeof window === "undefined") {
    throw new Error("getConnection() only runs in the browser");
  }
  if (!shared) {
    const proxy = new URL("/api/rpc", window.location.origin).toString();
    shared = new Connection(proxy, { commitment: "confirmed", wsEndpoint: proxy });
  }
  return shared;
}

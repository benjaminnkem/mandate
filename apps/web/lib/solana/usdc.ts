import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { env } from "../env.ts";

/** The wallet's associated USDC token account for the configured mint. Existence is not checked here — the
 * account must already exist for a claim/withdraw destination, since none of the write flows create one. */
export function myUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(env.usdcMint), owner);
}

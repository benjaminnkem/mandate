/**
 * Public, client-safe configuration. Every value here is shipped to the browser, so nothing secret may be
 * added: `SOLANA_RPC_HTTP_URL` (a paid or private RPC endpoint) stays server-only and is used exclusively by
 * `app/api/rpc/route.ts`, never read here.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when the property is accessed with a literal
 * dot (`process.env.NEXT_PUBLIC_X`), so every read below must be written that way, not through a variable key.
 */
import { z } from "zod";

const clusterSchema = z.enum(["localnet", "surfpool", "devnet", "mainnet-beta"]);
export type SolanaCluster = z.infer<typeof clusterSchema>;

const base58Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

const schema = z.object({
  cluster: clusterSchema,
  programId: base58Address,
  apiBaseUrl: z.url(),
  usdcMint: base58Address,
});

function load(): z.infer<typeof schema> {
  const parsed = schema.safeParse({
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    programId: process.env.NEXT_PUBLIC_MANDATE_PROGRAM_ID,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    usdcMint: process.env.NEXT_PUBLIC_USDC_MINT,
  });
  if (!parsed.success) {
    throw new Error(
      `invalid web environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export const env = load();

/** The Wallet Standard chain identifier for the configured cluster (https://github.com/wallet-standard). */
export function chainIdentifier(
  cluster: SolanaCluster,
): "solana:mainnet" | "solana:devnet" | "solana:localnet" {
  if (cluster === "mainnet-beta") return "solana:mainnet";
  if (cluster === "devnet") return "solana:devnet";
  return "solana:localnet";
}

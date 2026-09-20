import { z } from "zod";

import { parseEnv } from "./env.ts";

/** Canonical mainnet USDC mint. Other clusters must supply their own explicitly. */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const PUBLIC_MAINNET_RPC_HOSTS = ["api.mainnet-beta.solana.com"];

const base58Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

const httpUrl = z.url({ protocol: /^https?$/ });
const wsUrl = z.url({ protocol: /^wss?$/ });
const positiveInt = z.coerce.number().int().positive();

export const solanaClusterSchema = z.enum(["localnet", "surfpool", "devnet", "mainnet-beta"]);
export type SolanaCluster = z.infer<typeof solanaClusterSchema>;

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info");

const chainShape = {
  SOLANA_CLUSTER: solanaClusterSchema,
  SOLANA_RPC_HTTP_URL: httpUrl,
  SOLANA_RPC_WS_URL: wsUrl.optional(),
  SOLANA_FALLBACK_RPC_HTTP_URL: httpUrl.optional(),
  SOLANA_COMMITMENT: z.enum(["processed", "confirmed", "finalized"]).default("confirmed"),
  MANDATE_PROGRAM_ID: base58Address,
  USDC_MINT: base58Address.default(MAINNET_USDC_MINT),
  LOG_LEVEL: logLevel,
};

/** Production must never silently ride the shared public RPC. */
function rejectPublicMainnetRpc(
  value: { SOLANA_CLUSTER: SolanaCluster; SOLANA_RPC_HTTP_URL: string },
  ctx: z.RefinementCtx,
): void {
  if (value.SOLANA_CLUSTER !== "mainnet-beta") return;
  const host = new URL(value.SOLANA_RPC_HTTP_URL).hostname;
  if (PUBLIC_MAINNET_RPC_HOSTS.includes(host)) {
    ctx.addIssue({
      code: "custom",
      path: ["SOLANA_RPC_HTTP_URL"],
      message:
        "the public mainnet RPC is not allowed for mainnet-beta; configure a dedicated provider",
    });
  }
}

export const chainEnvSchema = z.object(chainShape).superRefine(rejectPublicMainnetRpc);
export type ChainEnv = z.infer<typeof chainEnvSchema>;

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });

export const apiEnvSchema = z
  .object({
    ...chainShape,
    PORT: positiveInt.default(3001),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl.optional(),
    PRESTOCKS_API_URL: httpUrl.default("https://prestocks.com/api/prestocks"),
    PRESTOCKS_CACHE_TTL_SECONDS: positiveInt.default(60),
    EVIDENCE_PUBLIC_BASE_URL: httpUrl.optional(),
  })
  .superRefine(rejectPublicMainnetRpc);
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const indexerEnvSchema = z
  .object({
    ...chainShape,
    DATABASE_URL: databaseUrl,
    INDEXER_START_SIGNATURE_OR_SLOT: z.string().min(1).optional(),
    INDEXER_CONFIRMATION_LEVEL: z.enum(["confirmed", "finalized"]).default("confirmed"),
    INDEXER_RECONCILE_INTERVAL_SECONDS: positiveInt.default(300),
  })
  .superRefine(rejectPublicMainnetRpc);
export type IndexerEnv = z.infer<typeof indexerEnvSchema>;

export const schedulerEnvSchema = z
  .object({
    ...chainShape,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    /** Optional low-balance fee payer only. It must hold no protocol authority. */
    SCHEDULER_RELAYER_KEYPAIR_PATH: z.string().min(1).optional(),
    EPOCH_JOB_LEAD_SECONDS: positiveInt.default(30),
    FINALIZE_RETRY_LIMIT: positiveInt.default(5),
  })
  .superRefine(rejectPublicMainnetRpc);
export type SchedulerEnv = z.infer<typeof schedulerEnvSchema>;

export const observerEnvSchema = z
  .object({
    ...chainShape,
    OBSERVER_KEYPAIR_PATH: z.string().min(1),
    /** Must equal the pubkey derived from the keypair; checked at startup by the observer. */
    OBSERVER_EXPECTED_PUBKEY: base58Address,
    OBSERVER_INSTANCE_ID: z.string().min(1).default("observer-1"),
    DATABASE_URL: databaseUrl.optional(),
    EVIDENCE_STORAGE_MODE: z.enum(["filesystem", "s3-compatible"]).default("filesystem"),
    EVIDENCE_STORAGE_PATH: z.string().min(1).optional(),
    EVIDENCE_S3_ENDPOINT: httpUrl.optional(),
    EVIDENCE_S3_BUCKET: z.string().min(1).optional(),
    EVIDENCE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    EVIDENCE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    MEASUREMENT_ALGORITHM_VERSION: positiveInt.default(1),
  })
  .superRefine(rejectPublicMainnetRpc)
  .superRefine((value, ctx) => {
    if (value.EVIDENCE_STORAGE_MODE === "filesystem" && !value.EVIDENCE_STORAGE_PATH) {
      ctx.addIssue({
        code: "custom",
        path: ["EVIDENCE_STORAGE_PATH"],
        message: "required for filesystem evidence storage",
      });
    }
    if (value.EVIDENCE_STORAGE_MODE === "s3-compatible") {
      for (const key of [
        "EVIDENCE_S3_ENDPOINT",
        "EVIDENCE_S3_BUCKET",
        "EVIDENCE_S3_ACCESS_KEY_ID",
        "EVIDENCE_S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required for s3-compatible evidence storage",
          });
      }
    }
  });
export type ObserverEnv = z.infer<typeof observerEnvSchema>;

type Source = Record<string, string | undefined>;
export const loadApiEnv = (source?: Source): ApiEnv => parseEnv("api", apiEnvSchema, source);
export const loadIndexerEnv = (source?: Source): IndexerEnv =>
  parseEnv("indexer", indexerEnvSchema, source);
export const loadSchedulerEnv = (source?: Source): SchedulerEnv =>
  parseEnv("scheduler", schedulerEnvSchema, source);
export const loadObserverEnv = (source?: Source): ObserverEnv =>
  parseEnv("observer", observerEnvSchema, source);

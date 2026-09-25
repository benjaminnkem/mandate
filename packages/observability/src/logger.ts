import { randomUUID } from "node:crypto";
import type { DestinationStream, Logger } from "pino";
import { pino } from "pino";

export type { Logger } from "pino";

/** Paths scrubbed from every log line. Extend, never shrink. */
export const REDACTED_PATHS = [
  "authorization",
  "headers.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.authorization",
  "res.headers['set-cookie']",
  "password",
  "secret",
  "privateKey",
  "secretKey",
  "seedPhrase",
  "apiKey",
  "*.password",
  "*.secret",
  "*.privateKey",
  "*.secretKey",
  "*.seedPhrase",
  "*.apiKey",
  "DATABASE_URL",
  "REDIS_URL",
  "EVIDENCE_S3_SECRET_ACCESS_KEY",
  "CLAWPUMP_API_KEY",
  "SOLANA_RPC_HTTP_URL",
  "SOLANA_RPC_WS_URL",
  "SOLANA_FALLBACK_RPC_HTTP_URL",
];

export interface LoggerOptions {
  readonly service: string;
  readonly level?: string;
  readonly destination?: DestinationStream;
}

export function createLogger({ service, level = "info", destination }: LoggerOptions): Logger {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}

/** Create a request/job correlation id. */
export const newCorrelationId = (): string => randomUUID();

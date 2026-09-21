import { indexStatus } from "@mandate/db";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import type { ApiDeps } from "./deps.ts";

/** A base58 Solana address that really is a 32-byte public key. */
export const address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 address")
  .refine((value) => {
    try {
      return new PublicKey(value).toBytes().length === 32;
    } catch {
      return false;
    }
  }, "must be a valid public key");

export const epochIndex = z.coerce.number().int().min(0).max(2015);
export const limit = z.coerce.number().int().min(1).max(100).default(50);

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Meta {
  readonly cluster: string;
  readonly programId: string;
  /** Highest slot the read model has processed events up to, and when it last advanced. */
  readonly indexedSlot: string;
  readonly indexedAt: string | null;
  readonly staleSeconds: number | null;
  readonly stale: boolean;
  readonly source: "indexed-chain-state";
}

export async function meta(deps: ApiDeps): Promise<Meta> {
  const status = await indexStatus(deps.db, "program-events");
  const now = (deps.now ?? (() => new Date()))();
  const staleSeconds = status.cursorUpdatedAt
    ? Math.max(0, Math.round((now.getTime() - status.cursorUpdatedAt.getTime()) / 1000))
    : null;
  return {
    cluster: deps.config.cluster,
    programId: deps.config.programId,
    indexedSlot: status.indexedSlot.toString(),
    indexedAt: status.cursorUpdatedAt?.toISOString() ?? null,
    staleSeconds,
    stale: staleSeconds === null || staleSeconds > deps.config.maxStalenessSeconds,
    source: "indexed-chain-state",
  };
}

/** Every chain-derived response names its network and how fresh it is. */
export async function envelope<T>(deps: ApiDeps, data: T): Promise<{ data: T; meta: Meta }> {
  return { data, meta: await meta(deps) };
}

/** Exact 6-decimal display of a raw USDC amount (string in, string out; never a float). */
export function usdc(raw: string): string {
  const v = BigInt(raw);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${frac}`;
}

export const amountPair = (raw: string): { raw: string; usdc: string } => ({
  raw,
  usdc: usdc(raw),
});

/** A stored JSON field that must be a string (hashes, addresses); anything else is a corrupt row, not "[object Object]". */
export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("stored account field is not a string");
  return value;
}

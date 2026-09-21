import { BorshCoder, EventParser } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { AccountName } from "./accounts.ts";
import { MANDATE_IDL, MANDATE_PROGRAM_ID } from "./idl.ts";

/** JSON-safe value: u64/i64 as decimal strings, keys as base58, 32-byte arrays as lowercase hex. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function jsonSafe(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (BN.isBN(value)) return value.toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    const items = value as unknown[];
    if (items.length === 32 && items.every((b) => typeof b === "number" && b >= 0 && b <= 255))
      return Buffer.from(items as number[]).toString("hex");
    return items.map(jsonSafe);
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  throw new TypeError(`cannot make ${typeof value} JSON-safe`);
}

const discriminators = new Map<string, AccountName>(
  (MANDATE_IDL.accounts ?? []).map((a) => [
    Buffer.from(a.discriminator).toString("hex"),
    a.name as AccountName,
  ]),
);

/** Which program account type these bytes are, by Anchor's 8-byte discriminator. `null` if not one of ours. */
export function accountKind(data: Uint8Array): AccountName | null {
  if (data.length < 8) return null;
  return discriminators.get(Buffer.from(data.subarray(0, 8)).toString("hex")) ?? null;
}

export interface ProgramEvent {
  readonly name: string;
  readonly data: Record<string, JsonValue>;
}

const parser = new EventParser(MANDATE_PROGRAM_ID, new BorshCoder(MANDATE_IDL));

const camel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

function camelKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(camelKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelKeys(v)]));
  return value;
}

/** Decode the program's events from a transaction's log lines, in emission order. Field names are camelCase, as for accounts. */
export function parseProgramEvents(logs: readonly string[]): ProgramEvent[] {
  const events: ProgramEvent[] = [];
  for (const event of parser.parseLogs([...logs])) {
    events.push({
      name: event.name,
      data: camelKeys(jsonSafe(event.data)) as Record<string, JsonValue>,
    });
  }
  return events;
}

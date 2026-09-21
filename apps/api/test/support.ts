import { BorshAccountsCoder } from "@anchor-lang/core";
import { MANDATE_IDL } from "@mandate/solana";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const coder = new BorshAccountsCoder(MANDATE_IDL);
interface TypeDef {
  name: string;
  type: { kind: string; fields?: { name: string; type: unknown }[]; variants?: { name: string }[] };
}
const types = (MANDATE_IDL as unknown as { types: TypeDef[] }).types;

function zero(type: unknown): unknown {
  if (typeof type === "string") {
    if (type === "bool") return false;
    if (type === "pubkey") return PublicKey.default;
    if (/^[ui](8|16|32)$/.test(type)) return 0;
    return new BN(0);
  }
  const t = type as { array?: [unknown, number]; defined?: { name: string } };
  if (t.array) return Array.from({ length: t.array[1] }, () => zero(t.array?.[0]));
  if (t.defined) {
    const def = types.find((d) => d.name === t.defined?.name);
    if (!def) throw new Error(`unknown type ${t.defined.name}`);
    if (def.type.kind === "enum") return { [def.type.variants?.[0]?.name ?? ""]: {} };
    return Object.fromEntries((def.type.fields ?? []).map((f) => [f.name, zero(f.type)]));
  }
  throw new Error(`unsupported type ${JSON.stringify(type)}`);
}

/** Encode a program account exactly as the chain would store it. Unspecified fields are zero. */
export function encodeAccount(name: string, over: Record<string, unknown>): Promise<Buffer> {
  return coder.encode(name, {
    ...(zero({ defined: { name } }) as Record<string, unknown>),
    ...over,
  });
}

export const key = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));
export const bn = (n: bigint | number): BN => new BN(n.toString());

export function mandateFields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sponsor: key(1),
    mandate_id: bn(1),
    market_config: key(2),
    observer_set: key(3),
    vault: key(4),
    start_at: bn(1_000_000),
    end_at: bn(1_000_000 + 3 * 300),
    epoch_seconds: bn(300),
    total_epochs: 3,
    algorithm_version: 1,
    unavailable_recovery_seconds: bn(3600),
    max_reward_raw: bn(130),
    accepted_reward_raw: bn(100),
    provider: key(9),
    status: { Active: {} },
    ...over,
  };
}

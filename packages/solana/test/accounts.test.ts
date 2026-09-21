import { BorshAccountsCoder } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";

import {
  MANDATE_IDL,
  decodeAccount,
  registeredPositions,
  setObservers,
  type EpochAttestationAccount,
  type MandateAccount,
  type ObserverSetAccount,
  type PositionSetAccount,
} from "../src/index.ts";

const coder = new BorshAccountsCoder(MANDATE_IDL);

interface TypeDef {
  readonly name: string;
  readonly type: {
    readonly kind: string;
    readonly fields?: readonly { name: string; type: unknown }[];
    readonly variants?: readonly { name: string }[];
  };
}
const types = (MANDATE_IDL as unknown as { types: TypeDef[] }).types;

/** A zero value for any IDL type, so tests can build an account and override only the fields they care about. */
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

const build = (name: string, over: Record<string, unknown>): Promise<Buffer> =>
  coder.encode(name, { ...(zero({ defined: { name } }) as Record<string, unknown>), ...over });

const k = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));

describe("account decoding", () => {
  it("returns exact bigints, base58-capable keys and camelCase fields for an attestation", async () => {
    const data = await build("EpochAttestation", {
      mandate: k(1),
      epoch_index: 7,
      observer: k(2),
      observed_slot: new BN("448786149"),
      observed_unix_ts: new BN("1789921836"),
      algorithm_version: 1,
      position_set: k(3),
      payload_hash: Array.from({ length: 32 }, () => 0xaa),
      evidence_hash: Array.from({ length: 32 }, () => 0xbb),
      metrics: {
        effective_spread_bps: 251,
        pool_buy_depth_quote_raw: new BN("18446744073709551615"), // u64::MAX survives exactly
        pool_sell_depth_quote_raw: new BN("49065543907"),
        provider_quote_in_band_raw: new BN("91107867"),
        provider_base_quote_eq_in_band_raw: new BN("81314309"),
      },
    });
    const a = decodeAccount<EpochAttestationAccount>("EpochAttestation", data);
    expect(a.epochIndex).toBe(7);
    expect(a.observer.equals(k(2))).toBe(true);
    expect(a.observedSlot).toBe(448_786_149n);
    expect(a.observedUnixTs).toBe(1_789_921_836n);
    expect(a.metrics.poolBuyDepthQuoteRaw).toBe(18_446_744_073_709_551_615n);
    expect(a.metrics.effectiveSpreadBps).toBe(251);
    expect([...a.payloadHash].every((b) => b === 0xaa)).toBe(true);
    expect(typeof a.observedSlot).toBe("bigint");
  });

  it("decodes a mandate, including negative-capable timestamps and the status enum", async () => {
    const data = await build("Mandate", {
      sponsor: k(1),
      mandate_id: new BN("42"),
      observer_set: k(3),
      start_at: new BN("1789929036"),
      epoch_seconds: new BN(300),
      total_epochs: 72,
      algorithm_version: 1,
      unavailable_recovery_seconds: new BN(3600),
      depth_band_bps: 500,
      probe_quote_raw: new BN("10000000"),
      provider: k(9),
      status: { Active: {} },
    });
    const m = decodeAccount<MandateAccount>("Mandate", data);
    expect(m.status).toBe("Active");
    expect(m.mandateId).toBe(42n);
    expect(m.startAt).toBe(1_789_929_036n);
    expect(m.totalEpochs).toBe(72);
    expect(m.unavailableRecoverySeconds).toBe(3_600n);
    expect(m.probeQuoteRaw).toBe(10_000_000n);
    expect(m.provider.equals(k(9))).toBe(true);
  });

  it("trims the fixed-size position and observer arrays to what was registered", async () => {
    const positions = decodeAccount<PositionSetAccount>(
      "PositionSet",
      await build("PositionSet", {
        position_count: 2,
        positions: [k(1), k(2), ...Array.from({ length: 6 }, () => PublicKey.default)],
      }),
    );
    expect(registeredPositions(positions).map((p) => p.toBase58())).toEqual([
      k(1).toBase58(),
      k(2).toBase58(),
    ]);

    const observers = decodeAccount<ObserverSetAccount>(
      "ObserverSet",
      await build("ObserverSet", {
        observer_count: 3,
        threshold: 2,
        observers: [k(4), k(5), k(6), PublicKey.default, PublicKey.default],
      }),
    );
    expect(setObservers(observers).map((o) => o.toBase58())).toEqual(
      [k(4), k(5), k(6)].map((x) => x.toBase58()),
    );
    expect(observers.threshold).toBe(2);
  });

  it("rejects data that is not the named account", async () => {
    const data = await build("PositionSet", {});
    expect(() => decodeAccount("Mandate", data)).toThrow();
  });
});

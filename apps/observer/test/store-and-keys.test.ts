import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { EvidenceConflictError, ObserverConfigError } from "../src/errors.ts";
import { FilesystemEvidenceStore, type EvidenceRecord } from "../src/evidence-store.ts";
import { loadObserverKeypair } from "../src/keys.ts";
import { snapshot } from "./support.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "mandate-store-"));
const OBS = Keypair.generate().publicKey.toBase58();
const MAND = Keypair.generate().publicKey.toBase58();

const record = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  schema: "mandate-evidence-record",
  version: 1,
  mandate: MAND,
  epochIndex: 4,
  observer: OBS,
  role: "leader",
  payloadJson: "{}",
  payloadHash: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  evidenceHash: "c".repeat(64),
  transportJson: "{}",
  observedSlot: "1",
  observedUnixTs: "2",
  algorithmVersion: 1,
  metrics: { effectiveSpreadBps: "251" },
  ...over,
});

describe("evidence store", () => {
  it("stores a snapshot by its content hash and returns it unchanged", async () => {
    const store = new FilesystemEvidenceStore(tmp());
    const sha = await store.putSnapshot(snapshot);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.putSnapshot(snapshot)).toBe(sha); // idempotent
    expect(await store.getSnapshot(sha)).toEqual(snapshot);
    expect(await store.getSnapshot("0".repeat(64))).toBeNull();
  });

  it("detects a snapshot altered on disk", async () => {
    const dir = tmp();
    const store = new FilesystemEvidenceStore(dir);
    const sha = await store.putSnapshot(snapshot);
    const file = join(dir, "snapshots", `${sha}.json`);
    writeFileSync(file, readFileSync(file, "utf8").replace("mainnet-beta", "devnet"));
    await expect(store.getSnapshot(sha)).rejects.toThrow(EvidenceConflictError);
  });

  it("persists records, finds them by evidence hash and by epoch, and is idempotent", async () => {
    const store = new FilesystemEvidenceStore(tmp());
    await store.putRecord(record());
    await store.putRecord(record()); // identical: fine
    expect((await store.getRecord("c".repeat(64), OBS))?.payloadHash).toBe("a".repeat(64));
    expect((await store.getAnyRecord("c".repeat(64)))?.observer).toBe(OBS);
    expect((await store.getOwnRecord(MAND, 4, OBS))?.evidenceHash).toBe("c".repeat(64));
    expect(await store.getOwnRecord(MAND, 5, OBS)).toBeNull();
    expect(await store.getRecord("d".repeat(64), OBS)).toBeNull();
  });

  it("refuses to change evidence once written: records are immutable", async () => {
    const store = new FilesystemEvidenceStore(tmp());
    await store.putRecord(record());
    await expect(store.putRecord(record({ payloadJson: '{"changed":true}' }))).rejects.toThrow(
      EvidenceConflictError,
    );
    // a second, different piece of evidence for the same observer and epoch is also refused
    await expect(store.putRecord(record({ evidenceHash: "e".repeat(64) }))).rejects.toThrow(
      /already holds different evidence/,
    );
  });

  it("leaves no temporary files and never accepts a hostile path component", async () => {
    const dir = tmp();
    const store = new FilesystemEvidenceStore(dir);
    await store.putRecord(record());
    const leftovers = readdirSync(join(dir, "records", "c".repeat(64))).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
    await expect(store.getSnapshot("../../etc/passwd")).rejects.toThrow(RangeError);
    await expect(store.getRecord("c".repeat(64), "../evil")).rejects.toThrow(RangeError);
    await expect(store.getOwnRecord("../x", 1, OBS)).rejects.toThrow(RangeError);
  });
});

describe("observer key loading", () => {
  const write = (kp: Keypair, mode = 0o600): string => {
    const path = join(tmp(), "observer.json");
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
    chmodSync(path, mode);
    return path;
  };

  it("loads a key whose public key matches the expected one", () => {
    const kp = Keypair.generate();
    expect(
      loadObserverKeypair(write(kp), kp.publicKey.toBase58()).publicKey.equals(kp.publicKey),
    ).toBe(true);
  });

  it("refuses a key that derives a different public key", () => {
    const kp = Keypair.generate();
    expect(() => loadObserverKeypair(write(kp), Keypair.generate().publicKey.toBase58())).toThrow(
      /does not match OBSERVER_EXPECTED_PUBKEY/,
    );
  });

  it("refuses a key file other users can read", () => {
    const kp = Keypair.generate();
    expect(() => loadObserverKeypair(write(kp, 0o644), kp.publicKey.toBase58())).toThrow(
      /chmod 600/,
    );
  });

  it("refuses missing and malformed files without echoing their contents", () => {
    const kp = Keypair.generate();
    expect(() => loadObserverKeypair("/nonexistent/key.json", kp.publicKey.toBase58())).toThrow(
      ObserverConfigError,
    );
    const path = join(tmp(), "bad.json");
    writeFileSync(path, '{"secret":"do-not-leak"}');
    chmodSync(path, 0o600);
    try {
      loadObserverKeypair(path, kp.publicKey.toBase58());
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("do-not-leak");
      expect(error).toBeInstanceOf(ObserverConfigError);
    }
  });
});

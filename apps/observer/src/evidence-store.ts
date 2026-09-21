import { mkdir, open, readFile, rename, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalHash, snapshotToCanonical, type AccountSnapshot } from "@mandate/meteora";

import { EvidenceConflictError } from "./errors.ts";

/**
 * Everything an observer keeps about one attestation. The bulky raw account snapshot is stored separately by its
 * content hash, so the leader's snapshot can be fetched by any follower and verified against its own hash.
 */
export interface EvidenceRecord {
  readonly schema: "mandate-evidence-record";
  readonly version: 1;
  readonly mandate: string;
  readonly epochIndex: number;
  readonly observer: string;
  readonly role: "leader" | "follower";
  /** The canonical payload as JSON text, exactly what `payloadHash` was computed over. */
  readonly payloadJson: string;
  readonly payloadHash: string;
  readonly snapshotSha256: string;
  readonly evidenceHash: string;
  /** Observer-specific facts (never hashed). Serialized canonical JSON. */
  readonly transportJson: string;
  readonly observedSlot: string;
  readonly observedUnixTs: string;
  readonly algorithmVersion: number;
  readonly metrics: Readonly<Record<string, string>>;
}

export interface EvidenceStore {
  /** Store an immutable snapshot by the hash of its canonical form; returns that hash. Idempotent. */
  putSnapshot(snapshot: AccountSnapshot): Promise<string>;
  /** Fetch a snapshot and verify it hashes to `sha256`. Returns null if absent; throws if the bytes do not match. */
  getSnapshot(sha256: string): Promise<AccountSnapshot | null>;
  /** Persist a record durably. Idempotent for identical content; throws `EvidenceConflictError` for different content. */
  putRecord(record: EvidenceRecord): Promise<void>;
  getRecord(evidenceHash: string, observer: string): Promise<EvidenceRecord | null>;
  /** Any observer's record for this evidence hash, for followers looking for a leader's evidence. */
  getAnyRecord(evidenceHash: string): Promise<EvidenceRecord | null>;
  /** This observer's record for a given mandate epoch, if it ever attested. */
  getOwnRecord(
    mandate: string,
    epochIndex: number,
    observer: string,
  ): Promise<EvidenceRecord | null>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function safe(part: string, pattern: RegExp, what: string): string {
  if (!pattern.test(part)) throw new RangeError(`unsafe ${what} for a file path`);
  return part;
}

/**
 * Durable write: write to a temporary file in the same directory, flush it to disk, atomically rename it into
 * place, then flush the directory entry. A crash leaves either the complete file or nothing, never half a file.
 */
async function writeDurably(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  const file = await open(tmp, "w", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tmp, path);
  const dir = await open(dirname(path), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Filesystem-backed store. Point every observer at storage the others can read (shared volume or synced bucket). */
export class FilesystemEvidenceStore implements EvidenceStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #snapshotPath = (sha: string): string =>
    join(this.#root, "snapshots", `${safe(sha, HEX64, "snapshot hash")}.json`);
  #recordPath = (evidenceHash: string, observer: string): string =>
    join(
      this.#root,
      "records",
      safe(evidenceHash, HEX64, "evidence hash"),
      `${safe(observer, B58, "observer")}.json`,
    );
  #indexPath = (mandate: string, epoch: number, observer: string): string =>
    join(
      this.#root,
      "index",
      safe(mandate, B58, "mandate"),
      String(epoch),
      `${safe(observer, B58, "observer")}.json`,
    );

  async putSnapshot(snapshot: AccountSnapshot): Promise<string> {
    const sha = canonicalHash(snapshotToCanonical(snapshot));
    const path = this.#snapshotPath(sha);
    if ((await readIfExists(path)) === null) await writeDurably(path, JSON.stringify(snapshot));
    return sha;
  }

  async getSnapshot(sha256: string): Promise<AccountSnapshot | null> {
    const text = await readIfExists(this.#snapshotPath(sha256));
    if (text === null) return null;
    const snapshot = JSON.parse(text) as AccountSnapshot;
    if (canonicalHash(snapshotToCanonical(snapshot)) !== sha256) {
      throw new EvidenceConflictError(
        `snapshot ${sha256} on disk does not hash to its name: it was altered or corrupted`,
      );
    }
    return snapshot;
  }

  async putRecord(record: EvidenceRecord): Promise<void> {
    const path = this.#recordPath(record.evidenceHash, record.observer);
    const text = `${JSON.stringify(record, null, 1)}\n`;
    const existing = await readIfExists(path);
    if (existing !== null && existing !== text) {
      throw new EvidenceConflictError(
        `evidence for ${record.evidenceHash} by ${record.observer} already exists with different content`,
      );
    }
    if (existing === null) await writeDurably(path, text);

    const indexPath = this.#indexPath(record.mandate, record.epochIndex, record.observer);
    const index = `${JSON.stringify({ evidenceHash: record.evidenceHash })}\n`;
    const existingIndex = await readIfExists(indexPath);
    if (existingIndex !== null && existingIndex !== index) {
      throw new EvidenceConflictError(
        `this observer already holds different evidence for epoch ${String(record.epochIndex)} of ${record.mandate}`,
      );
    }
    if (existingIndex === null) await writeDurably(indexPath, index);
  }

  async getRecord(evidenceHash: string, observer: string): Promise<EvidenceRecord | null> {
    const text = await readIfExists(this.#recordPath(evidenceHash, observer));
    return text === null ? null : (JSON.parse(text) as EvidenceRecord);
  }

  async getAnyRecord(evidenceHash: string): Promise<EvidenceRecord | null> {
    const dir = join(this.#root, "records", safe(evidenceHash, HEX64, "evidence hash"));
    try {
      await stat(dir);
    } catch {
      return null;
    }
    for (const name of (await readdir(dir)).sort()) {
      const text = await readIfExists(join(dir, name));
      if (text !== null) return JSON.parse(text) as EvidenceRecord;
    }
    return null;
  }

  async getOwnRecord(
    mandate: string,
    epochIndex: number,
    observer: string,
  ): Promise<EvidenceRecord | null> {
    const index = await readIfExists(this.#indexPath(mandate, epochIndex, observer));
    if (index === null) return null;
    const { evidenceHash } = JSON.parse(index) as { evidenceHash: string };
    return this.getRecord(evidenceHash, observer);
  }
}

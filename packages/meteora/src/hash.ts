import { createHash } from "node:crypto";

/** SHA-256, lowercase hex. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

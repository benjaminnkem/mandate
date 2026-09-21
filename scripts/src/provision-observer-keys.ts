/**
 * Generate separate observer keypairs for a 2-of-3 deployment.
 *
 *   pnpm observers:provision [--count 3] [--dir .keys]
 *
 * Writes `<dir>/observer-N.json` (Solana CLI format) with mode 0600 and prints ONLY the public keys and the
 * environment lines to use. It never prints a secret, refuses to overwrite an existing file, and refuses to write
 * anywhere git would track. Fund each public key with a little SOL for attestation rent and fees; the keys hold
 * no protocol authority. Never reuse the program deploy key or the protocol admin key as an observer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair } from "@solana/web3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const count = Number(arg("count") ?? "3");
if (!Number.isInteger(count) || count < 1 || count > 5)
  throw new Error("--count must be between 1 and 5");
const dir = resolve(arg("dir") ?? ".keys");

// Refuse to write keys anywhere git would track them.
try {
  execFileSync("git", ["check-ignore", "-q", resolve(dir, "observer-1.json")], { stdio: "ignore" });
} catch {
  throw new Error(`${dir} is not git-ignored; refusing to write secret keys there`);
}

mkdirSync(dir, { recursive: true, mode: 0o700 });
const created: { id: string; pubkey: string; path: string }[] = [];
for (let n = 1; n <= count; n += 1) {
  const path = resolve(dir, `observer-${String(n)}.json`);
  if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite a key`);
}
for (let n = 1; n <= count; n += 1) {
  const path = resolve(dir, `observer-${String(n)}.json`);
  const keypair = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600, flag: "wx" });
  created.push({ id: `observer-${String(n)}`, pubkey: keypair.publicKey.toBase58(), path });
}

console.log(`Created ${String(count)} observer keys in ${dir} (mode 0600). Public keys:\n`);
for (const k of created) console.log(`  ${k.id}: ${k.pubkey}`);
console.log(
  "\nPer-instance environment (one file per process, e.g. apps/observer/.env.observer1, gitignored):\n",
);
for (const k of created) {
  console.log(`# ${k.id}`);
  console.log(`OBSERVER_INSTANCE_ID=${k.id}`);
  console.log(`OBSERVER_KEYPAIR_PATH=${k.path}`);
  console.log(`OBSERVER_EXPECTED_PUBKEY=${k.pubkey}\n`);
}
console.log(
  "Next: fund each public key with SOL, then create the observer set with these keys and a threshold (2 of 3).",
);

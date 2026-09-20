import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

import idlJson from "../idl/mandate.json" with { type: "json" };

/**
 * The program IDL, copied from `target/idl/mandate.json` (`pnpm idl:sync`). A Rust test fails if this copy
 * drifts from what the program build produces.
 */
export const MANDATE_IDL = idlJson as unknown as Idl;

/** The program id declared in the IDL (also `Anchor.toml` and `declare_id!`). */
export const MANDATE_PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

import { BorshInstructionCoder } from "@anchor-lang/core";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { MANDATE_IDL, MANDATE_PROGRAM_ID } from "./idl.ts";

const coder = new BorshInstructionCoder(MANDATE_IDL);

interface IdlAccount {
  readonly name: string;
  readonly writable?: boolean;
  readonly signer?: boolean;
  readonly address?: string;
}
interface IdlInstruction {
  readonly name: string;
  readonly accounts: readonly IdlAccount[];
}
const instructions = MANDATE_IDL.instructions as unknown as readonly IdlInstruction[];

/** A value the coder understands: JavaScript bigint becomes BN, structures are converted recursively. */
type Encodable =
  | bigint
  | number
  | boolean
  | string
  | PublicKey
  | Uint8Array
  | readonly Encodable[]
  | { readonly [key: string]: Encodable };

const camelToSnake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function toCoder(value: Encodable): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (value instanceof PublicKey || value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return (value as readonly Encodable[]).map(toCoder);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as { readonly [key: string]: Encodable }).map(([k, v]) => [
        camelToSnake(k),
        toCoder(v),
      ]),
    );
  }
  return value;
}

/**
 * Build an instruction from the IDL alone. Account order and signer/writable flags come from the IDL, so
 * they cannot drift from the program. Every non-fixed account must be supplied and nothing extra is
 * accepted, which catches both omissions and misspelled names at build time instead of on chain.
 */
export function buildInstruction(
  name: string,
  args: { readonly [argument: string]: Encodable },
  accounts: { readonly [account: string]: PublicKey },
  programId: PublicKey = MANDATE_PROGRAM_ID,
): TransactionInstruction {
  const definition = instructions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`unknown instruction ${name}`);

  const provided = new Set(Object.keys(accounts));
  const keys = definition.accounts.map((account) => {
    const supplied = accounts[account.name];
    const pubkey =
      supplied ?? (account.address === undefined ? undefined : new PublicKey(account.address));
    if (pubkey === undefined) throw new Error(`${name}: missing account ${account.name}`);
    provided.delete(account.name);
    return { pubkey, isSigner: account.signer === true, isWritable: account.writable === true };
  });
  if (provided.size > 0)
    throw new Error(`${name}: unexpected accounts ${[...provided].join(", ")}`);

  const encoded = Object.fromEntries(
    Object.entries(args).map(([k, v]) => [camelToSnake(k), toCoder(v)]),
  );
  const data = coder.encode(name, encoded);
  return new TransactionInstruction({ programId, keys, data });
}

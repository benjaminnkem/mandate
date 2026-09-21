import { PublicKey } from "@solana/web3.js";

import { BPF_LOADER_UPGRADEABLE_ID, MANDATE_PROGRAM_ID } from "./idl.ts";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function u32le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new RangeError("u32 out of range");
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64le(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError("u64 out of range");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

const derive = (seeds: Uint8Array[], programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

/** Every address in the protocol is derived from these seeds; nothing is chosen by a caller. */
export const findProtocolPda = (programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([utf8("protocol")], programId);

export const findObserverSetPda = (version: number, programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([utf8("observer_set"), u32le(version)], programId);

export const findMarketPda = (pool: PublicKey, programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([utf8("market"), pool.toBytes()], programId);

export const findMandatePda = (
  sponsor: PublicKey,
  mandateId: bigint,
  programId = MANDATE_PROGRAM_ID,
): PublicKey => derive([utf8("mandate"), sponsor.toBytes(), u64le(mandateId)], programId);

export const findVaultPda = (mandate: PublicKey, programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([utf8("vault"), mandate.toBytes()], programId);

/** The program's upgradeable-loader ProgramData account (its upgrade authority gates initialisation). */
export const findProgramDataPda = (programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([programId.toBytes()], BPF_LOADER_UPGRADEABLE_ID);

export const findBidPda = (
  mandate: PublicKey,
  provider: PublicKey,
  nonce: bigint,
  programId = MANDATE_PROGRAM_ID,
): PublicKey =>
  derive([utf8("bid"), mandate.toBytes(), provider.toBytes(), u64le(nonce)], programId);

export const findPositionSetPda = (mandate: PublicKey, programId = MANDATE_PROGRAM_ID): PublicKey =>
  derive([utf8("position_set"), mandate.toBytes()], programId);

export const findEpochResultPda = (
  mandate: PublicKey,
  epochIndex: number,
  programId = MANDATE_PROGRAM_ID,
): PublicKey => derive([utf8("epoch_result"), mandate.toBytes(), u32le(epochIndex)], programId);

export const findAttestationPda = (
  mandate: PublicKey,
  epochIndex: number,
  observer: PublicKey,
  programId = MANDATE_PROGRAM_ID,
): PublicKey =>
  derive(
    [utf8("attestation"), mandate.toBytes(), u32le(epochIndex), observer.toBytes()],
    programId,
  );

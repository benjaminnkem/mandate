import { PublicKey } from "@solana/web3.js";

import type { PositionInput } from "../algorithm/contribution.ts";
import type { DLMMInstance } from "../sdk.ts";

/** The fields of a decoded DLMM `PositionV2` account that attribution depends on. */
interface DecodedPositionV2 {
  lbPair: PublicKey;
  owner: PublicKey;
  operator: PublicKey;
  feeOwner: PublicKey;
  lowerBinId: number;
  upperBinId: number;
}

/**
 * Read one registered position into a `PositionInput`.
 *
 * Classification (docs/adr/0008): an account that does not exist is `missing`; one that exists but is
 * not a `PositionV2` of the DLMM program is `invalid` (unsupported position types fail closed). Both
 * contribute zero and say why. A *read failure* (RPC or decode error while reading a real position)
 * is not classified at all: it propagates, because an unreadable position must never be scored as
 * "the provider has no liquidity".
 */
export async function loadPosition(dlmm: DLMMInstance, address: string): Promise<PositionInput> {
  const key = new PublicKey(address);
  const info = await dlmm.program.provider.connection.getAccountInfo(key);
  if (info === null) return { kind: "missing", address };
  if (!info.owner.equals(dlmm.program.programId)) {
    return { kind: "invalid", address, reason: "account is not owned by the DLMM program" };
  }

  let decoded: DecodedPositionV2;
  try {
    decoded = dlmm.program.coder.accounts.decode<DecodedPositionV2>("positionV2", info.data);
  } catch {
    return { kind: "invalid", address, reason: "account is not a PositionV2" };
  }

  const position = await dlmm.getPosition(key);
  const data = position.positionData;
  return {
    kind: "loaded",
    address,
    lbPair: decoded.lbPair.toBase58(),
    owner: decoded.owner.toBase58(),
    operator: decoded.operator.toBase58(),
    feeOwner: decoded.feeOwner.toBase58(),
    lowerBinId: decoded.lowerBinId,
    upperBinId: decoded.upperBinId,
    bins: data.positionBinData.map((bin) => ({
      binId: bin.binId,
      xAmount: BigInt(bin.positionXAmount),
      yAmount: BigInt(bin.positionYAmount),
    })),
  };
}

export async function loadPositions(
  dlmm: DLMMInstance,
  addresses: readonly string[],
): Promise<PositionInput[]> {
  const out: PositionInput[] = [];
  for (const address of addresses) out.push(await loadPosition(dlmm, address));
  return out;
}

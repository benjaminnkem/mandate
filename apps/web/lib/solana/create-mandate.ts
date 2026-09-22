import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import {
  createMandate,
  decodeAccount,
  findProtocolPda,
  type ProtocolConfigAccount,
} from "@mandate/solana";

import { amountPair } from "../format.ts";
import { getConnection } from "./connection.ts";
import type { PreparedTransaction } from "./transactions.ts";
import { myUsdcAta } from "./usdc.ts";

/** `POST /v1/tx/*` builds every other write; this one reads the protocol account directly and builds the
 * instruction locally, because creating a mandate needs the protocol's current observer set version and its
 * USDC mint, and there is no dedicated API endpoint for it (docs/adr — left to the web client). */
export async function loadProtocolConfig(): Promise<ProtocolConfigAccount> {
  const connection = getConnection();
  const info = await connection.getAccountInfo(findProtocolPda());
  if (!info) throw new Error("The protocol has not been initialized on this cluster yet.");
  return decodeAccount<ProtocolConfigAccount>("ProtocolConfig", info.data);
}

export interface CreateMandateInput {
  readonly sponsor: PublicKey;
  readonly pool: PublicKey;
  readonly mandateId: bigint;
  readonly maxRewardRaw: bigint;
  readonly biddingEndsAt: bigint;
  readonly startAt: bigint;
  readonly epochSeconds: bigint;
  readonly totalEpochs: number;
  readonly maxEffectiveSpreadBps: number;
  readonly depthBandBps: number;
  readonly minPoolBuyDepthQuoteRaw: bigint;
  readonly minPoolSellDepthQuoteRaw: bigint;
  readonly minProviderQuoteInBandRaw: bigint;
  readonly minProviderBaseQuoteEqInBandRaw: bigint;
  readonly probeQuoteRaw: bigint;
}

/** Build the `create_mandate` instruction (plus an idempotent create-ATA so a first-time sponsor never fails
 * only for lacking a USDC token account) and its exact economic summary. */
export function prepareCreateMandate(
  protocol: ProtocolConfigAccount,
  input: CreateMandateInput,
): PreparedTransaction {
  const sponsorUsdc = myUsdcAta(input.sponsor);
  const durationSeconds = input.epochSeconds * BigInt(input.totalEpochs);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    input.sponsor,
    sponsorUsdc,
    input.sponsor,
    protocol.usdcMint,
  );
  const ix = createMandate({
    sponsor: input.sponsor,
    sponsorUsdc,
    pool: input.pool,
    usdcMint: protocol.usdcMint,
    observerSetVersion: protocol.currentObserverSetVersion,
    terms: {
      mandateId: input.mandateId,
      maxRewardRaw: input.maxRewardRaw,
      biddingEndsAt: input.biddingEndsAt,
      startAt: input.startAt,
      durationSeconds,
      epochSeconds: input.epochSeconds,
      maxEffectiveSpreadBps: input.maxEffectiveSpreadBps,
      depthBandBps: input.depthBandBps,
      minPoolBuyDepthQuoteRaw: input.minPoolBuyDepthQuoteRaw,
      minPoolSellDepthQuoteRaw: input.minPoolSellDepthQuoteRaw,
      minProviderQuoteInBandRaw: input.minProviderQuoteInBandRaw,
      minProviderBaseQuoteEqInBandRaw: input.minProviderBaseQuoteEqInBandRaw,
      probeQuoteRaw: input.probeQuoteRaw,
    },
  });
  return {
    bundle: { feePayer: input.sponsor, instructions: [createAtaIx, ix] },
    summary: {
      pool: input.pool.toBase58(),
      maxReward: amountPair(input.maxRewardRaw.toString()),
      epochs: input.totalEpochs,
      epochSeconds: Number(input.epochSeconds),
      startsAt: new Date(Number(input.startAt) * 1000).toLocaleString(),
      biddingEndsAt: new Date(Number(input.biddingEndsAt) * 1000).toLocaleString(),
      maxEffectiveSpreadBps: input.maxEffectiveSpreadBps,
      probeSize: amountPair(input.probeQuoteRaw.toString()),
      irreversible:
        "This escrows the maximum reward immediately and fixes the schedule and every threshold permanently; none of it can be edited afterward.",
    },
  };
}

import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { buildInstruction } from "./build.ts";
import { MANDATE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./idl.ts";
import {
  findBidPda,
  findMandatePda,
  findMarketPda,
  findObserverSetPda,
  findProgramDataPda,
  findProtocolPda,
  findVaultPda,
} from "./pda.ts";

interface Common {
  readonly programId?: PublicKey;
}
const pid = (c: Common): PublicKey => c.programId ?? MANDATE_PROGRAM_ID;

/** Every economic term a sponsor chooses. Amounts and timestamps are `bigint`; bps are `number`. */
export interface CreateMandateTerms {
  readonly mandateId: bigint;
  readonly maxRewardRaw: bigint;
  readonly biddingEndsAt: bigint;
  readonly startAt: bigint;
  readonly durationSeconds: bigint;
  readonly epochSeconds: bigint;
  readonly maxEffectiveSpreadBps: number;
  readonly depthBandBps: number;
  readonly minPoolBuyDepthQuoteRaw: bigint;
  readonly minPoolSellDepthQuoteRaw: bigint;
  readonly minProviderQuoteInBandRaw: bigint;
  readonly minProviderBaseQuoteEqInBandRaw: bigint;
  readonly probeQuoteRaw: bigint;
}

export interface InitializeProtocolTerms {
  readonly admin: PublicKey;
  readonly dlmmProgram: PublicKey;
  readonly minBudgetRaw: bigint;
  readonly maxBudgetRaw: bigint;
  readonly minEpochSeconds: bigint;
  readonly maxEpochSeconds: bigint;
  readonly maxDurationSeconds: bigint;
  readonly maxEpochs: number;
  readonly maxSpreadBps: number;
  readonly maxDepthBandBps: number;
  readonly maxPositions: number;
  readonly minProbeQuoteRaw: bigint;
  readonly maxProbeQuoteRaw: bigint;
  readonly minStartLeadSeconds: bigint;
  readonly positionLockBufferSeconds: bigint;
  readonly minSetupWindowSeconds: bigint;
  readonly unavailableRecoverySeconds: bigint;
}

export function initializeProtocol(
  p: Common & {
    payer: PublicKey;
    upgradeAuthority: PublicKey;
    usdcMint: PublicKey;
    usdcTokenProgram?: PublicKey;
    terms: InitializeProtocolTerms;
  },
): TransactionInstruction {
  return buildInstruction(
    "initialize_protocol",
    { args: { ...p.terms } },
    {
      payer: p.payer,
      upgrade_authority: p.upgradeAuthority,
      protocol: findProtocolPda(pid(p)),
      usdc_mint: p.usdcMint,
      usdc_token_program: p.usdcTokenProgram ?? TOKEN_PROGRAM_ID,
      program: pid(p),
      program_data: findProgramDataPda(pid(p)),
    },
    pid(p),
  );
}

const adminAccounts = (p: Common & { admin: PublicKey }): { [account: string]: PublicKey } => ({
  protocol: findProtocolPda(pid(p)),
  admin: p.admin,
});

export const proposeAdmin = (
  p: Common & { admin: PublicKey; newAdmin: PublicKey },
): TransactionInstruction =>
  buildInstruction("propose_admin", { newAdmin: p.newAdmin }, adminAccounts(p), pid(p));

export const cancelAdminTransfer = (p: Common & { admin: PublicKey }): TransactionInstruction =>
  buildInstruction("cancel_admin_transfer", {}, adminAccounts(p), pid(p));

export const setPausedNewRisk = (
  p: Common & { admin: PublicKey; paused: boolean },
): TransactionInstruction =>
  buildInstruction("set_paused_new_risk", { paused: p.paused }, adminAccounts(p), pid(p));

export const acceptAdmin = (p: Common & { pendingAdmin: PublicKey }): TransactionInstruction =>
  buildInstruction(
    "accept_admin",
    {},
    { protocol: findProtocolPda(pid(p)), pending_admin: p.pendingAdmin },
    pid(p),
  );

export function createObserverSet(
  p: Common & {
    admin: PublicKey;
    observers: readonly PublicKey[];
    threshold: number;
    nextVersion: number;
  },
): TransactionInstruction {
  return buildInstruction(
    "create_observer_set",
    { observers: [...p.observers], threshold: p.threshold },
    {
      admin: p.admin,
      protocol: findProtocolPda(pid(p)),
      observer_set: findObserverSetPda(p.nextVersion, pid(p)),
    },
    pid(p),
  );
}

export function upsertMarket(
  p: Common & {
    admin: PublicKey;
    pool: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    prestocksMetadataHash: Uint8Array;
  },
): TransactionInstruction {
  if (p.prestocksMetadataHash.length !== 32) throw new RangeError("metadata hash must be 32 bytes");
  return buildInstruction(
    "upsert_market",
    { prestocksMetadataHash: p.prestocksMetadataHash },
    {
      admin: p.admin,
      protocol: findProtocolPda(pid(p)),
      pool: p.pool,
      base_mint: p.baseMint,
      quote_mint: p.quoteMint,
      market: findMarketPda(p.pool, pid(p)),
    },
    pid(p),
  );
}

export function setMarketEnabled(
  p: Common & { admin: PublicKey; pool: PublicKey; enabled: boolean },
): TransactionInstruction {
  return buildInstruction(
    "set_market_enabled",
    { enabled: p.enabled },
    { admin: p.admin, protocol: findProtocolPda(pid(p)), market: findMarketPda(p.pool, pid(p)) },
    pid(p),
  );
}

export function createMandate(
  p: Common & {
    sponsor: PublicKey;
    sponsorUsdc: PublicKey;
    pool: PublicKey;
    usdcMint: PublicKey;
    /** `current_observer_set_version` read from the protocol account. */
    observerSetVersion: number;
    tokenProgram?: PublicKey;
    terms: CreateMandateTerms;
  },
): TransactionInstruction {
  const mandate = findMandatePda(p.sponsor, p.terms.mandateId, pid(p));
  return buildInstruction(
    "create_mandate",
    { args: { ...p.terms } },
    {
      sponsor: p.sponsor,
      protocol: findProtocolPda(pid(p)),
      market: findMarketPda(p.pool, pid(p)),
      observer_set: findObserverSetPda(p.observerSetVersion, pid(p)),
      usdc_mint: p.usdcMint,
      token_program: p.tokenProgram ?? TOKEN_PROGRAM_ID,
      sponsor_usdc: p.sponsorUsdc,
      mandate,
      vault: findVaultPda(mandate, pid(p)),
    },
    pid(p),
  );
}

export function cancelUnawardedMandate(
  p: Common & {
    sponsor: PublicKey;
    sponsorUsdc: PublicKey;
    mandateId: bigint;
    usdcMint: PublicKey;
    tokenProgram?: PublicKey;
  },
): TransactionInstruction {
  const mandate = findMandatePda(p.sponsor, p.mandateId, pid(p));
  return buildInstruction(
    "cancel_unawarded_mandate",
    {},
    {
      sponsor: p.sponsor,
      protocol: findProtocolPda(pid(p)),
      mandate,
      usdc_mint: p.usdcMint,
      token_program: p.tokenProgram ?? TOKEN_PROGRAM_ID,
      vault: findVaultPda(mandate, pid(p)),
      sponsor_usdc: p.sponsorUsdc,
    },
    pid(p),
  );
}

export function submitBid(
  p: Common & {
    provider: PublicKey;
    mandate: PublicKey;
    nonce: bigint;
    requestedRewardRaw: bigint;
    validUntil: bigint;
  },
): TransactionInstruction {
  return buildInstruction(
    "submit_bid",
    { nonce: p.nonce, requestedRewardRaw: p.requestedRewardRaw, validUntil: p.validUntil },
    {
      provider: p.provider,
      protocol: findProtocolPda(pid(p)),
      mandate: p.mandate,
      bid: findBidPda(p.mandate, p.provider, p.nonce, pid(p)),
    },
    pid(p),
  );
}

export function cancelBid(
  p: Common & { provider: PublicKey; mandate: PublicKey; nonce: bigint },
): TransactionInstruction {
  return buildInstruction(
    "cancel_bid",
    {},
    { provider: p.provider, bid: findBidPda(p.mandate, p.provider, p.nonce, pid(p)) },
    pid(p),
  );
}

export function closeBid(
  p: Common & { provider: PublicKey; mandate: PublicKey; nonce: bigint },
): TransactionInstruction {
  return buildInstruction(
    "close_bid",
    {},
    {
      provider: p.provider,
      bid: findBidPda(p.mandate, p.provider, p.nonce, pid(p)),
      mandate: p.mandate,
    },
    pid(p),
  );
}

export function acceptBid(
  p: Common & { sponsor: PublicKey; mandate: PublicKey; provider: PublicKey; nonce: bigint },
): TransactionInstruction {
  return buildInstruction(
    "accept_bid",
    {},
    {
      sponsor: p.sponsor,
      protocol: findProtocolPda(pid(p)),
      mandate: p.mandate,
      bid: findBidPda(p.mandate, p.provider, p.nonce, pid(p)),
    },
    pid(p),
  );
}

export function withdrawSurplusAfterAward(
  p: Common & {
    sponsor: PublicKey;
    sponsorUsdc: PublicKey;
    mandate: PublicKey;
    usdcMint: PublicKey;
    amountRaw: bigint;
    tokenProgram?: PublicKey;
  },
): TransactionInstruction {
  return buildInstruction(
    "withdraw_surplus_after_award",
    { amountRaw: p.amountRaw },
    {
      sponsor: p.sponsor,
      protocol: findProtocolPda(pid(p)),
      mandate: p.mandate,
      usdc_mint: p.usdcMint,
      token_program: p.tokenProgram ?? TOKEN_PROGRAM_ID,
      vault: findVaultPda(p.mandate, pid(p)),
      sponsor_usdc: p.sponsorUsdc,
    },
    pid(p),
  );
}

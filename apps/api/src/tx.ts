import {
  claimableRaw,
  sponsorWithdrawableRaw,
  splitReward,
  type AccountingState,
} from "@mandate/domain";
import {
  MANDATE_PROGRAM_ID,
  acceptBid,
  claimProviderReward,
  decodeAccount,
  findBidPda,
  registerPositions,
  submitBid,
  withdrawSurplusAfterAward,
  type MandateAccount,
} from "@mandate/solana";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiDeps } from "./deps.ts";
import { HttpError, address, amountPair } from "./http.ts";

const raw = z
  .string()
  .regex(/^\d{1,20}$/, "must be a non-negative integer in raw units")
  .transform(BigInt);
const wallet = address.transform((v) => new PublicKey(v));

type Account = Record<string, unknown>;
const field = (a: Account, k: string): bigint => BigInt(String(a[k]));

async function loadMandate(
  deps: ApiDeps,
  key: PublicKey,
): Promise<{ typed: MandateAccount; raw: Account }> {
  const info = await deps.chain.getAccount(key);
  if (!info || info.owner !== deps.config.programId)
    throw new HttpError(
      404,
      "mandate_not_found",
      `${key.toBase58()} is not a mandate of this program`,
    );
  const decoded = decodeAccount<MandateAccount>("Mandate", info.data);
  return { typed: decoded, raw: decoded as unknown as Account };
}

const accountingOf = (m: MandateAccount): AccountingState => m;

/** SPL token account layout: mint 0..32, owner 32..64. The destination must be a USDC account the wallet owns. */
async function requireOwnUsdcAccount(
  deps: ApiDeps,
  account: PublicKey,
  owner: PublicKey,
): Promise<void> {
  const info = await deps.chain.getAccount(account);
  if (!info || info.data.length < 165)
    throw new HttpError(
      400,
      "invalid_destination",
      "destination is not an initialized token account",
    );
  const mint = new PublicKey(info.data.subarray(0, 32)).toBase58();
  const holder = new PublicKey(info.data.subarray(32, 64)).toBase58();
  if (mint !== deps.config.usdcMint)
    throw new HttpError(400, "invalid_destination", "destination is not a USDC account");
  if (holder !== owner.toBase58())
    throw new HttpError(
      400,
      "invalid_destination",
      "destination is not owned by the signing wallet",
    );
}

interface Built {
  readonly ix: TransactionInstruction;
  readonly feePayer: PublicKey;
  readonly summary: Record<string, unknown>;
}

/**
 * Build the unsigned transaction and a human-readable economic summary. The server never signs and never holds a
 * key: the wallet does. Every number in the summary is recomputed from chain state here, not taken from the request.
 */
async function respond(deps: ApiDeps, built: Built): Promise<unknown> {
  const { blockhash, lastValidBlockHeight } = await deps.chain.getLatestBlockhash();
  const tx = new Transaction({ feePayer: built.feePayer, blockhash, lastValidBlockHeight }).add(
    built.ix,
  );
  const message = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transaction: message.toString("base64"),
    encoding: "base64-legacy-transaction-unsigned",
    signer: built.feePayer.toBase58(),
    // The blockhash is short-lived: after this block height the transaction can no longer land.
    expiresAfterBlockHeight: lastValidBlockHeight,
    network: { cluster: deps.config.cluster, programId: deps.config.programId },
    summary: built.summary,
    notice:
      "Review the summary against what your wallet displays before signing. This server cannot sign for you.",
  };
}

export function registerTxRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const pid = new PublicKey(deps.config.programId);
  if (!pid.equals(MANDATE_PROGRAM_ID))
    throw new Error("configured program id does not match the compiled IDL");
  const usdcMint = new PublicKey(deps.config.usdcMint);

  app.post("/v1/tx/claim", async (req) => {
    const body = z
      .object({ wallet, mandate: wallet, destinationUsdc: wallet, amountRaw: raw })
      .parse(req.body);
    const { typed, raw: m } = await loadMandate(deps, body.mandate);
    if (typed.provider.toBase58() !== body.wallet.toBase58())
      throw new HttpError(403, "not_provider", "only the accepted provider can claim");
    const claimable = claimableRaw(accountingOf(typed));
    if (body.amountRaw === 0n || body.amountRaw > claimable)
      throw new HttpError(
        422,
        "amount_out_of_range",
        `claimable now is ${claimable.toString()} raw`,
      );
    await requireOwnUsdcAccount(deps, body.destinationUsdc, body.wallet);
    return respond(deps, {
      feePayer: body.wallet,
      ix: claimProviderReward({
        provider: body.wallet,
        providerUsdc: body.destinationUsdc,
        mandate: body.mandate,
        usdcMint,
        amountRaw: body.amountRaw,
      }),
      summary: {
        action: "Claim earned reward",
        mandate: body.mandate.toBase58(),
        youReceive: amountPair(body.amountRaw.toString()),
        claimableNow: amountPair(claimable.toString()),
        remainingClaimableAfter: amountPair((claimable - body.amountRaw).toString()),
        destination: body.destinationUsdc.toBase58(),
        irreversible:
          "USDC moves out of the escrow vault to your account immediately and cannot be recalled.",
        status: String(m["status"]),
      },
    });
  });

  app.post("/v1/tx/withdraw", async (req) => {
    const body = z
      .object({ wallet, mandate: wallet, destinationUsdc: wallet, amountRaw: raw })
      .parse(req.body);
    const { typed } = await loadMandate(deps, body.mandate);
    if (typed.sponsor.toBase58() !== body.wallet.toBase58())
      throw new HttpError(403, "not_sponsor", "only the sponsor can withdraw");
    const available = sponsorWithdrawableRaw(accountingOf(typed));
    if (body.amountRaw === 0n || body.amountRaw > available)
      throw new HttpError(
        422,
        "amount_out_of_range",
        `withdrawable now is ${available.toString()} raw`,
      );
    await requireOwnUsdcAccount(deps, body.destinationUsdc, body.wallet);
    return respond(deps, {
      feePayer: body.wallet,
      ix: withdrawSurplusAfterAward({
        sponsor: body.wallet,
        sponsorUsdc: body.destinationUsdc,
        mandate: body.mandate,
        usdcMint,
        amountRaw: body.amountRaw,
      }),
      summary: {
        action: "Withdraw released funds",
        mandate: body.mandate.toBase58(),
        youReceive: amountPair(body.amountRaw.toString()),
        withdrawableNow: amountPair(available.toString()),
        rule: "Only the award surplus, and forfeited rewards once every epoch is resolved, can ever be withdrawn. Earned provider rewards never can.",
        irreversible: "USDC moves out of the escrow vault to your account immediately.",
      },
    });
  });

  app.post("/v1/tx/submit-bid", async (req) => {
    const body = z
      .object({
        wallet,
        mandate: wallet,
        nonce: raw,
        requestedRewardRaw: raw,
        validUntil: z.coerce.bigint(),
      })
      .parse(req.body);
    const { typed, raw: m } = await loadMandate(deps, body.mandate);
    if (typed.status !== "Bidding")
      throw new HttpError(409, "not_bidding", `mandate is ${typed.status}`);
    const max = typed.maxRewardRaw;
    if (body.requestedRewardRaw === 0n || body.requestedRewardRaw > max)
      throw new HttpError(
        422,
        "amount_out_of_range",
        `the mandate's maximum reward is ${max.toString()} raw`,
      );
    const now = BigInt(Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000));
    if (body.validUntil <= now) throw new HttpError(422, "expired", "validUntil is in the past");
    const split = splitReward(body.requestedRewardRaw, typed.totalEpochs);
    return respond(deps, {
      feePayer: body.wallet,
      ix: submitBid({
        provider: body.wallet,
        mandate: body.mandate,
        nonce: body.nonce,
        requestedRewardRaw: body.requestedRewardRaw,
        validUntil: body.validUntil,
      }),
      summary: {
        action: "Submit bid",
        mandate: body.mandate.toBase58(),
        bid: findBidPda(body.mandate, body.wallet, body.nonce).toBase58(),
        requestedReward: amountPair(body.requestedRewardRaw.toString()),
        perEpochReward: amountPair(split.base.toString()),
        finalEpochExtra: amountPair(split.extra.toString()),
        epochs: typed.totalEpochs,
        biddingEndsAt: String(field(m, "biddingEndsAt")),
        irreversible:
          "A bid moves no funds (only account rent). You can cancel it until it is accepted; if accepted you are committed to the SLA.",
      },
    });
  });

  app.post("/v1/tx/accept-bid", async (req) => {
    const body = z
      .object({ wallet, mandate: wallet, provider: wallet, nonce: raw })
      .parse(req.body);
    const { typed, raw: m } = await loadMandate(deps, body.mandate);
    if (typed.sponsor.toBase58() !== body.wallet.toBase58())
      throw new HttpError(403, "not_sponsor", "only the sponsor can award");
    if (typed.status !== "Bidding")
      throw new HttpError(409, "not_bidding", `mandate is ${typed.status}`);
    const bidKey = findBidPda(body.mandate, body.provider, body.nonce);
    const bidInfo = await deps.chain.getAccount(bidKey);
    if (!bidInfo) throw new HttpError(404, "bid_not_found", `no bid ${bidKey.toBase58()}`);
    const bid = decodeAccount<Account>("Bid", bidInfo.data);
    if (bid["status"] !== "Active")
      throw new HttpError(409, "bid_not_active", `bid is ${String(bid["status"])}`);
    const requested = field(bid, "requestedRewardRaw");
    const split = splitReward(requested, typed.totalEpochs);
    return respond(deps, {
      feePayer: body.wallet,
      ix: acceptBid({
        sponsor: body.wallet,
        mandate: body.mandate,
        provider: body.provider,
        nonce: body.nonce,
      }),
      summary: {
        action: "Award mandate to this provider",
        mandate: body.mandate.toBase58(),
        provider: body.provider.toBase58(),
        acceptedReward: amountPair(requested.toString()),
        surplusReleasedToYou: amountPair((typed.maxRewardRaw - requested).toString()),
        perEpochReward: amountPair(split.base.toString()),
        finalEpochExtra: amountPair(split.extra.toString()),
        epochs: typed.totalEpochs,
        acceptanceCutoff: String(field(m, "acceptanceCutoff")),
        irreversible:
          "Awarding fixes the provider, reward and schedule permanently. The escrow stays locked to the terms.",
      },
    });
  });

  app.post("/v1/tx/register-positions", async (req) => {
    const body = z
      .object({ wallet, mandate: wallet, positions: z.array(wallet).min(1).max(8) })
      .parse(req.body);
    const { typed, raw: m } = await loadMandate(deps, body.mandate);
    if (typed.provider.toBase58() !== body.wallet.toBase58())
      throw new HttpError(403, "not_provider", "only the accepted provider can register positions");
    if (typed.status !== "Awarded")
      throw new HttpError(409, "not_awarded", `mandate is ${typed.status}`);
    const now = BigInt(Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000));
    const lock = field(m, "positionLockAt");
    if (now >= lock)
      throw new HttpError(
        409,
        "position_set_locked",
        `the position set locked at ${lock.toString()}`,
      );
    const unique = new Set(body.positions.map((p) => p.toBase58()));
    if (unique.size !== body.positions.length)
      throw new HttpError(422, "duplicate_position", "positions must be distinct");
    return respond(deps, {
      feePayer: body.wallet,
      ix: registerPositions({
        provider: body.wallet,
        mandate: body.mandate,
        positions: body.positions,
      }),
      summary: {
        action: "Register the positions that will be measured",
        mandate: body.mandate.toBase58(),
        positions: body.positions.map((p) => p.toBase58()),
        locksAt: lock.toString(),
        notice:
          "The program stores these keys but does not verify you own them. Observers measure ownership; a position you do not own counts as zero.",
        irreversible: "After the lock time the set can never change for this mandate's whole life.",
      },
    });
  });
}

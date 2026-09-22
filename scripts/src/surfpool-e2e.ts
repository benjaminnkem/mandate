/**
 * Prompt 13 rehearsal driver: the administrative and lifecycle instructions that have no dedicated CLI yet
 * (initialize_protocol, create_observer_set, upsert_market, set_market_enabled, create_mandate, submit_bid,
 * accept_bid, register_positions, activate_mandate, finalize_epoch, finalize_unavailable_epoch,
 * withdraw_surplus_after_award, claim_provider_reward, close_mandate). Every read/write goes through the real
 * compiled program and the real (forked) chain; nothing here fabricates a pool or a measurement result.
 *
 * Two Surfpool cheats are used, both only ever on OUR OWN test accounts, never the pool's or the mint's:
 *   - `surfnet_setTokenAccount` sets a balance on our own wallets' token accounts, so they have something
 *     real to bid, register positions, and be paid with.
 *   - `surfnet_setAccount` pre-registers a brand-new PDA/account as "known locally, does not exist yet"
 *     (0 lamports) immediately before the transaction that creates it. Surfpool's fork otherwise tries to
 *     resolve every referenced pubkey against the upstream mainnet RPC before allowing local account
 *     creation, and that lookup was unreliable against the free public endpoint during this rehearsal
 *     (see docs/runbooks/surfpool-e2e.md, "Observed limitations"); this sidesteps exactly that one lookup
 *     for accounts that provably cannot exist on real mainnet (their own seeds are derived from this
 *     rehearsal's own fresh keys). It changes no program logic or pool state.
 *
 * Usage: SOLANA_RPC_HTTP_URL=<url> node scripts/src/surfpool-e2e.ts <command> [--flag value ...]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  acceptBid,
  activateMandate,
  claimProviderReward,
  closeMandate,
  createMandate,
  createObserverSet,
  decodeAccount,
  findAttestationPda,
  findBidPda,
  findEpochResultPda,
  findMandatePda,
  findMarketPda,
  findObserverSetPda,
  findPositionSetPda,
  findProtocolPda,
  findVaultPda,
  finalizeEpoch,
  finalizeUnavailableEpoch,
  initializeProtocol,
  registerPositions,
  setMarketEnabled,
  submitAttestation,
  submitBid,
  upsertMarket,
  withdrawSurplusAfterAward,
  type EpochAttestationAccount,
  type MandateAccount,
  type ProtocolConfigAccount,
} from "@mandate/solana";
import { DLMM, meteoraSdk } from "@mandate/meteora";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

const RPC = process.env["SOLANA_RPC_HTTP_URL"] ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC, "confirmed");

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const DLMM_PROGRAM = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
export const POOL = new PublicKey("4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH");
export const BASE_MINT = new PublicKey("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF");
const MANDATE_ID = BigInt(process.env["MANDATE_ID"] ?? "1");

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const readKeypair = (path: string): Keypair =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));

const ROLE_PATHS: Record<string, string> = {
  admin: `${process.env["HOME"]}/.config/solana/id.json`,
  sponsor: `${repoRoot}.keys/surfpool-e2e/sponsor.json`,
  "provider-a": `${repoRoot}.keys/surfpool-e2e/provider-a.json`,
  "provider-b": `${repoRoot}.keys/surfpool-e2e/provider-b.json`,
  "observer-1": `${repoRoot}scripts/.keys/observer-1.json`,
  "observer-2": `${repoRoot}scripts/.keys/observer-2.json`,
  "observer-3": `${repoRoot}scripts/.keys/observer-3.json`,
};
const role = (name: string): Keypair => {
  const path = ROLE_PATHS[name];
  if (!path) throw new Error(`unknown role ${name}`);
  return readKeypair(path);
};

interface RpcResponse {
  readonly error?: { readonly message: string };
}
async function rpcCall(method: string, params: unknown[]): Promise<void> {
  const result = await (
    connection as unknown as { _rpcRequest: (m: string, p: unknown[]) => Promise<RpcResponse> }
  )._rpcRequest(method, params);
  if (result.error) throw new Error(`${method} failed: ${result.error.message}`);
}

/** Pre-register brand-new PDAs/accounts as "known locally, does not exist" right before the transaction that
 * creates them; see the file header for why this is needed and what it does and does not touch. */
export async function preEmpty(...pubkeys: readonly PublicKey[]): Promise<void> {
  for (const pk of pubkeys)
    await rpcCall("surfnet_setAccount", [
      pk.toBase58(),
      {
        lamports: 0,
        data: "",
        owner: "11111111111111111111111111111111",
        executable: false,
        rentEpoch: 0,
      },
    ]);
}

async function send(
  ixs: TransactionInstruction[],
  signers: Keypair[],
  label: string,
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
  console.log(`[${label}] ${sig}`);
  return sig;
}

/** Confirms a signature already submitted outside `send()` (e.g. by the vendor DLMM SDK), using the
 * non-deprecated blockhash-strategy overload. */
async function confirm(sig: string): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
}

async function airdrop(pubkey: PublicKey, minLamports = 5_000_000_000): Promise<void> {
  const balance = await connection.getBalance(pubkey, "confirmed");
  if (balance >= minLamports) return;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const sig = await connection.requestAirdrop(pubkey, minLamports - balance);
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log(`[airdrop] ${pubkey.toBase58()} -> ${sig}`);
}

/** PreStocks base mints are Token-2022 (docs/research/current-market.md); USDC is the classic SPL token. */
const tokenProgramFor = (mint: PublicKey): PublicKey =>
  mint.equals(BASE_MINT) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

/** `surfnet_setTokenAccount` always derives and writes the CLASSIC SPL-Token-program ATA for the given
 * owner/mint, silently ignoring which program the account is actually owned by. For a Token-2022 mint (our
 * PreStocks base mint) that silently creates/updates an unrelated phantom account while the real ATA (owned by
 * the Token-2022 program, at a different address) stays at zero. Confirmed by reading both addresses back after
 * the cheat call. Worked around by patching the real account's amount field (bytes 64..72, u64 LE, same offset
 * in both the classic and base Token-2022 layouts) directly via `surfnet_setAccount`, preserving every other
 * byte (mint, owner, delegate, and any Token-2022 extension TLV data already appended past byte 165). */
async function setTokenAccountAmount(
  ata: PublicKey,
  amountRaw: bigint,
  owner: PublicKey,
): Promise<void> {
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) throw new Error(`token account ${ata.toBase58()} does not exist yet`);
  const data = Buffer.from(info.data);
  data.writeBigUInt64LE(amountRaw, 64);
  await rpcCall("surfnet_setAccount", [
    ata.toBase58(),
    {
      lamports: info.lamports,
      data: data.toString("hex"),
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
    },
  ]);
}

/** Set a real balance on OUR test wallet's own token account. Never the pool's reserves or the mint's supply. */
async function fundToken(
  owner: PublicKey,
  mint: PublicKey,
  amountRaw: bigint,
  tokenProgram = tokenProgramFor(mint),
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) {
    await preEmpty(ata);
    await send(
      [
        createAssociatedTokenAccountIdempotentInstruction(
          role("admin").publicKey,
          ata,
          owner,
          mint,
          tokenProgram,
        ),
      ],
      [role("admin")],
      "create-ata",
    );
  }
  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    await setTokenAccountAmount(ata, amountRaw, tokenProgram);
  } else {
    await rpcCall("surfnet_setTokenAccount", [
      owner.toBase58(),
      mint.toBase58(),
      { amount: Number(amountRaw) },
    ]);
  }
  console.log(
    `[fund-token] ${owner.toBase58()} (${mint.toBase58()}) ATA ${ata.toBase58()} = ${amountRaw.toString()} raw`,
  );
  return ata;
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const requiredArg = (name: string): string => {
  const v = arg(name);
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
};

const mandateAddress = (): PublicKey => findMandatePda(role("sponsor").publicKey, MANDATE_ID);

async function loadMandate(): Promise<MandateAccount> {
  const info = await connection.getAccountInfo(mandateAddress(), "confirmed");
  if (!info) throw new Error("mandate does not exist yet; run create-mandate first");
  return decodeAccount<MandateAccount>("Mandate", info.data);
}
async function loadProtocol(): Promise<ProtocolConfigAccount> {
  const info = await connection.getAccountInfo(findProtocolPda(), "confirmed");
  if (!info) throw new Error("protocol not initialized yet; run init-protocol first");
  return decodeAccount<ProtocolConfigAccount>("ProtocolConfig", info.data);
}

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "airdrop-roles": {
      for (const name of [
        "admin",
        "sponsor",
        "provider-a",
        "provider-b",
        "observer-1",
        "observer-2",
        "observer-3",
      ])
        await airdrop(role(name).publicKey);
      break;
    }

    case "fund-wallets": {
      // The sponsor needs USDC to escrow; the winning provider needs both legs to open a real DLMM position.
      await fundToken(role("sponsor").publicKey, USDC_MINT, 10_000_000_000n); // 10,000 USDC
      await fundToken(role("provider-a").publicKey, USDC_MINT, 200_000_000n); // 200 USDC
      await fundToken(role("provider-a").publicKey, BASE_MINT, 1_000_000_000n); // 1,000 base (9 decimals)
      break;
    }

    case "init-protocol": {
      const a = role("admin");
      await preEmpty(findProtocolPda());
      await send(
        [
          initializeProtocol({
            payer: a.publicKey,
            upgradeAuthority: a.publicKey,
            usdcMint: USDC_MINT,
            terms: {
              admin: a.publicKey,
              dlmmProgram: DLMM_PROGRAM,
              minBudgetRaw: 1_000_000n,
              maxBudgetRaw: 1_000_000_000_000n,
              minEpochSeconds: 60n,
              maxEpochSeconds: 3_600n,
              maxDurationSeconds: 2_592_000n,
              maxEpochs: 2016,
              maxSpreadBps: 10_000,
              maxDepthBandBps: 5_000,
              maxPositions: 8,
              minProbeQuoteRaw: 1_000_000n,
              maxProbeQuoteRaw: 1_000_000_000n,
              minStartLeadSeconds: 900n,
              positionLockBufferSeconds: 120n,
              minSetupWindowSeconds: 300n,
              unavailableRecoverySeconds: 900n,
            },
          }),
        ],
        [a],
        "init-protocol",
      );
      break;
    }

    case "create-observer-set": {
      const a = role("admin");
      const observers = [
        role("observer-1").publicKey,
        role("observer-2").publicKey,
        role("observer-3").publicKey,
      ];
      await preEmpty(findObserverSetPda(1));
      await send(
        [createObserverSet({ admin: a.publicKey, observers, threshold: 2, nextVersion: 1 })],
        [a],
        "create-observer-set",
      );
      break;
    }

    case "approve-market": {
      const a = role("admin");
      const metadataHash = new Uint8Array(32).fill(7);
      await preEmpty(findMarketPda(POOL));
      await send(
        [
          upsertMarket({
            admin: a.publicKey,
            pool: POOL,
            baseMint: BASE_MINT,
            quoteMint: USDC_MINT,
            prestocksMetadataHash: metadataHash,
          }),
          setMarketEnabled({ admin: a.publicKey, pool: POOL, enabled: true }),
        ],
        [a],
        "approve-market",
      );
      break;
    }

    case "create-mandate": {
      const s = role("sponsor");
      const sponsorUsdc = getAssociatedTokenAddressSync(USDC_MINT, s.publicKey);
      // The program gates timing against the ON-CHAIN clock sysvar (activate_mandate, finalize_epoch), which
      // drifts from wall-clock Date.now() under Surfpool (slot production isn't real-time); anchoring here to
      // the fork's own current time is what keeps every later timing check consistent with itself.
      const slot = await connection.getSlot("confirmed");
      const chainNow = await connection.getBlockTime(slot);
      if (chainNow === null) throw new Error("could not read on-chain time");
      const mandate = mandateAddress();
      await preEmpty(mandate, findVaultPda(mandate));
      await send(
        [
          createMandate({
            sponsor: s.publicKey,
            sponsorUsdc,
            pool: POOL,
            usdcMint: USDC_MINT,
            observerSetVersion: 1,
            terms: {
              mandateId: MANDATE_ID,
              maxRewardRaw: 900_000_000n, // 900 USDC
              biddingEndsAt: BigInt(chainNow + 600),
              startAt: BigInt(chainNow + 1_200),
              durationSeconds: 1_800n, // 6 epochs x 300s: room for compliant -> perturbed -> restored
              epochSeconds: 300n,
              maxEffectiveSpreadBps: 400,
              depthBandBps: 500,
              minPoolBuyDepthQuoteRaw: 1_000_000n,
              minPoolSellDepthQuoteRaw: 1_000_000n,
              minProviderQuoteInBandRaw: 1_000_000n,
              minProviderBaseQuoteEqInBandRaw: 1_000_000n,
              probeQuoteRaw: 1_000_000n,
            },
          }),
        ],
        [s],
        "create-mandate",
      );
      console.log(`mandate: ${mandate.toBase58()}`);
      break;
    }

    case "submit-bid": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const reward = BigInt(requiredArg("reward"));
      const nonce = BigInt(requiredArg("nonce"));
      const mandate = mandateAddress();
      const m = await loadMandate();
      const bid = findBidPda(mandate, p.publicKey, nonce);
      await preEmpty(bid);
      await send(
        [
          submitBid({
            provider: p.publicKey,
            mandate,
            nonce,
            requestedRewardRaw: reward,
            validUntil: m.biddingEndsAt,
          }),
        ],
        [p],
        `submit-bid-${providerName}`,
      );
      console.log(`bid: ${bid.toBase58()}`);
      break;
    }

    case "accept-bid": {
      const providerName = requiredArg("provider");
      const nonce = BigInt(requiredArg("nonce"));
      const s = role("sponsor");
      const p = role(providerName);
      const mandate = mandateAddress();
      await send(
        [acceptBid({ sponsor: s.publicKey, mandate, provider: p.publicKey, nonce })],
        [s],
        "accept-bid",
      );
      break;
    }

    /** Opens a REAL Meteora DLMM position, against the forked pool's real bin/liquidity state, using the raw
     * @meteora-ag/dlmm SDK directly (packages/meteora is deliberately measurement-only; Mandate itself never
     * operates Meteora positions on a provider's behalf, per docs/adr — this command plays the provider). */
    case "open-position": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const dlmmPool = await DLMM.create(connection, POOL);
      const activeId = dlmmPool.lbPair.activeId;
      const minBinId = activeId - 10;
      const maxBinId = activeId + 10;
      const positionKeypair = Keypair.generate();
      await preEmpty(positionKeypair.publicKey);
      const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        totalXAmount: new BN(500_000_000), // 0.5 base (9 decimals)
        totalYAmount: new BN(50_000_000), // 50 USDC (6 decimals)
        strategy: { minBinId, maxBinId, strategyType: meteoraSdk.StrategyType.Spot },
        user: p.publicKey,
      });
      tx.feePayer = p.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(p, positionKeypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await confirm(sig);
      console.log(`[open-position] ${sig}`);
      console.log(`position: ${positionKeypair.publicKey.toBase58()}`);
      break;
    }

    /** Removes REAL liquidity from a REAL, already-open position (`--bps` out of 10000) so a subsequent epoch
     * measurement fails naturally against the mandate's real depth/spread thresholds — no measurement result is
     * ever touched directly. */
    case "remove-liquidity": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const positionPubkey = new PublicKey(requiredArg("position"));
      const bps = Number(arg("bps") ?? "10000");
      const dlmmPool = await DLMM.create(connection, POOL);
      const position = await dlmmPool.getPosition(positionPubkey);
      const binIds = position.positionData.positionBinData.map((b) => b.binId);
      const fromBinId = Math.min(...binIds);
      const toBinId = Math.max(...binIds);
      const txs = await dlmmPool.removeLiquidity({
        user: p.publicKey,
        position: positionPubkey,
        fromBinId,
        toBinId,
        bps: new BN(bps),
        shouldClaimAndClose: false,
      });
      for (const [i, tx] of txs.entries()) {
        tx.feePayer = p.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
        tx.sign(p);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        await confirm(sig);
        console.log(`[remove-liquidity ${String(i + 1)}/${String(txs.length)}] ${sig}`);
      }
      break;
    }

    /** Restores REAL liquidity to a REAL, already-open position so a later epoch measurement can pass again. */
    case "add-liquidity": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const positionPubkey = new PublicKey(requiredArg("position"));
      const totalXAmount = new BN(requiredArg("base-raw"));
      const totalYAmount = new BN(requiredArg("quote-raw"));
      const dlmmPool = await DLMM.create(connection, POOL);
      const position = await dlmmPool.getPosition(positionPubkey);
      const binIds = position.positionData.positionBinData.map((b) => b.binId);
      const minBinId = Math.min(...binIds);
      const maxBinId = Math.max(...binIds);
      const tx = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionPubkey,
        totalXAmount,
        totalYAmount,
        strategy: { minBinId, maxBinId, strategyType: meteoraSdk.StrategyType.Spot },
        user: p.publicKey,
      });
      tx.feePayer = p.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(p);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await confirm(sig);
      console.log(`[add-liquidity] ${sig}`);
      break;
    }

    case "register-positions": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const positions = requiredArg("positions")
        .split(",")
        .map((v) => new PublicKey(v));
      const mandate = mandateAddress();
      await preEmpty(findPositionSetPda(mandate));
      await send(
        [registerPositions({ provider: p.publicKey, mandate, positions })],
        [p],
        "register-positions",
      );
      break;
    }

    case "activate": {
      const mandate = mandateAddress();
      await send([activateMandate({ mandate })], [role("admin")], "activate-mandate");
      break;
    }

    case "finalize-epoch": {
      const epochIndex = Number(requiredArg("epoch"));
      const observerNames = requiredArg("observers").split(",");
      const mandate = mandateAddress();
      const m = await loadMandate();
      const attestations = observerNames.map((n) =>
        findAttestationPda(mandate, epochIndex, role(n).publicKey),
      );
      await preEmpty(findEpochResultPda(mandate, epochIndex));
      await send(
        [
          finalizeEpoch({
            payer: role("admin").publicKey,
            mandate,
            observerSet: m.observerSet,
            positionSet: m.positionSet,
            epochIndex,
            attestations,
          }),
        ],
        [role("admin")],
        `finalize-epoch-${String(epochIndex)}`,
      );
      break;
    }

    case "finalize-unavailable": {
      const epochIndex = Number(requiredArg("epoch"));
      const mandate = mandateAddress();
      await preEmpty(findEpochResultPda(mandate, epochIndex));
      await send(
        [finalizeUnavailableEpoch({ payer: role("admin").publicKey, mandate, epochIndex })],
        [role("admin")],
        `finalize-unavailable-${String(epochIndex)}`,
      );
      break;
    }

    /** Injects a genuine, deliberately-disagreeing attestation from `--observer`, copying another observer's
     * ALREADY-ON-CHAIN, real, honestly-measured attestation for the same epoch (so it passes every timing and
     * binding check submit_attestation itself enforces) and corrupting only the payload/evidence hashes and the
     * spread metric — simulating a dishonest or buggy observer. Exercises the real on-chain
     * quorum-agreement rule in programs/mandate/src/instructions/finalize_epoch.rs: finalize must be called
     * with a hand-picked subset of attestations that all agree bit for bit, so the caller can (and must)
     * exclude a disagreeing minority rather than have it silently averaged away or block a quorum of honest
     * observers. */
    case "submit-bad-attestation": {
      const observerName = requiredArg("observer");
      const copyFromName = requiredArg("copy-from");
      const epochIndex = Number(requiredArg("epoch"));
      const o = role(observerName);
      const mandate = mandateAddress();
      const m = await loadMandate();
      const honestPda = findAttestationPda(mandate, epochIndex, role(copyFromName).publicKey);
      const info = await connection.getAccountInfo(honestPda, "confirmed");
      if (!info)
        throw new Error(`${copyFromName} has no attestation for epoch ${String(epochIndex)} yet`);
      const honest = decodeAccount<EpochAttestationAccount>("EpochAttestation", info.data);
      const badAttestation = findAttestationPda(mandate, epochIndex, o.publicKey);
      await preEmpty(badAttestation);
      await send(
        [
          submitAttestation({
            observer: o.publicKey,
            mandate,
            observerSet: m.observerSet,
            positionSet: m.positionSet,
            terms: {
              epochIndex,
              observedSlot: honest.observedSlot,
              observedUnixTs: honest.observedUnixTs,
              algorithmVersion: honest.algorithmVersion,
              payloadHash: new Uint8Array(32).fill(0xbad & 0xff),
              evidenceHash: new Uint8Array(32).fill(0xbad & 0xff),
              metrics: {
                ...honest.metrics,
                effectiveSpreadBps: honest.metrics.effectiveSpreadBps + 999,
              },
            },
          }),
        ],
        [o],
        `submit-bad-attestation-${observerName}`,
      );
      console.log(`bad attestation: ${badAttestation.toBase58()}`);
      break;
    }

    case "claim": {
      const providerName = requiredArg("provider");
      const p = role(providerName);
      const amount = BigInt(requiredArg("amount"));
      const mandate = mandateAddress();
      const providerUsdc = getAssociatedTokenAddressSync(USDC_MINT, p.publicKey);
      await send(
        [
          claimProviderReward({
            provider: p.publicKey,
            providerUsdc,
            mandate,
            usdcMint: USDC_MINT,
            amountRaw: amount,
          }),
        ],
        [p],
        "claim",
      );
      break;
    }

    case "withdraw": {
      const s = role("sponsor");
      const amount = BigInt(requiredArg("amount"));
      const mandate = mandateAddress();
      const sponsorUsdc = getAssociatedTokenAddressSync(USDC_MINT, s.publicKey);
      await send(
        [
          withdrawSurplusAfterAward({
            sponsor: s.publicKey,
            sponsorUsdc,
            mandate,
            usdcMint: USDC_MINT,
            amountRaw: amount,
          }),
        ],
        [s],
        "withdraw",
      );
      break;
    }

    case "close-mandate": {
      const s = role("sponsor");
      const mandate = mandateAddress();
      await send(
        [
          closeMandate({
            caller: role("admin").publicKey,
            mandate,
            sponsor: s.publicKey,
            usdcMint: USDC_MINT,
          }),
        ],
        [role("admin")],
        "close-mandate",
      );
      break;
    }

    case "status": {
      const protocol = await loadProtocol().catch(() => null);
      const mandate = await loadMandate().catch(() => null);
      console.log(
        JSON.stringify(
          { protocol, mandate, mandateAddress: mandateAddress().toBase58() },
          (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
          2,
        ),
      );
      break;
    }

    /** Advances the fork's on-chain clock sysvar forward by `--seconds` (relative to its OWN current on-chain
     * time, not wall-clock — the two drift apart under Surfpool since slot production isn't real-time). The
     * cheat's real contract, found only by probing since it isn't documented: `surfnet_timeTravel` takes a
     * single-key params object, one of `absoluteEpoch` / `absoluteSlot` / `absoluteTimestamp` (NOT the
     * `epochAdvance`/`timestampAdvance` shape one might guess), and — confirmed by a "Cannot travel to past
     * timestamp: target=<seconds>, current=<seconds>000" error on a first attempt — its internal comparison
     * treats `absoluteTimestamp` as MILLISECONDS while `getBlockTime` reports seconds, a real unit
     * inconsistency in Surfpool 1.6.0 itself. */
    case "time-travel": {
      const seconds = Number(requiredArg("seconds"));
      const slot = await connection.getSlot("confirmed");
      const currentUnixSeconds = await connection.getBlockTime(slot);
      if (currentUnixSeconds === null) throw new Error("could not read current on-chain time");
      const targetMs = (currentUnixSeconds + seconds) * 1000;
      await rpcCall("surfnet_timeTravel", [{ absoluteTimestamp: targetMs }]);
      console.log(
        `[time-travel] on-chain clock ${String(currentUnixSeconds)} -> ${String(currentUnixSeconds + seconds)} (+${String(seconds)}s)`,
      );
      break;
    }

    case "pre-empty": {
      const pubkeys = requiredArg("pubkeys")
        .split(",")
        .map((v) => new PublicKey(v));
      await preEmpty(...pubkeys);
      console.log(`[pre-empty] ${pubkeys.map((p) => p.toBase58()).join(", ")}`);
      break;
    }

    default:
      console.error(`unknown command: ${String(command)}`);
      process.exit(2);
  }
}

await main();

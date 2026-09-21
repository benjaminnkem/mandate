import {
  decodeAccount,
  findAttestationPda,
  registeredPositions,
  setObservers,
  submitAttestation,
  type EpochAttestationAccount,
  type MandateAccount,
  type MarketConfigAccount,
  type ObserverSetAccount,
  type PositionSetAccount,
} from "@mandate/solana";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
  type Keypair,
} from "@solana/web3.js";

import { AttestationExistsError } from "./errors.ts";
import {
  hexToBytes,
  toOnchainAttestation,
  type ChainPort,
  type MandateContext,
  type OnchainAttestation,
  type SubmitInput,
} from "./ports.ts";

/** The real chain port: reads decoded program accounts over RPC and signs as exactly one observer key. */
export class Web3ChainPort implements ChainPort {
  readonly observer: string;
  readonly #connection: Connection;
  readonly #keypair: Keypair;

  constructor(connection: Connection, keypair: Keypair) {
    this.#connection = connection;
    this.#keypair = keypair;
    this.observer = keypair.publicKey.toBase58();
  }

  async nowUnix(): Promise<number> {
    const clock = await this.#connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    if (!clock) throw new Error("clock sysvar unavailable");
    // Clock layout: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64
    return Number(clock.data.readBigInt64LE(32));
  }

  async #read(address: string): Promise<Buffer> {
    const info = await this.#connection.getAccountInfo(new PublicKey(address), "confirmed");
    if (!info) throw new Error(`account ${address} does not exist`);
    return info.data;
  }

  async loadContext(mandateAddress: string): Promise<MandateContext> {
    const mandate = decodeAccount<MandateAccount>("Mandate", await this.#read(mandateAddress));
    const observerSet = decodeAccount<ObserverSetAccount>(
      "ObserverSet",
      await this.#read(mandate.observerSet.toBase58()),
    );
    const positionSet = decodeAccount<PositionSetAccount>(
      "PositionSet",
      await this.#read(mandate.positionSet.toBase58()),
    );
    const market = decodeAccount<MarketConfigAccount>(
      "MarketConfig",
      await this.#read(mandate.marketConfig.toBase58()),
    );
    return {
      mandateAddress,
      mandate,
      observerSetAddress: mandate.observerSet.toBase58(),
      observers: setObservers(observerSet).map((k) => k.toBase58()),
      threshold: observerSet.threshold,
      positionSetAddress: mandate.positionSet.toBase58(),
      positions: registeredPositions(positionSet).map((k) => k.toBase58()),
      market: {
        pool: market.pool.toBase58(),
        baseMint: market.baseMint.toBase58(),
        quoteMint: market.quoteMint.toBase58(),
      },
    };
  }

  async loadAttestations(
    mandateAddress: string,
    epochIndex: number,
    observers: readonly string[],
  ): Promise<ReadonlyMap<string, OnchainAttestation>> {
    const mandate = new PublicKey(mandateAddress);
    const keys = observers.map((o) => findAttestationPda(mandate, epochIndex, new PublicKey(o)));
    const infos = await this.#connection.getMultipleAccountsInfo(keys, "confirmed");
    const out = new Map<string, OnchainAttestation>();
    infos.forEach((info, i) => {
      const observer = observers[i];
      if (info && observer)
        out.set(
          observer,
          toOnchainAttestation(
            decodeAccount<EpochAttestationAccount>("EpochAttestation", info.data),
          ),
        );
    });
    return out;
  }

  async submitAttestation(input: SubmitInput): Promise<{ signature: string }> {
    const ix = submitAttestation({
      observer: this.#keypair.publicKey,
      mandate: new PublicKey(input.mandateAddress),
      observerSet: new PublicKey(input.observerSetAddress),
      positionSet: new PublicKey(input.positionSetAddress),
      terms: {
        epochIndex: input.epochIndex,
        observedSlot: input.observedSlot,
        observedUnixTs: input.observedUnixTs,
        algorithmVersion: input.algorithmVersion,
        payloadHash: hexToBytes(input.payloadHash),
        evidenceHash: hexToBytes(input.evidenceHash),
        metrics: input.metrics,
      },
    });
    try {
      const signature = await sendAndConfirmTransaction(
        this.#connection,
        new Transaction().add(ix),
        [this.#keypair],
        { commitment: "confirmed" },
      );
      return { signature };
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as { logs?: unknown }).logs ?? "")}`;
      // The attestation account already exists: `init` fails with the system program's "already in use".
      if (/already in use|custom program error: 0x0\b/.test(text))
        throw new AttestationExistsError(text);
      throw error;
    }
  }
}

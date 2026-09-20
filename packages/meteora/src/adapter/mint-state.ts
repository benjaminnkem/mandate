import {
  ExtensionType,
  getEpochFee,
  getExtensionTypes,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferFeeConfig,
  getTransferHook,
  type Mint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { UnobservableError } from "./errors.ts";

/** `ExtensionType` is a numeric enum: index it in reverse, tolerating ids this library version does not know. */
const EXTENSION_NAMES = ExtensionType as unknown as Readonly<Record<number, string | undefined>>;
const extensionName = (type: number): string => EXTENSION_NAMES[type] ?? `Unknown(${String(type)})`;

/** Token-2022 state of a mint that can change what a swap costs or whether it can happen at all. */
export interface MintState {
  readonly address: string;
  readonly programId: string;
  readonly decimals: number;
  readonly hasFreezeAuthority: boolean;
  readonly extensions: readonly string[];
  /** Transfer fee in force at the observation epoch, in bps (`null` when the mint has no fee extension). */
  readonly effectiveTransferFeeBps: number | null;
  readonly observationEpoch: string;
  readonly transferFeeSchedule: {
    readonly olderEpoch: string;
    readonly olderBps: number;
    readonly newerEpoch: string;
    readonly newerBps: number;
  } | null;
  /** Program id of an active transfer hook, `null` when none is set. */
  readonly transferHookProgramId: string | null;
  readonly paused: boolean | null;
  readonly permanentDelegate: string | null;
  /** UI-amount multiplier in force at the observation time, as a decimal string; informational only. */
  readonly scaledUiMultiplier: string | null;
}

const isDefaultKey = (key: PublicKey | null | undefined): boolean =>
  key === null || key === undefined || key.equals(PublicKey.default);

/**
 * Read the observable Token-2022 state of the base mint from an SDK-provided `Mint`.
 * Everything here is recorded into evidence so a verifier can see which fee, pause and hook state
 * a measurement ran under (docs/adr/0008).
 */
export function readMintState(
  address: string,
  programId: string,
  mint: Mint,
  epoch: bigint,
  unixTimestamp: bigint,
): MintState {
  const extensionTypes = getExtensionTypes(mint.tlvData).map(extensionName);

  const feeConfig = getTransferFeeConfig(mint);
  const hook = getTransferHook(mint);
  const pausable = getPausableConfig(mint);
  const delegate = getPermanentDelegate(mint);
  const scaled = getScaledUiAmountConfig(mint);

  let scaledUiMultiplier: string | null = null;
  if (scaled) {
    const effective = BigInt(scaled.newMultiplierEffectiveTimestamp.toString()) <= unixTimestamp;
    scaledUiMultiplier = String(effective ? scaled.newMultiplier : scaled.multiplier);
  }

  return {
    address,
    programId,
    decimals: mint.decimals,
    hasFreezeAuthority: mint.freezeAuthority !== null,
    extensions: extensionTypes,
    effectiveTransferFeeBps: feeConfig
      ? getEpochFee(feeConfig, epoch).transferFeeBasisPoints
      : null,
    observationEpoch: epoch.toString(),
    transferFeeSchedule: feeConfig
      ? {
          olderEpoch: feeConfig.olderTransferFee.epoch.toString(),
          olderBps: feeConfig.olderTransferFee.transferFeeBasisPoints,
          newerEpoch: feeConfig.newerTransferFee.epoch.toString(),
          newerBps: feeConfig.newerTransferFee.transferFeeBasisPoints,
        }
      : null,
    transferHookProgramId: hook && !isDefaultKey(hook.programId) ? hook.programId.toBase58() : null,
    paused: pausable ? pausable.paused : null,
    permanentDelegate:
      delegate && !isDefaultKey(delegate.delegate) ? delegate.delegate.toBase58() : null,
    scaledUiMultiplier,
  };
}

/**
 * Fail closed when the mint is in a state in which a swap cannot be relied on (docs/adr/0008,
 * decision 3). These are *unobservable* conditions, not compliance failures: callers map them to an
 * `Unavailable` epoch, never to `NonCompliant`.
 */
export function assertMintObservable(state: MintState): void {
  if (state.paused === true) throw new UnobservableError("MintPaused", state.address);
  if (state.transferHookProgramId !== null)
    throw new UnobservableError("TransferHookActive", state.transferHookProgramId);
}

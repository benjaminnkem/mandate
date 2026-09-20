import { PublicKey, type Connection } from "@solana/web3.js";

import { bandBinRange } from "../algorithm/band.ts";
import type { PositionInput } from "../algorithm/contribution.ts";
import { DLMM } from "../sdk.ts";
import { UnobservableError } from "./errors.ts";
import { assertMintObservable, readMintState } from "./mint-state.ts";
import { loadPosition } from "./positions.ts";

/** Hard cap on registered positions, mirrored from the program (`MAX_POSITIONS`). */
export const MAX_REGISTERED_POSITIONS = 8;

export type Severity = "ok" | "warn" | "reject";

export interface Finding {
  readonly severity: "warn" | "reject";
  readonly code: string;
  readonly message: string;
}

export interface PositionAssessment {
  readonly address: string;
  /** The worst finding: `reject` blocks registration, `warn` allows it but should be shown to the user. */
  readonly severity: Severity;
  readonly findings: readonly Finding[];
  readonly details: {
    readonly owner: string | null;
    readonly operator: string | null;
    readonly feeOwner: string | null;
    readonly lowerBinId: number | null;
    readonly upperBinId: number | null;
    readonly coversActiveBin: boolean;
    /** Raw holdings inside the band right now, when a band was supplied. */
    readonly quoteInBandRaw: bigint | null;
    readonly baseInBandRaw: bigint | null;
  };
}

export interface AssessContext {
  readonly pool: string;
  readonly provider: string;
  readonly baseIsX: boolean;
  readonly activeId: number;
  /** Inclusive bin range of the mandate's price band, when known. */
  readonly band: { readonly lowerBinId: number; readonly upperBinId: number } | null;
}

const NO_OPERATOR = "11111111111111111111111111111111";

/**
 * Judge one position against the registration rules, purely from what was read. Nothing here claims the
 * Mandate program verifies ownership: the program stores only the keys, and observers measure ownership
 * (docs/adr/0008). This is the pre-signature warning that keeps a provider from registering a position that
 * would count as zero.
 */
export function assessPosition(
  position: PositionInput,
  context: AssessContext,
): PositionAssessment {
  const findings: Finding[] = [];
  const reject = (code: string, message: string): void => {
    findings.push({ severity: "reject", code, message });
  };
  const warn = (code: string, message: string): void => {
    findings.push({ severity: "warn", code, message });
  };
  const empty = {
    owner: null,
    operator: null,
    feeOwner: null,
    lowerBinId: null,
    upperBinId: null,
    coversActiveBin: false,
    quoteInBandRaw: null,
    baseInBandRaw: null,
  };

  if (position.kind === "missing") {
    reject(
      "PositionNotFound",
      "This account does not exist (it may be closed or the address is wrong). It would count as zero.",
    );
    return finish(position.address, findings, empty);
  }
  if (position.kind === "invalid") {
    reject(
      "UnsupportedPositionType",
      `This account is not a supported Meteora DLMM position (${position.reason}). Only PositionV2 accounts are measured; anything else counts as zero.`,
    );
    return finish(position.address, findings, empty);
  }

  const details = {
    owner: position.owner,
    operator: position.operator,
    feeOwner: position.feeOwner,
    lowerBinId: position.lowerBinId,
    upperBinId: position.upperBinId,
    coversActiveBin:
      position.lowerBinId <= context.activeId && context.activeId <= position.upperBinId,
    quoteInBandRaw: null as bigint | null,
    baseInBandRaw: null as bigint | null,
  };

  if (position.lbPair !== context.pool) {
    reject(
      "WrongPool",
      `This position belongs to pool ${position.lbPair}, not the mandate's pool ${context.pool}. It would count as zero.`,
    );
    return finish(position.address, findings, details);
  }
  if (position.owner !== context.provider) {
    if (position.operator === context.provider) {
      reject(
        "OperatorOnly",
        "Your wallet is only this position's operator, not its owner. v1 counts owner-controlled positions only, so it would count as zero.",
      );
    } else if (position.feeOwner === context.provider) {
      reject(
        "FeeOwnerOnly",
        "Your wallet only receives this position's fees; the owner is another address. It would count as zero.",
      );
    } else {
      reject(
        "NotOwner",
        `This position is owned by ${position.owner}, not by your wallet. It would count as zero.`,
      );
    }
    return finish(position.address, findings, details);
  }

  if (position.operator !== NO_OPERATOR && position.operator !== position.owner) {
    warn(
      "OperatorSet",
      `Another address (${position.operator}) is set as this position's operator and can modify its liquidity. That can change your measured contribution.`,
    );
  }
  const holdsAnything = position.bins.some((bin) => bin.xAmount > 0n || bin.yAmount > 0n);
  if (!holdsAnything)
    warn(
      "EmptyPosition",
      "This position currently holds no liquidity. It contributes nothing until you add some.",
    );
  if (!details.coversActiveBin)
    warn(
      "OutOfRange",
      "This position's range does not include the active bin, so it is not providing in-range liquidity right now.",
    );

  if (context.band !== null) {
    const { lowerBinId, upperBinId } = context.band;
    let quote = 0n;
    let base = 0n;
    for (const bin of position.bins) {
      if (bin.binId < lowerBinId || bin.binId > upperBinId) continue;
      quote += context.baseIsX ? bin.yAmount : bin.xAmount;
      base += context.baseIsX ? bin.xAmount : bin.yAmount;
    }
    details.quoteInBandRaw = quote;
    details.baseInBandRaw = base;
    if (holdsAnything && quote === 0n && base === 0n) {
      warn(
        "NothingInBand",
        "None of this position's liquidity is inside the mandate's price band right now.",
      );
    }
  }
  return finish(position.address, findings, details);
}

function finish(
  address: string,
  findings: readonly Finding[],
  details: PositionAssessment["details"],
): PositionAssessment {
  const severity: Severity = findings.some((f) => f.severity === "reject")
    ? "reject"
    : findings.length > 0
      ? "warn"
      : "ok";
  return { address, severity, findings, details };
}

export interface RegistrationReport {
  /** True only if every position is acceptable and the set itself is well formed. */
  readonly ok: boolean;
  readonly positions: readonly PositionAssessment[];
  /** Problems with the set as a whole (empty, too large, duplicates). */
  readonly setErrors: readonly Finding[];
  /** Problems with the market that affect measurement (paused mint, active hook). */
  readonly marketWarnings: readonly Finding[];
}

/** Shape rules of the registered set, identical to the program's (`mandate_core::positions`). */
export function assessSet(addresses: readonly string[], maxPositions: number): Finding[] {
  const findings: Finding[] = [];
  const cap = Math.min(maxPositions, MAX_REGISTERED_POSITIONS);
  if (addresses.length === 0)
    findings.push({
      severity: "reject",
      code: "EmptySet",
      message: "Register at least one position.",
    });
  if (addresses.length > cap) {
    findings.push({
      severity: "reject",
      code: "TooManyPositions",
      message: `A mandate allows at most ${String(cap)} positions; you listed ${String(addresses.length)}.`,
    });
  }
  const seen = new Set<string>();
  for (const address of addresses) {
    if (seen.has(address))
      findings.push({
        severity: "reject",
        code: "DuplicatePosition",
        message: `${address} is listed more than once.`,
      });
    if (address === NO_OPERATOR)
      findings.push({
        severity: "reject",
        code: "DefaultKey",
        message: "The all-zero address is not a position.",
      });
    seen.add(address);
  }
  return findings;
}

export interface InspectParams {
  readonly connection: Connection;
  readonly pool: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  /** The wallet that will sign the registration (the accepted provider). */
  readonly provider: string;
  readonly positions: readonly string[];
  /** The protocol's `max_positions`. */
  readonly maxPositions: number;
  /** The mandate's depth band, to report in-band holdings and warn if there are none. */
  readonly depthBandBps?: bigint;
}

/**
 * Inspect every position a provider is about to register, through the official SDK, and say plainly
 * which would count and which would silently count as zero. Read-only.
 */
export async function inspectPositionsForRegistration(
  params: InspectParams,
): Promise<RegistrationReport> {
  const dlmm = await DLMM.create(params.connection, new PublicKey(params.pool));
  const x = dlmm.lbPair.tokenXMint.toBase58();
  const y = dlmm.lbPair.tokenYMint.toBase58();
  const matches =
    (x === params.baseMint && y === params.quoteMint) ||
    (y === params.baseMint && x === params.quoteMint);
  if (!matches)
    throw new UnobservableError(
      "PoolMismatch",
      `pool mints ${x}/${y} do not match the expected base/quote`,
    );
  const baseIsX = x === params.baseMint;

  const marketWarnings: Finding[] = [];
  const baseToken = baseIsX ? dlmm.tokenX : dlmm.tokenY;
  const mintState = readMintState(
    params.baseMint,
    baseToken.owner.toBase58(),
    baseToken.mint,
    BigInt(dlmm.clock.epoch.toString()),
    BigInt(dlmm.clock.unixTimestamp.toString()),
  );
  try {
    assertMintObservable(mintState);
  } catch (error) {
    if (!(error instanceof UnobservableError)) throw error;
    marketWarnings.push({
      severity: "warn",
      code: error.reason,
      message: `The base token cannot currently be measured (${error.message}). Epochs would be unavailable, not failed, but you would earn nothing while it lasts.`,
    });
  }

  const activeId = dlmm.lbPair.activeId;
  const band =
    params.depthBandBps === undefined
      ? null
      : (() => {
          const b = bandBinRange(activeId, dlmm.lbPair.binStep, params.depthBandBps);
          return { lowerBinId: b.lowerBinId, upperBinId: b.upperBinId };
        })();
  const context: AssessContext = {
    pool: params.pool,
    provider: params.provider,
    baseIsX,
    activeId,
    band,
  };

  const setErrors = assessSet(params.positions, params.maxPositions);
  const assessments: PositionAssessment[] = [];
  for (const address of new Set(params.positions)) {
    assessments.push(assessPosition(await loadPosition(dlmm, address), context));
  }
  const ok = setErrors.length === 0 && assessments.every((a) => a.severity !== "reject");
  return { ok, positions: assessments, setErrors, marketWarnings };
}

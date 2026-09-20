import { fail } from "./errors.ts";

/** Fixed-width integer ranges of the onchain program. Amounts are `bigint`, never `number`. */
export const U8_MAX = 255n;
export const U16_MAX = 65_535n;
export const U32_MAX = 4_294_967_295n;
export const U64_MAX = 18_446_744_073_709_551_615n;
export const I64_MAX = 9_223_372_036_854_775_807n;
export const I64_MIN = -9_223_372_036_854_775_808n;

export const BPS_DENOM = 10_000n;

export const isU32 = (x: bigint): boolean => x >= 0n && x <= U32_MAX;
export const isU64 = (x: bigint): boolean => x >= 0n && x <= U64_MAX;
export const isI64 = (x: bigint): boolean => x >= I64_MIN && x <= I64_MAX;

/** Narrow to u64 or fail with `ArithmeticOverflow`. */
export function asU64(x: bigint): bigint {
  return isU64(x) ? x : fail("ArithmeticOverflow", "value outside u64");
}

/** Narrow to i64 or fail with `ArithmeticOverflow`. */
export function asI64(x: bigint): bigint {
  return isI64(x) ? x : fail("ArithmeticOverflow", "value outside i64");
}

export const addU64 = (a: bigint, b: bigint): bigint => asU64(asU64(a) + asU64(b));
export const subU64 = (a: bigint, b: bigint): bigint => asU64(asU64(a) - asU64(b));
export const mulU64 = (a: bigint, b: bigint): bigint => asU64(asU64(a) * asU64(b));

export function divU64(a: bigint, b: bigint): bigint {
  if (asU64(b) === 0n) return fail("DivisionByZero");
  return asU64(a) / b;
}

export function ceilDivU64(a: bigint, b: bigint): bigint {
  if (asU64(b) === 0n) return fail("DivisionByZero");
  asU64(a);
  return (a + b - 1n) / b;
}

/**
 * floor(a * b / c) with a widened (unbounded) intermediate, result must fit u64.
 * The widened product mirrors Rust's u128; a u64 x u64 product always fits u128.
 */
export function mulDivFloorU64(a: bigint, b: bigint, c: bigint): bigint {
  if (asU64(c) === 0n) return fail("DivisionByZero");
  return asU64((asU64(a) * asU64(b)) / c);
}

/** ceil(a * b / c), widened, result must fit u64. */
export function mulDivCeilU64(a: bigint, b: bigint, c: bigint): bigint {
  if (asU64(c) === 0n) return fail("DivisionByZero");
  return asU64((asU64(a) * asU64(b) + c - 1n) / c);
}

/** Parse a base-10 unsigned integer string (JSON transport form) into a bigint. */
export function parseUint(text: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(text))
    throw new TypeError("expected a base-10 unsigned integer string");
  return BigInt(text);
}

/** Parse a base-10 signed integer string into a bigint. */
export function parseInt64(text: string): bigint {
  if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw new TypeError("expected a base-10 integer string");
  return BigInt(text);
}

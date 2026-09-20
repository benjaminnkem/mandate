import { sha256Hex } from "../hash.ts";

export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | bigint
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Canonical JSON: keys sorted (UTF-16 code-unit order), no insignificant whitespace, `bigint` as a
 * base-10 string, arrays in their given order. Only safe integers are allowed as numbers; `undefined`,
 * `NaN`, infinities and fractions throw, so a hash can never silently depend on an omitted or
 * platform-formatted value. Two processes on any OS/Node produce byte-identical output for equal data.
 */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "number":
      if (!Number.isSafeInteger(value))
        throw new TypeError(`non-integer number in canonical data: ${String(value)}`);
      return String(value);
    case "object": {
      if (Array.isArray(value))
        return `[${(value as readonly CanonicalValue[]).map(canonicalJson).join(",")}]`;
      const record = value as { readonly [key: string]: CanonicalValue };
      const entries = Object.keys(record)
        .sort()
        .map((key) => {
          const item = record[key];
          if (item === undefined) throw new TypeError(`undefined value at key ${key}`);
          return `${JSON.stringify(key)}:${canonicalJson(item)}`;
        });
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`unsupported canonical value of type ${typeof value}`);
  }
}

/** SHA-256 of the canonical JSON of `value`, lowercase hex. */
export function canonicalHash(value: CanonicalValue): string {
  return sha256Hex(canonicalJson(value));
}

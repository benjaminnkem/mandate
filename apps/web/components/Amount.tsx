import type { AmountPairJson } from "../lib/types.ts";

/** Always shows the exact raw integer next to the display value: the raw units are the ground truth, USDC is
 * a convenience conversion of it. */
export function Amount({ pair }: { pair: AmountPairJson }) {
  return (
    <span>
      <span className="font-medium">{pair.usdc} USDC</span>{" "}
      <span className="font-mono-data text-xs text-muted-foreground">({pair.raw} raw)</span>
    </span>
  );
}

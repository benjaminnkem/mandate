import type { AmountPairJson } from "../lib/types.ts";

/** Always shows the exact raw integer next to the display value: the raw units are the ground truth, USDC is
 * a convenience conversion of it. */
export function Amount({ pair }: { pair: AmountPairJson }) {
  return (
    <span className="amount">
      <span className="usdc">{pair.usdc} USDC</span> <span className="raw">({pair.raw} raw)</span>
    </span>
  );
}

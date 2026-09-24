import Link from "next/link";

import { ScrollReveal } from "./ScrollReveal.tsx";

const SNIPPET = `{
  "pool": "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH",
  "baseMint": "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
  "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "probeQuoteRaw": "10000000",
  "depthBandBps": 500,
  "algorithmVersion": 1
}`;

export function MethodologyTeaser() {
  return (
    <ScrollReveal as="div" className="border-t py-14">
      <div className="grid gap-8 sm:grid-cols-2 sm:items-center">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Every measurement is reproducible
          </h2>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            One observer measures live and publishes the exact snapshot. The rest replay it offline
            and sign only if their own computation reaches the identical hash. Anyone can redo this
            from the same parameters.
          </p>
          <Link
            href="/methodology"
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            Read the full methodology &rarr;
          </Link>
        </div>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 font-mono-data text-xs leading-relaxed">
          {SNIPPET}
        </pre>
      </div>
    </ScrollReveal>
  );
}

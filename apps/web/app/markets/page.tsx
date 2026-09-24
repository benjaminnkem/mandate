"use client";

import { useEffect, useState } from "react";

import { AddressTag } from "../../components/AddressTag.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Loading } from "../../components/Loading.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { getMarketQuality, listMarkets } from "../../lib/api.ts";
import { formatBps, formatUnixSeconds, usdc } from "../../lib/format.ts";
import type { MarketQuality } from "../../lib/types.ts";

interface Loaded {
  readonly pool: string;
  readonly enabled: boolean;
  readonly quality: MarketQuality | null;
}

export default function MarketsPage() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: Error }
    | { status: "ready"; markets: readonly Loaded[] }
  >({ status: "loading" });

  useEffect(() => {
    // Widened explicitly: it is reassigned from the cleanup closure below, which a narrower inferred type
    // would hide from later checks in this effect.
    let cancelled: boolean = false;
    // Resetting to loading is the point of this effect, not an accidental cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    (async () => {
      const marketsRes = await listMarkets();
      const rows = marketsRes.data;
      const loaded = await Promise.all(
        rows.map(async (row): Promise<Loaded> => {
          try {
            const quality = await getMarketQuality(row.account.pool);
            return { pool: row.account.pool, enabled: row.account.enabled, quality: quality.data };
          } catch {
            return { pool: row.account.pool, enabled: row.account.enabled, quality: null };
          }
        }),
      );
      // `cancelled` really is reassigned, by the cleanup function returned below; the linter's own flow
      // analysis doesn't see across that closure boundary the way `tsc` does.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!cancelled) setState({ status: "ready", markets: loaded });
    })().catch((error: unknown) => {
      if (!cancelled)
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approved markets</h1>
        <p className="mt-2 max-w-[60ch] text-muted-foreground">
          Every pool below has been reviewed and enabled by the protocol admin. The figures shown
          are the most recently attested epoch on any mandate for that pool, not a live quote. They
          carry the exact slot and time they were measured at.
        </p>
      </div>

      {state.status === "loading" ? <Loading label="Loading approved markets" /> : null}
      {state.status === "error" ? <ErrorNotice error={state.error} /> : null}
      {state.status === "ready" && state.markets.length === 0 ? (
        <p className="text-muted-foreground">No market is approved yet.</p>
      ) : null}

      {state.status === "ready" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {state.markets.map((m) => (
            <Card key={m.pool}>
              <CardHeader>
                <CardTitle>
                  <AddressTag address={m.pool} label="Pool" />
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!m.enabled ? (
                  <p className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn-foreground">
                    Currently disabled by the admin.
                  </p>
                ) : null}
                {m.quality?.latestAttestedEpoch ? (
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        Effective spread (aggregate pool)
                      </span>
                      <strong>
                        {formatBps(m.quality.latestAttestedEpoch.aggregatePool.effectiveSpreadBps)}
                      </strong>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Pool buy / sell depth</span>
                      <span>
                        {usdc(m.quality.latestAttestedEpoch.aggregatePool.buyDepthQuoteRaw)} /{" "}
                        {usdc(m.quality.latestAttestedEpoch.aggregatePool.sellDepthQuoteRaw)} USDC
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        Provider contribution (quote-equivalent)
                      </span>
                      <span>
                        {usdc(m.quality.latestAttestedEpoch.providerContribution.quoteInBandRaw)}{" "}
                        USDC
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Measured {formatUnixSeconds(m.quality.latestAttestedEpoch.observedUnixTs)}.
                      Outcome {m.quality.latestAttestedEpoch.outcome}, mandate{" "}
                      <AddressTag address={m.quality.latestAttestedEpoch.mandate} />
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {m.quality?.note ?? "No epoch has been attested on this market yet."}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { AddressTag } from "../../../../../components/AddressTag.tsx";
import { ErrorNotice } from "../../../../../components/ErrorNotice.tsx";
import { Loading } from "../../../../../components/Loading.tsx";
import { StatusBadge } from "../../../../../components/StatusBadge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../../components/ui/table.tsx";
import { getEvidence } from "../../../../../lib/api.ts";
import { formatUnixSeconds, usdc } from "../../../../../lib/format.ts";
import { useApi } from "../../../../../lib/useApi.ts";

export default function EvidencePage() {
  const { address, epoch } = useParams<{ address: string; epoch: string }>();
  const epochIndex = Number(epoch);
  const state = useApi(() => getEvidence(address, epochIndex), [address, epochIndex]);

  if (state.status === "loading") return <Loading label="Loading evidence" />;
  if (state.status === "error") return <ErrorNotice error={state.error} onRetry={state.refetch} />;
  const e = state.data.data;
  const metricsSource = e.result ?? e.attestations[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Evidence for epoch {e.epoch}</h1>
          <StatusBadge status={e.outcome} />
        </div>
        <p className="mt-2 max-w-[60ch] text-muted-foreground">
          Everything a third party needs to independently reproduce this epoch&rsquo;s measurement,
          and whether the observers who attested it agreed with each other exactly.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Observer agreement</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {e.attestations.length === 0 ? (
            <p className="text-muted-foreground">No observer has attested this epoch yet.</p>
          ) : (
            <>
              <p
                className={
                  e.agreement.unanimous
                    ? "rounded-md border border-ok/40 bg-ok-bg px-3 py-2 text-sm text-ok-foreground"
                    : "rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn-foreground"
                }
              >
                {e.agreement.unanimous
                  ? `All ${String(e.attestations.length)} attesting observer(s) reported the identical payload hash, evidence hash, slot, time and metrics.`
                  : `Observers disagree: ${String(e.agreement.groups.length)} distinct evidence groups were reported. Mandate never averages disagreeing observations; a quorum forms only from observers who agree exactly.`}
              </p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <caption className="visually-hidden">Attestations for this epoch</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Observer</TableHead>
                      <TableHead>Slot</TableHead>
                      <TableHead>Observed at</TableHead>
                      <TableHead>Payload hash</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.attestations.map((a) => (
                      <TableRow key={a.address}>
                        <TableCell>
                          <AddressTag address={a.account.observer} />
                        </TableCell>
                        <TableCell>{a.account.observedSlot}</TableCell>
                        <TableCell>{formatUnixSeconds(a.account.observedUnixTs)}</TableCell>
                        <TableCell className="font-mono-data text-xs">
                          {a.account.payloadHash}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Final result</CardTitle>
        </CardHeader>
        <CardContent>
          {e.result ? (
            <dl className="flex flex-col gap-2">
              <FactRow label="Outcome" value={<StatusBadge status={e.result.account.outcome} />} />
              <FactRow
                label="Reward earned"
                value={`${usdc(e.result.account.rewardEarnedRaw)} USDC`}
              />
              <FactRow
                label="Reward forfeited"
                value={`${usdc(e.result.account.rewardForfeitedRaw)} USDC`}
              />
              <FactRow
                label="Attestations counted"
                value={String(e.result.account.attestationCount)}
              />
              <FactRow
                label="Finalized by"
                value={<AddressTag address={e.result.account.finalizedBy} />}
              />
              <FactRow
                label="Finalized at"
                value={formatUnixSeconds(e.result.account.finalizedAt)}
              />
            </dl>
          ) : (
            <p className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn-foreground">
              This epoch has not been finalized on chain yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Measured metrics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {metricsSource ? (
            <MetricsTable metrics={metricsSource.account.metrics} />
          ) : (
            <p className="text-muted-foreground">No metrics recorded yet.</p>
          )}
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Pool depth</strong> figures above are aggregate pool
            liquidity anyone could trade against; the{" "}
            <strong className="text-foreground">provider contribution</strong> figures are what the
            accepted provider&rsquo;s own registered positions specifically hold in the same band.
            They are separate numbers for a reason: a deep pool built by other liquidity providers
            does not by itself satisfy the provider&rsquo;s own minimum.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reproduce this measurement offline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">{e.howToReproduce.statement}</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono-data text-xs">
            {JSON.stringify(e.howToReproduce.parameters, null, 2)}
          </pre>
          <p className="text-sm text-muted-foreground">
            Expected payload hash and metrics after replay:
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono-data text-xs">
            {JSON.stringify(e.howToReproduce.expected, null, 2)}
          </pre>
          {"snapshotUrl" in e.evidence && e.evidence.snapshotUrl ? (
            <a href={e.evidence.snapshotUrl} className="text-sm text-primary hover:underline">
              Download the recorded snapshot
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              {"note" in e.evidence ? e.evidence.note : null}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}

function MetricsTable({
  metrics,
}: {
  metrics: {
    effectiveSpreadBps: number;
    poolBuyDepthQuoteRaw: string;
    poolSellDepthQuoteRaw: string;
    providerQuoteInBandRaw: string;
    providerBaseQuoteEqInBandRaw: string;
  };
}) {
  return (
    <dl className="flex flex-col gap-2">
      <FactRow
        label="Effective spread"
        value={`${(metrics.effectiveSpreadBps / 100).toFixed(2)}%`}
      />
      <FactRow label="Pool buy depth" value={`${usdc(metrics.poolBuyDepthQuoteRaw)} USDC`} />
      <FactRow label="Pool sell depth" value={`${usdc(metrics.poolSellDepthQuoteRaw)} USDC`} />
      <FactRow
        label="Provider quote in band"
        value={`${usdc(metrics.providerQuoteInBandRaw)} USDC`}
      />
      <FactRow
        label="Provider base in band (USDC-eq.)"
        value={`${usdc(metrics.providerBaseQuoteEqInBandRaw)} USDC`}
      />
    </dl>
  );
}

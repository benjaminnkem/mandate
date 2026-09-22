"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { AddressTag } from "../../../../../components/AddressTag.tsx";
import { ErrorNotice } from "../../../../../components/ErrorNotice.tsx";
import { Loading } from "../../../../../components/Loading.tsx";
import { StatusBadge } from "../../../../../components/StatusBadge.tsx";
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
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div>
        <h1>
          Evidence for epoch {e.epoch} <StatusBadge status={e.outcome} />
        </h1>
        <p className="lede">
          Everything a third party needs to independently reproduce this epoch&rsquo;s measurement,
          and whether the observers who attested it agreed with each other exactly.
        </p>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Observer agreement</h2>
        {e.attestations.length === 0 ? (
          <p className="muted">No observer has attested this epoch yet.</p>
        ) : (
          <>
            <p className={e.agreement.unanimous ? "notice ok" : "notice warn"}>
              {e.agreement.unanimous
                ? `All ${String(e.attestations.length)} attesting observer(s) reported the identical payload hash, evidence hash, slot, time and metrics.`
                : `Observers disagree: ${String(e.agreement.groups.length)} distinct evidence groups were reported. Mandate never averages disagreeing observations — a quorum forms only from observers who agree exactly.`}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <caption className="visually-hidden">Attestations for this epoch</caption>
                <thead>
                  <tr>
                    <th scope="col">Observer</th>
                    <th scope="col">Slot</th>
                    <th scope="col">Observed at</th>
                    <th scope="col">Payload hash</th>
                  </tr>
                </thead>
                <tbody>
                  {e.attestations.map((a) => (
                    <tr key={a.address}>
                      <td>
                        <AddressTag address={a.account.observer} />
                      </td>
                      <td>{a.account.observedSlot}</td>
                      <td>{formatUnixSeconds(a.account.observedUnixTs)}</td>
                      <td className="mono" style={{ fontSize: "0.78rem" }}>
                        {a.account.payloadHash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {e.result ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Final result</h2>
          <dl className="stack" style={{ gap: "0.3rem" }}>
            <Row label="Outcome" value={<StatusBadge status={e.result.account.outcome} />} />
            <Row label="Reward earned" value={`${usdc(e.result.account.rewardEarnedRaw)} USDC`} />
            <Row
              label="Reward forfeited"
              value={`${usdc(e.result.account.rewardForfeitedRaw)} USDC`}
            />
            <Row label="Attestations counted" value={String(e.result.account.attestationCount)} />
            <Row
              label="Finalized by"
              value={<AddressTag address={e.result.account.finalizedBy} />}
            />
            <Row label="Finalized at" value={formatUnixSeconds(e.result.account.finalizedAt)} />
          </dl>
        </section>
      ) : (
        <p className="notice warn">This epoch has not been finalized on chain yet.</p>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Measured metrics</h2>
        {metricsSource ? (
          <MetricsTable metrics={metricsSource.account.metrics} />
        ) : (
          <p className="muted">No metrics recorded yet.</p>
        )}
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          <strong>Pool depth</strong> figures above are aggregate pool liquidity anyone could trade
          against; the <strong>provider contribution</strong> figures are what the accepted
          provider&rsquo;s own registered positions specifically hold in the same band. They are
          separate numbers for a reason: a deep pool built by other liquidity providers does not by
          itself satisfy the provider&rsquo;s own minimum.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Reproduce this measurement offline</h2>
        <p>{e.howToReproduce.statement}</p>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
          {JSON.stringify(e.howToReproduce.parameters, null, 2)}
        </pre>
        <p className="muted">Expected payload hash and metrics after replay:</p>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
          {JSON.stringify(e.howToReproduce.expected, null, 2)}
        </pre>
        {"snapshotUrl" in e.evidence && e.evidence.snapshotUrl ? (
          <p>
            <a href={e.evidence.snapshotUrl}>Download the recorded snapshot</a>
          </p>
        ) : (
          <p className="muted">{"note" in e.evidence ? e.evidence.note : null}</p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
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
    <dl className="stack" style={{ gap: "0.3rem" }}>
      <Row label="Effective spread" value={`${(metrics.effectiveSpreadBps / 100).toFixed(2)}%`} />
      <Row label="Pool buy depth" value={`${usdc(metrics.poolBuyDepthQuoteRaw)} USDC`} />
      <Row label="Pool sell depth" value={`${usdc(metrics.poolSellDepthQuoteRaw)} USDC`} />
      <Row label="Provider quote in band" value={`${usdc(metrics.providerQuoteInBandRaw)} USDC`} />
      <Row
        label="Provider base in band (USDC-eq.)"
        value={`${usdc(metrics.providerBaseQuoteEqInBandRaw)} USDC`}
      />
    </dl>
  );
}

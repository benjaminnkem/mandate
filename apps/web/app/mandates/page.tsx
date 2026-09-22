"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo } from "react";

import { AddressTag } from "../../components/AddressTag.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Loading } from "../../components/Loading.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { listMandates } from "../../lib/api.ts";
import { formatUnixSeconds, usdc } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";

const STATUSES = [
  "Bidding",
  "Awarded",
  "Active",
  "AwaitingFinalization",
  "Closed",
  "Cancelled",
] as const;

export default function MandatesPage() {
  return (
    <Suspense fallback={<Loading label="Loading mandates" />}>
      <MandatesExplorer />
    </Suspense>
  );
}

function MandatesExplorer() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const provider = params.get("provider") ?? "";
  const sponsor = params.get("sponsor") ?? "";
  const after = params.get("after") ?? undefined;

  const setParams = useCallback(
    (next: Record<string, string>) => {
      const usp = new URLSearchParams();
      if (next.status) usp.set("status", next.status);
      if (next.provider) usp.set("provider", next.provider);
      if (next.sponsor) usp.set("sponsor", next.sponsor);
      if (next.after) usp.set("after", next.after);
      router.push(`/mandates${usp.size > 0 ? `?${usp.toString()}` : ""}`);
    },
    [router],
  );

  const filters = useMemo(
    () => ({
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      ...(sponsor ? { sponsor } : {}),
      ...(after ? { after } : {}),
      limit: 25,
    }),
    [status, provider, sponsor, after],
  );
  const state = useApi(() => listMandates(filters), [status, provider, sponsor, after]);

  return (
    <div className="stack">
      <div>
        <h1>Explore mandates</h1>
        <p className="lede">
          Every mandate the indexer has recorded, filterable by status, provider or sponsor.
        </p>
      </div>

      <form
        className="row card"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const str = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");
          setParams({
            status: str(form.get("status")),
            provider: str(form.get("provider")),
            sponsor: str(form.get("sponsor")),
          });
        }}
      >
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="provider">Provider address</label>
          <input
            id="provider"
            name="provider"
            defaultValue={provider}
            placeholder="Base58 address"
          />
        </div>
        <div className="field">
          <label htmlFor="sponsor">Sponsor address</label>
          <input id="sponsor" name="sponsor" defaultValue={sponsor} placeholder="Base58 address" />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button type="submit" className="primary">
            Apply filters
          </button>
        </div>
      </form>

      {state.status === "loading" ? <Loading label="Loading mandates" /> : null}
      {state.status === "error" ? (
        <ErrorNotice error={state.error} onRetry={state.refetch} />
      ) : null}

      {state.status === "ready" && state.data.data.mandates.length === 0 ? (
        <p className="muted">No mandate matches these filters.</p>
      ) : null}

      {state.status === "ready" && state.data.data.mandates.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table>
            <caption className="visually-hidden">Mandates matching the current filters</caption>
            <thead>
              <tr>
                <th scope="col">Mandate</th>
                <th scope="col">Status</th>
                <th scope="col">Sponsor</th>
                <th scope="col">Provider</th>
                <th scope="col">Max reward</th>
                <th scope="col">Starts</th>
              </tr>
            </thead>
            <tbody>
              {state.data.data.mandates.map((m) => (
                <tr key={m.address}>
                  <td>
                    <Link href={`/mandates/${m.address}`}>
                      <AddressTag address={m.address} />
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={m.account.status} />
                  </td>
                  <td>
                    <AddressTag address={m.account.sponsor} />
                  </td>
                  <td>
                    <AddressTag address={m.account.provider} />
                  </td>
                  <td>{usdc(m.account.maxRewardRaw)} USDC</td>
                  <td>{formatUnixSeconds(m.account.startAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.status === "ready" && state.data.data.nextAfter ? (
        <button
          type="button"
          onClick={() => {
            setParams({ status, provider, sponsor, after: state.data.data.nextAfter ?? "" });
          }}
        >
          Next page
        </button>
      ) : null}
    </div>
  );
}

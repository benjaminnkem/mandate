"use client";

import Link from "next/link";

import { Amount } from "../../components/Amount.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Loading } from "../../components/Loading.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { getProviderMandates } from "../../lib/api.ts";
import { formatUnixSeconds } from "../../lib/format.ts";
import { useWallet } from "../../lib/solana/wallet-standard.tsx";
import { useApi } from "../../lib/useApi.ts";

export default function ProviderWorkspacePage() {
  const { account } = useWallet();
  const state = useApi(
    () => (account ? getProviderMandates(account.address) : Promise.resolve(null)),
    [account?.address],
  );

  return (
    <div className="stack">
      <div>
        <h1>Provider workspace</h1>
        <p className="lede">
          Every mandate your connected wallet has bid on or been awarded, with what you have earned
          and can still claim. Bidding, position registration and claiming happen on each
          mandate&rsquo;s own page.
        </p>
      </div>

      {!account ? (
        <p className="notice warn">Connect a wallet above to see your mandates.</p>
      ) : state.status === "loading" ? (
        <Loading label="Loading your mandates" />
      ) : state.status === "error" ? (
        <ErrorNotice error={state.error} onRetry={state.refetch} />
      ) : state.data && state.data.data.length > 0 ? (
        <div className="grid">
          {state.data.data.map((m) => (
            <article className="card" key={m.address}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <Link href={`/mandates/${m.address}`}>{m.address.slice(0, 8)}…</Link>
                <StatusBadge status={m.account.status} />
              </div>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Started {formatUnixSeconds(m.account.startAt)} · {m.account.finalizedEpochs}/
                {m.account.totalEpochs} epochs resolved
              </p>
              <div className="stack" style={{ gap: "0.25rem" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">Earned</span>
                  <Amount pair={m.accounting.earned} />
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">Claimable now</span>
                  <Amount pair={m.accounting.claimableByProvider} />
                </div>
              </div>
              <p style={{ marginBottom: 0 }}>
                <Link href={`/mandates/${m.address}`}>
                  Open mandate to claim or register positions →
                </Link>
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">
          No mandate has recorded this wallet as its provider yet. Bid on an open mandate to get
          started.
        </p>
      )}
    </div>
  );
}

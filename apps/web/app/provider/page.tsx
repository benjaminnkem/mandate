"use client";

import Link from "next/link";

import { Amount } from "../../components/Amount.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Loading } from "../../components/Loading.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { Card, CardContent } from "../../components/ui/card.tsx";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Provider workspace</h1>
        <p className="mt-2 max-w-[60ch] text-muted-foreground">
          Every mandate your connected wallet has bid on or been awarded, with what you have earned
          and can still claim. Bidding, position registration and claiming happen on each
          mandate&rsquo;s own page.
        </p>
      </div>

      {!account ? (
        <p className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn-foreground">
          Connect a wallet above to see your mandates.
        </p>
      ) : state.status === "loading" ? (
        <Loading label="Loading your mandates" />
      ) : state.status === "error" ? (
        <ErrorNotice error={state.error} onRetry={state.refetch} />
      ) : state.data && state.data.data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {state.data.data.map((m) => (
            <Card key={m.address}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/mandates/${m.address}`} className="font-mono-data hover:underline">
                    {m.address.slice(0, 8)}...
                  </Link>
                  <StatusBadge status={m.account.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Started {formatUnixSeconds(m.account.startAt)}. {m.account.finalizedEpochs}/
                  {m.account.totalEpochs} epochs resolved
                </p>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Earned</span>
                    <Amount pair={m.accounting.earned} />
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Claimable now</span>
                    <Amount pair={m.accounting.claimableByProvider} />
                  </div>
                </div>
                <Link
                  href={`/mandates/${m.address}`}
                  className="text-sm text-primary hover:underline"
                >
                  Open mandate to claim or register positions
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">
          No mandate has recorded this wallet as its provider yet. Bid on an open mandate to get
          started.
        </p>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo } from "react";

import { AddressTag } from "../../components/AddressTag.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Loading } from "../../components/Loading.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Card } from "../../components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Explore mandates</h1>
        <p className="mt-2 text-muted-foreground">
          Every mandate the indexer has recorded, filterable by status, provider or sponsor.
        </p>
      </div>

      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-3"
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={status}
              className="h-8 w-44 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider">Provider address</Label>
            <Input
              id="provider"
              name="provider"
              defaultValue={provider}
              placeholder="Base58 address"
              className="w-56"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sponsor">Sponsor address</Label>
            <Input
              id="sponsor"
              name="sponsor"
              defaultValue={sponsor}
              placeholder="Base58 address"
              className="w-56"
            />
          </div>
          <Button type="submit">Apply filters</Button>
        </form>
      </Card>

      {state.status === "loading" ? <Loading label="Loading mandates" /> : null}
      {state.status === "error" ? (
        <ErrorNotice error={state.error} onRetry={state.refetch} />
      ) : null}

      {state.status === "ready" && state.data.data.mandates.length === 0 ? (
        <p className="text-muted-foreground">No mandate matches these filters.</p>
      ) : null}

      {state.status === "ready" && state.data.data.mandates.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <caption className="visually-hidden">Mandates matching the current filters</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Mandate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sponsor</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Max reward</TableHead>
                <TableHead>Starts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.data.mandates.map((m) => (
                <TableRow key={m.address}>
                  <TableCell>
                    <Link href={`/mandates/${m.address}`} className="hover:underline">
                      <AddressTag address={m.address} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.account.status} />
                  </TableCell>
                  <TableCell>
                    <AddressTag address={m.account.sponsor} />
                  </TableCell>
                  <TableCell>
                    <AddressTag address={m.account.provider} />
                  </TableCell>
                  <TableCell>{usdc(m.account.maxRewardRaw)} USDC</TableCell>
                  <TableCell>{formatUnixSeconds(m.account.startAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {state.status === "ready" && state.data.data.nextAfter ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            setParams({ status, provider, sponsor, after: state.data.data.nextAfter ?? "" });
          }}
        >
          Next page
        </Button>
      ) : null}
    </div>
  );
}

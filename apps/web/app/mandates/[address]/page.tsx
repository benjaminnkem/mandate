"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState, type ReactNode } from "react";

import { AddressTag } from "../../../components/AddressTag.tsx";
import { Amount } from "../../../components/Amount.tsx";
import { ErrorNotice } from "../../../components/ErrorNotice.tsx";
import { Loading } from "../../../components/Loading.tsx";
import { StatusBadge } from "../../../components/StatusBadge.tsx";
import { TransactionAction } from "../../../components/TransactionAction.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { Label } from "../../../components/ui/label.tsx";
import { Textarea } from "../../../components/ui/textarea.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";
import {
  buildAcceptBidTx,
  buildClaimTx,
  buildRegisterPositionsTx,
  buildSubmitBidTx,
  buildWithdrawTx,
  getEpochTimeline,
  getMandate,
  listBids,
} from "../../../lib/api.ts";
import { formatBps, formatUnixSeconds, relativeToNow, usdc } from "../../../lib/format.ts";
import { myUsdcAta } from "../../../lib/solana/usdc.ts";
import { preparedFromApiBundle } from "../../../lib/solana/transactions.ts";
import { useWallet } from "../../../lib/solana/wallet-standard.tsx";
import { useApi } from "../../../lib/useApi.ts";
import type { BidAccountJson, Row } from "../../../lib/types.ts";

export default function MandateDetailPage() {
  const { address } = useParams<{ address: string }>();
  const detail = useApi(() => getMandate(address), [address]);
  const bids = useApi(() => listBids(address), [address]);
  const epochs = useApi(() => getEpochTimeline(address), [address]);
  const { account } = useWallet();
  // Read once after mount rather than during render, which must stay pure; the one-render lag before this
  // turns non-null only delays showing the register-positions button, it never shows a wrong answer.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Synchronizing with the platform clock on mount is what this effect is for, not an accidental cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Math.floor(Date.now() / 1000));
  }, []);

  if (detail.status === "loading") return <Loading label="Loading mandate" />;
  if (detail.status === "error")
    return <ErrorNotice error={detail.error} onRetry={detail.refetch} />;

  const m = detail.data.data;
  const isSponsor = account?.address === m.account.sponsor;
  const isProvider = account?.address === m.account.provider;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Mandate</h1>
          <StatusBadge status={m.account.status} />
        </div>
        <div className="mt-1">
          <AddressTag address={m.address} label="Address" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parties</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-between gap-3">
          <AddressTag address={m.account.sponsor} label="Sponsor" />
          <AddressTag address={m.account.provider} label="Provider" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terms, fixed at creation and immutable</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Schedule</h3>
            <dl className="mt-2 flex flex-col gap-2">
              <Fact label="Bidding ends" value={formatUnixSeconds(m.account.biddingEndsAt)} />
              <Fact
                label="Starts"
                value={`${formatUnixSeconds(m.account.startAt)} (${relativeToNow(m.account.startAt)})`}
              />
              <Fact label="Ends" value={formatUnixSeconds(m.account.endAt)} />
              <Fact
                label="Epoch length"
                value={`${m.account.epochSeconds}s x ${String(m.account.totalEpochs)} epochs`}
              />
              <Fact label="Position lock" value={formatUnixSeconds(m.account.positionLockAt)} />
              <Fact
                label="Attestation recovery window"
                value={`${m.account.unavailableRecoverySeconds}s`}
              />
            </dl>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Quality thresholds (SLA)</h3>
            <dl className="mt-2 flex flex-col gap-2">
              <Fact
                label="Max effective spread"
                value={formatBps(m.account.maxEffectiveSpreadBps)}
              />
              <Fact label="Depth band" value={formatBps(m.account.depthBandBps)} />
              <Fact
                label="Min pool buy depth"
                value={`${usdc(m.account.minPoolBuyDepthQuoteRaw)} USDC`}
              />
              <Fact
                label="Min pool sell depth"
                value={`${usdc(m.account.minPoolSellDepthQuoteRaw)} USDC`}
              />
              <Fact
                label="Min provider quote in band"
                value={`${usdc(m.account.minProviderQuoteInBandRaw)} USDC`}
              />
              <Fact
                label="Min provider base in band (USDC-eq.)"
                value={`${usdc(m.account.minProviderBaseQuoteEqInBandRaw)} USDC`}
              />
              <Fact label="Probe size" value={`${usdc(m.account.probeQuoteRaw)} USDC`} />
              <Fact label="Algorithm version" value={String(m.account.algorithmVersion)} />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reward accounting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Deposited (max)" value={<Amount pair={m.accounting.deposited} />} />
            <Fact label="Accepted" value={<Amount pair={m.accounting.accepted} />} />
            <Fact label="Earned by provider" value={<Amount pair={m.accounting.earned} />} />
            <Fact label="Forfeited" value={<Amount pair={m.accounting.forfeited} />} />
            <Fact
              label="Unresolved (open epochs)"
              value={<Amount pair={m.accounting.unresolved} />}
            />
            <Fact label="Claimed by provider" value={<Amount pair={m.accounting.claimed} />} />
            <Fact
              label="Claimable now"
              value={<Amount pair={m.accounting.claimableByProvider} />}
            />
            <Fact
              label="Withdrawn by sponsor"
              value={<Amount pair={m.accounting.sponsorWithdrawn} />}
            />
            <Fact
              label="Withdrawable by sponsor now"
              value={<Amount pair={m.accounting.withdrawableBySponsor} />}
            />
            <Fact label="Vault should hold" value={<Amount pair={m.accounting.expectedVault} />} />
          </div>
          {m.vaultReconciliation ? (
            <p
              className={
                m.vaultReconciliation.ok
                  ? "rounded-md border border-ok/40 bg-ok-bg px-3 py-2 text-sm text-ok-foreground"
                  : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              }
            >
              Vault reconciliation as of{" "}
              {new Date(m.vaultReconciliation.checkedAt).toLocaleString()}:{" "}
              {m.vaultReconciliation.ok
                ? "matches the ledger exactly."
                : "does NOT match the ledger. Treat as an incident."}
            </p>
          ) : null}

          <div className="flex gap-3">
            {isProvider ? (
              <ClaimAction
                mandate={m.address}
                account={account.address}
                claimableRaw={m.accounting.claimableByProvider.raw}
              />
            ) : null}
            {isSponsor ? (
              <WithdrawAction
                mandate={m.address}
                account={account.address}
                withdrawableRaw={m.accounting.withdrawableBySponsor.raw}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Position set</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {m.positionSet ? (
            <>
              <p className="text-sm text-muted-foreground">
                Locked {formatUnixSeconds(m.positionSet.account.lockedAt)}
              </p>
              <ul className="flex flex-col gap-1">
                {m.positionSet.account.positions
                  .slice(0, m.positionSet.account.positionCount)
                  .map((p, i) => (
                    <li key={`${String(i)}-${p}`} className="font-mono-data text-sm">
                      {p}
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                The program stores these addresses but does not verify ownership on chain. Observers
                measure that separately, and a position not actually owned by the provider counts as
                zero.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">No position set has been registered yet.</p>
          )}
          {isProvider &&
          !m.positionSet &&
          m.account.status === "Awarded" &&
          now !== null &&
          now < Number(m.account.positionLockAt) ? (
            <RegisterPositionsAction mandate={m.address} account={account.address} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bids</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {bids.status === "loading" ? <Loading label="Loading bids" /> : null}
          {bids.status === "error" ? (
            <ErrorNotice error={bids.error} onRetry={bids.refetch} />
          ) : null}
          {bids.status === "ready" ? (
            <BidsTable
              bids={bids.data.data}
              mandate={m.address}
              mandateStatus={m.account.status}
              isSponsor={isSponsor}
              connected={account?.address ?? null}
            />
          ) : null}
          {!isSponsor && m.account.status === "Bidding" && account ? (
            <SubmitBidAction
              mandate={m.address}
              account={account.address}
              biddingEndsAt={m.account.biddingEndsAt}
              totalEpochs={m.account.totalEpochs}
              maxRewardRaw={m.account.maxRewardRaw}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Epoch timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {epochs.status === "loading" ? <Loading label="Loading epochs" /> : null}
          {epochs.status === "error" ? (
            <ErrorNotice error={epochs.error} onRetry={epochs.refetch} />
          ) : null}
          {epochs.status === "ready" ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <caption className="visually-hidden">Per-epoch outcomes</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Epoch</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Attestations</TableHead>
                    <TableHead>Reward earned</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {epochs.data.data.epochs.map((e) => (
                    <TableRow key={e.epoch}>
                      <TableCell>{e.epoch}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.outcome} />
                      </TableCell>
                      <TableCell>{e.attestationCount}</TableCell>
                      <TableCell>
                        {e.result ? usdc(e.result.account.rewardEarnedRaw) : "-"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/mandates/${m.address}/evidence/${String(e.epoch)}`}
                          className="text-primary hover:underline"
                        >
                          Inspect
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}

function ClaimAction({
  mandate,
  account,
  claimableRaw,
}: {
  mandate: string;
  account: string;
  claimableRaw: string;
}) {
  const [amountUsdc, setAmountUsdc] = useState("");
  const destination = myUsdcAta(new PublicKey(account)).toBase58();
  const claimable = BigInt(claimableRaw);
  if (claimable === 0n)
    return <p className="text-sm text-muted-foreground">Nothing is claimable yet.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="claim-amount">Amount to claim (USDC, up to {usdc(claimableRaw)})</Label>
      <div className="flex gap-2">
        <Input
          id="claim-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
          placeholder={usdc(claimableRaw)}
          className="max-w-40"
        />
        <TransactionAction
          label="Claim reward"
          disabled={!isPositiveDecimal(amountUsdc)}
          prepare={async () =>
            preparedFromApiBundle(
              await buildClaimTx({
                wallet: account,
                mandate,
                destinationUsdc: destination,
                amountRaw: toRaw(amountUsdc),
              }),
            )
          }
        />
      </div>
    </div>
  );
}

function WithdrawAction({
  mandate,
  account,
  withdrawableRaw,
}: {
  mandate: string;
  account: string;
  withdrawableRaw: string;
}) {
  const [amountUsdc, setAmountUsdc] = useState("");
  const destination = myUsdcAta(new PublicKey(account)).toBase58();
  if (BigInt(withdrawableRaw) === 0n)
    return <p className="text-sm text-muted-foreground">Nothing is withdrawable yet.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="withdraw-amount">
        Amount to withdraw (USDC, up to {usdc(withdrawableRaw)})
      </Label>
      <div className="flex gap-2">
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
          placeholder={usdc(withdrawableRaw)}
          className="max-w-40"
        />
        <TransactionAction
          label="Withdraw"
          variant="outline"
          disabled={!isPositiveDecimal(amountUsdc)}
          prepare={async () =>
            preparedFromApiBundle(
              await buildWithdrawTx({
                wallet: account,
                mandate,
                destinationUsdc: destination,
                amountRaw: toRaw(amountUsdc),
              }),
            )
          }
        />
      </div>
    </div>
  );
}

function RegisterPositionsAction({ mandate, account }: { mandate: string; account: string }) {
  const [text, setText] = useState("");
  const positions = text
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="positions">Position addresses (comma or newline separated, up to 8)</Label>
      <Textarea
        id="positions"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <TransactionAction
        label="Register positions"
        disabled={positions.length === 0 || positions.length > 8}
        prepare={async () =>
          preparedFromApiBundle(
            await buildRegisterPositionsTx({ wallet: account, mandate, positions }),
          )
        }
      />
    </div>
  );
}

function SubmitBidAction({
  mandate,
  account,
  biddingEndsAt,
  totalEpochs,
  maxRewardRaw,
}: {
  mandate: string;
  account: string;
  biddingEndsAt: string;
  totalEpochs: number;
  maxRewardRaw: string;
}) {
  const [amountUsdc, setAmountUsdc] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="bid-amount">
        Requested total reward (USDC, up to {usdc(maxRewardRaw)}, split across {totalEpochs} epochs)
      </Label>
      <div className="flex gap-2">
        <Input
          id="bid-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
          className="max-w-40"
        />
        <TransactionAction
          label="Submit bid"
          disabled={!isPositiveDecimal(amountUsdc)}
          prepare={async () =>
            preparedFromApiBundle(
              await buildSubmitBidTx({
                wallet: account,
                mandate,
                nonce: String(Date.now()),
                requestedRewardRaw: toRaw(amountUsdc),
                validUntil: biddingEndsAt,
              }),
            )
          }
        />
      </div>
    </div>
  );
}

function BidsTable({
  bids,
  mandate,
  mandateStatus,
  isSponsor,
  connected,
}: {
  bids: readonly Row<BidAccountJson>[];
  mandate: string;
  mandateStatus: string;
  isSponsor: boolean;
  connected: string | null;
}) {
  if (bids.length === 0) return <p className="text-sm text-muted-foreground">No bids yet.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <caption className="visually-hidden">Bids on this mandate</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Requested reward</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Valid until</TableHead>
            {isSponsor ? <TableHead>Action</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {bids.map((bid) => (
            <TableRow key={bid.address}>
              <TableCell>
                <AddressTag address={bid.account.provider} />
              </TableCell>
              <TableCell>{usdc(bid.account.requestedRewardRaw)} USDC</TableCell>
              <TableCell>
                <StatusBadge status={bid.account.status} />
              </TableCell>
              <TableCell>{formatUnixSeconds(bid.account.validUntil)}</TableCell>
              {isSponsor ? (
                <TableCell>
                  {mandateStatus === "Bidding" && bid.account.status === "Active" && connected ? (
                    <TransactionAction
                      label="Accept"
                      prepare={async () =>
                        preparedFromApiBundle(
                          await buildAcceptBidTx({
                            wallet: connected,
                            mandate,
                            provider: bid.account.provider,
                            nonce: bid.account.nonce,
                          }),
                        )
                      }
                    />
                  ) : (
                    "-"
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d{1,6})?$/.test(value) && Number(value) > 0;
}

/** Parse a decimal USDC string typed by a person into raw integer units, never through a floating-point number. */
function toRaw(decimal: string): string {
  const [whole, frac = ""] = decimal.split(".");
  const paddedFrac = frac.padEnd(6, "0").slice(0, 6);
  return (BigInt(whole || "0") * 1_000_000n + BigInt(paddedFrac || "0")).toString();
}

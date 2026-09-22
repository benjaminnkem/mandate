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
    <div className="stack" style={{ gap: "1.75rem" }}>
      <div>
        <div className="row" style={{ alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Mandate</h1>
          <StatusBadge status={m.account.status} />
        </div>
        <AddressTag address={m.address} label="Address" />
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Parties</h2>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <AddressTag address={m.account.sponsor} label="Sponsor" />
          <AddressTag address={m.account.provider} label="Provider" />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Terms (fixed at creation and immutable)</h2>
        <div className="grid">
          <div>
            <h3>Schedule</h3>
            <dl className="stack" style={{ gap: "0.3rem" }}>
              <Fact label="Bidding ends" value={formatUnixSeconds(m.account.biddingEndsAt)} />
              <Fact
                label="Starts"
                value={`${formatUnixSeconds(m.account.startAt)} (${relativeToNow(m.account.startAt)})`}
              />
              <Fact label="Ends" value={formatUnixSeconds(m.account.endAt)} />
              <Fact
                label="Epoch length"
                value={`${m.account.epochSeconds}s × ${String(m.account.totalEpochs)} epochs`}
              />
              <Fact label="Position lock" value={formatUnixSeconds(m.account.positionLockAt)} />
              <Fact
                label="Attestation recovery window"
                value={`${m.account.unavailableRecoverySeconds}s`}
              />
            </dl>
          </div>
          <div>
            <h3>Quality thresholds (SLA)</h3>
            <dl className="stack" style={{ gap: "0.3rem" }}>
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
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Reward accounting</h2>
        <div className="grid">
          <Fact label="Deposited (max)" value={<Amount pair={m.accounting.deposited} />} />
          <Fact label="Accepted" value={<Amount pair={m.accounting.accepted} />} />
          <Fact label="Earned by provider" value={<Amount pair={m.accounting.earned} />} />
          <Fact label="Forfeited" value={<Amount pair={m.accounting.forfeited} />} />
          <Fact
            label="Unresolved (open epochs)"
            value={<Amount pair={m.accounting.unresolved} />}
          />
          <Fact label="Claimed by provider" value={<Amount pair={m.accounting.claimed} />} />
          <Fact label="Claimable now" value={<Amount pair={m.accounting.claimableByProvider} />} />
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
            className={`notice ${m.vaultReconciliation.ok ? "ok" : "danger"}`}
            style={{ marginTop: "0.75rem" }}
          >
            Vault reconciliation as of {new Date(m.vaultReconciliation.checkedAt).toLocaleString()}:{" "}
            {m.vaultReconciliation.ok
              ? "matches the ledger exactly."
              : "does NOT match the ledger — treat as an incident."}
          </p>
        ) : null}

        <div className="row" style={{ marginTop: "1rem" }}>
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
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Position set</h2>
        {m.positionSet ? (
          <>
            <p className="muted">Locked {formatUnixSeconds(m.positionSet.account.lockedAt)}</p>
            <ul>
              {m.positionSet.account.positions.map((p) => (
                <li key={p} className="mono">
                  {p}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              The program stores these addresses but does not verify ownership on chain; observers
              measure that separately, and a position not actually owned by the provider counts as
              zero.
            </p>
          </>
        ) : (
          <p className="muted">No position set has been registered yet.</p>
        )}
        {isProvider &&
        !m.positionSet &&
        m.account.status === "Awarded" &&
        now !== null &&
        now < Number(m.account.positionLockAt) ? (
          <RegisterPositionsAction mandate={m.address} account={account.address} />
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Bids</h2>
        {bids.status === "loading" ? <Loading label="Loading bids" /> : null}
        {bids.status === "error" ? <ErrorNotice error={bids.error} onRetry={bids.refetch} /> : null}
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
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Epoch timeline</h2>
        {epochs.status === "loading" ? <Loading label="Loading epochs" /> : null}
        {epochs.status === "error" ? (
          <ErrorNotice error={epochs.error} onRetry={epochs.refetch} />
        ) : null}
        {epochs.status === "ready" ? (
          <div style={{ overflowX: "auto" }}>
            <table>
              <caption className="visually-hidden">Per-epoch outcomes</caption>
              <thead>
                <tr>
                  <th scope="col">Epoch</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Attestations</th>
                  <th scope="col">Reward earned</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {epochs.data.data.epochs.map((e) => (
                  <tr key={e.epoch}>
                    <td>{e.epoch}</td>
                    <td>
                      <StatusBadge status={e.outcome} />
                    </td>
                    <td>{e.attestationCount}</td>
                    <td>{e.result ? usdc(e.result.account.rewardEarnedRaw) : "—"}</td>
                    <td>
                      <Link href={`/mandates/${m.address}/evidence/${String(e.epoch)}`}>
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="muted" style={{ fontSize: "0.82rem" }}>
        {label}
      </dt>
      <dd style={{ margin: 0 }}>{value}</dd>
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
  if (claimable === 0n) return <p className="muted">Nothing is claimable yet.</p>;
  return (
    <div className="field">
      <label htmlFor="claim-amount">Amount to claim (USDC, up to {usdc(claimableRaw)})</label>
      <div className="row">
        <input
          id="claim-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
          placeholder={usdc(claimableRaw)}
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
  if (BigInt(withdrawableRaw) === 0n) return <p className="muted">Nothing is withdrawable yet.</p>;
  return (
    <div className="field">
      <label htmlFor="withdraw-amount">
        Amount to withdraw (USDC, up to {usdc(withdrawableRaw)})
      </label>
      <div className="row">
        <input
          id="withdraw-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
          placeholder={usdc(withdrawableRaw)}
        />
        <TransactionAction
          label="Withdraw"
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
    <div className="field" style={{ marginTop: "0.75rem" }}>
      <label htmlFor="positions">Position addresses (comma or newline separated, up to 8)</label>
      <textarea
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
    <div className="field" style={{ marginTop: "0.75rem" }}>
      <label htmlFor="bid-amount">
        Requested total reward (USDC, up to {usdc(maxRewardRaw)}, split across {totalEpochs} epochs)
      </label>
      <div className="row">
        <input
          id="bid-amount"
          inputMode="decimal"
          value={amountUsdc}
          onChange={(e) => {
            setAmountUsdc(e.target.value);
          }}
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
  if (bids.length === 0) return <p className="muted">No bids yet.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <caption className="visually-hidden">Bids on this mandate</caption>
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Requested reward</th>
            <th scope="col">Status</th>
            <th scope="col">Valid until</th>
            {isSponsor ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {bids.map((bid) => (
            <tr key={bid.address}>
              <td>
                <AddressTag address={bid.account.provider} />
              </td>
              <td>{usdc(bid.account.requestedRewardRaw)} USDC</td>
              <td>
                <StatusBadge status={bid.account.status} />
              </td>
              <td>{formatUnixSeconds(bid.account.validUntil)}</td>
              {isSponsor ? (
                <td>
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
                    "—"
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
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

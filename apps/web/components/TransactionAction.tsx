"use client";

import { useEffect, useId, useRef, useState } from "react";

import { amountPair, type AmountPair } from "../lib/format.ts";
import { getConnection } from "../lib/solana/connection.ts";
import { pollForConfirmation, type PreparedTransaction } from "../lib/solana/transactions.ts";
import { useWallet } from "../lib/solana/wallet-standard.tsx";

export type { PreparedTransaction } from "../lib/solana/transactions.ts";

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "building" }
  | ({ readonly kind: "review" } & PreparedTransaction)
  | ({ readonly kind: "signing" } & PreparedTransaction)
  | ({ readonly kind: "pending"; readonly signature: string } & PreparedTransaction)
  | ({ readonly kind: "confirmed"; readonly signature: string } & PreparedTransaction)
  | ({
      readonly kind: "failed";
      readonly signature: string;
      readonly reason: string;
    } & PreparedTransaction)
  | ({ readonly kind: "expired"; readonly signature: string } & PreparedTransaction)
  | { readonly kind: "error"; readonly message: string };

function isAmountPair(value: unknown): value is AmountPair {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<AmountPair>).raw === "string" &&
    typeof (value as Partial<AmountPair>).usdc === "string"
  );
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Render a tx-builder `summary` object generically: amount pairs get the exact raw/USDC treatment, everything
 * else is printed as given. Unknown future summary fields still show up instead of silently disappearing. */
function SummaryList({ summary }: { summary: Record<string, unknown> }) {
  return (
    <dl className="stack" style={{ gap: "0.4rem" }}>
      {Object.entries(summary).map(([key, value]) => (
        <div className="row" key={key} style={{ justifyContent: "space-between", gap: "1rem" }}>
          <dt className="muted">{humanize(key)}</dt>
          <dd style={{ margin: 0, textAlign: "right" }}>
            {isAmountPair(value) ? (
              <span className="amount">
                <span className="usdc">{value.usdc} USDC</span>{" "}
                <span className="raw">({value.raw} raw)</span>
              </span>
            ) : Array.isArray(value) ? (
              <span className="mono">{value.map(String).join(", ")}</span>
            ) : (
              <span className={typeof value === "string" && value.length > 40 ? "mono" : undefined}>
                {String(value)}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface TransactionActionProps {
  /** Text on the trigger button, e.g. "Submit bid". */
  readonly label: string;
  readonly disabled?: boolean;
  /** Build the unsigned transaction and its exact economic summary. Called fresh every time the dialog opens. */
  readonly prepare: () => Promise<PreparedTransaction>;
  readonly onConfirmed?: (signature: string) => void;
}

/**
 * The one financial write path in this app. It always: shows the exact raw and display USDC amounts and the
 * quoted expiry before asking for a signature; signs only through the connected wallet (never a private key
 * this app could see); and reports pending / confirmed / failed / expired strictly from what the chain itself
 * returns, never an optimistic success the moment a signature is produced.
 */
export function TransactionAction({
  label,
  disabled,
  prepare,
  onConfirmed,
}: TransactionActionProps) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const open = phase.kind !== "idle";
  const settling = phase.kind === "signing" || phase.kind === "pending";

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  async function start() {
    setPhase({ kind: "building" });
    try {
      const prepared = await prepare();
      setPhase({ kind: "review", ...prepared });
    } catch (cause) {
      setPhase({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Could not prepare this transaction.",
      });
    }
  }

  function close() {
    if (settling) return; // never abandon the dialog mid-flight; the chain result must be seen
    setPhase({ kind: "idle" });
    triggerRef.current?.focus();
  }

  async function confirm() {
    if (phase.kind !== "review") return;
    const prepared = phase;
    setPhase({ ...prepared, kind: "signing" });
    try {
      const { signature, lastValidBlockHeight } = await wallet.signAndSend(prepared.bundle);
      setPhase({ ...prepared, kind: "pending", signature });
      const outcome = await pollForConfirmation(getConnection(), signature, lastValidBlockHeight);
      if (outcome.status === "confirmed") {
        setPhase({ ...prepared, kind: "confirmed", signature });
        onConfirmed?.(signature);
      } else if (outcome.status === "failed") {
        setPhase({ ...prepared, kind: "failed", signature, reason: outcome.reason });
      } else {
        setPhase({ ...prepared, kind: "expired", signature });
      }
    } catch (cause) {
      setPhase({
        kind: "error",
        message:
          cause instanceof Error ? cause.message : "The wallet did not sign this transaction.",
      });
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="primary"
        disabled={disabled}
        onClick={() => void start()}
      >
        {label}
      </button>
      {open ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <h2 id={headingId} style={{ marginTop: 0 }}>
              {label}
            </h2>

            {phase.kind === "building" ? <p>Preparing the transaction…</p> : null}

            {phase.kind === "error" ? (
              <>
                <p role="alert" className="notice danger">
                  {phase.message}
                </p>
                <button type="button" onClick={close}>
                  Close
                </button>
              </>
            ) : null}

            {(phase.kind === "review" ||
              phase.kind === "signing" ||
              phase.kind === "pending" ||
              phase.kind === "confirmed" ||
              phase.kind === "failed" ||
              phase.kind === "expired") && <SummaryList summary={phase.summary} />}

            {phase.kind === "review" ? (
              <div className="stack" style={{ marginTop: "1rem" }}>
                <p className="notice warn">
                  This is irreversible once confirmed on chain. Review every value above against
                  what your wallet shows before approving.
                  {phase.expiresAfterBlockHeight !== undefined
                    ? ` This quote is valid until block height ${phase.expiresAfterBlockHeight.toLocaleString()}; a fresh blockhash is fetched right before signing.`
                    : ""}
                </p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" onClick={close}>
                    Cancel
                  </button>
                  <button type="button" className="primary" onClick={() => void confirm()}>
                    Confirm in wallet
                  </button>
                </div>
              </div>
            ) : null}

            {phase.kind === "signing" ? (
              <p aria-live="polite" className="status" data-status="signing">
                Awaiting your signature in the wallet…
              </p>
            ) : null}

            {phase.kind === "pending" ? (
              <div aria-live="polite" className="stack" style={{ marginTop: "0.75rem" }}>
                <span className="status" data-status="pending">
                  Pending confirmation
                </span>
                <p className="muted mono" style={{ fontSize: "0.8rem" }}>
                  signature {phase.signature}
                </p>
              </div>
            ) : null}

            {phase.kind === "confirmed" ? (
              <div aria-live="polite" className="stack" style={{ marginTop: "0.75rem" }}>
                <span className="status" data-status="confirmed">
                  Confirmed
                </span>
                <p className="muted mono" style={{ fontSize: "0.8rem" }}>
                  signature {phase.signature}
                </p>
                <button type="button" onClick={close}>
                  Done
                </button>
              </div>
            ) : null}

            {phase.kind === "failed" ? (
              <div aria-live="assertive" className="stack" style={{ marginTop: "0.75rem" }}>
                <span className="status" data-status="failed">
                  Failed on chain
                </span>
                <p className="mono" style={{ fontSize: "0.8rem" }}>
                  {phase.reason}
                </p>
                <button type="button" onClick={close}>
                  Close
                </button>
              </div>
            ) : null}

            {phase.kind === "expired" ? (
              <div aria-live="assertive" className="stack" style={{ marginTop: "0.75rem" }}>
                <span className="status" data-status="expired">
                  Expired before confirming
                </span>
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Its blockhash went stale before the network confirmed it. It never took effect;
                  nothing was charged. You can try again.
                </p>
                <button type="button" onClick={close}>
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Convenience for building a summary field the same way the API does. */
export const summaryAmount = amountPair;

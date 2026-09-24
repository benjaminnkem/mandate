"use client";

import { AlarmClockOff, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
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
    <dl className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
      {Object.entries(summary).map(([key, value]) => (
        <div className="flex items-baseline justify-between gap-4" key={key}>
          <dt className="text-muted-foreground">{humanize(key)}</dt>
          <dd className="m-0 text-right">
            {isAmountPair(value) ? (
              <span>
                <span className="font-medium">{value.usdc} USDC</span>{" "}
                <span className="font-mono-data text-xs text-muted-foreground">
                  ({value.raw} raw)
                </span>
              </span>
            ) : Array.isArray(value) ? (
              <span className="font-mono-data break-all">{value.map(String).join(", ")}</span>
            ) : (
              <span
                className={
                  typeof value === "string" && value.length > 40
                    ? "font-mono-data break-all"
                    : undefined
                }
              >
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
  readonly variant?: "default" | "outline" | "destructive";
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
  variant = "default",
  prepare,
  onConfirmed,
}: TransactionActionProps) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const open = phase.kind !== "idle";
  const settling = phase.kind === "signing" || phase.kind === "pending";

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
      <Button type="button" variant={variant} disabled={disabled} onClick={() => void start()}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent showCloseButton={!settling}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            {phase.kind === "review" ? (
              <DialogDescription>
                This is irreversible once confirmed on chain. Review every value below against what
                your wallet shows before approving.
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {phase.kind === "building" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Preparing the transaction.
            </p>
          ) : null}

          {phase.kind === "error" ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {phase.message}
            </p>
          ) : null}

          {phase.kind === "review" ||
          phase.kind === "signing" ||
          phase.kind === "pending" ||
          phase.kind === "confirmed" ||
          phase.kind === "failed" ||
          phase.kind === "expired" ? (
            <SummaryList summary={phase.summary} />
          ) : null}

          {phase.kind === "review" ? (
            <p className="text-xs text-muted-foreground">
              {phase.expiresAfterBlockHeight !== undefined
                ? `This quote is valid until block height ${phase.expiresAfterBlockHeight.toLocaleString()}. A fresh blockhash is fetched right before signing.`
                : null}
            </p>
          ) : null}

          {phase.kind === "signing" ? (
            <p
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-pending-foreground"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Awaiting your signature in the wallet.
            </p>
          ) : null}

          {phase.kind === "pending" ? (
            <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
              <p className="flex items-center gap-2 text-pending-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Pending confirmation
              </p>
              <p className="break-all font-mono-data text-xs text-muted-foreground">
                signature {phase.signature}
              </p>
            </div>
          ) : null}

          {phase.kind === "confirmed" ? (
            <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
              <p className="flex items-center gap-2 text-ok-foreground">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Confirmed
              </p>
              <p className="break-all font-mono-data text-xs text-muted-foreground">
                signature {phase.signature}
              </p>
            </div>
          ) : null}

          {phase.kind === "failed" ? (
            <div aria-live="assertive" className="flex flex-col gap-1.5 text-sm">
              <p className="flex items-center gap-2 text-destructive">
                <XCircle className="size-4" aria-hidden="true" />
                Failed on chain
              </p>
              <p className="font-mono-data text-xs">{phase.reason}</p>
            </div>
          ) : null}

          {phase.kind === "expired" ? (
            <div aria-live="assertive" className="flex flex-col gap-1.5 text-sm">
              <p className="flex items-center gap-2 text-warn-foreground">
                <AlarmClockOff className="size-4" aria-hidden="true" />
                Expired before confirming
              </p>
              <p className="text-muted-foreground">
                Its blockhash went stale before the network confirmed it. It never took effect;
                nothing was charged. You can try again.
              </p>
            </div>
          ) : null}

          {phase.kind === "review" ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void confirm()}>
                Confirm in wallet
              </Button>
            </DialogFooter>
          ) : null}

          {phase.kind === "error" ||
          phase.kind === "confirmed" ||
          phase.kind === "failed" ||
          phase.kind === "expired" ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Convenience for building a summary field the same way the API does. */
export const summaryAmount = amountPair;

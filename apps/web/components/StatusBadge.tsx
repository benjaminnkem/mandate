import {
  AlarmClockOff,
  Ban,
  CheckCircle2,
  CircleDot,
  Hourglass,
  Loader2,
  Lock,
  Megaphone,
  MinusCircle,
  XCircle,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "./ui/badge.tsx";
import { EPOCH_OUTCOME_LABEL, MANDATE_STATUS_LABEL } from "../lib/format.ts";

interface Spec {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string | undefined }>;
  readonly className: string;
  /** Set on confirmed/pending phases whose icon should spin. */
  readonly spin?: boolean;
}

/**
 * Every status is distinguished by its own icon AND its own text label, never by color alone, so the
 * distinction survives grayscale, color blindness and screen readers alike.
 */
const SPECS: Record<string, Spec> = {
  // Epoch outcomes
  Compliant: { label: "Compliant", icon: CheckCircle2, className: "bg-ok-bg text-ok-foreground" },
  NonCompliant: {
    label: "Non-compliant",
    icon: XCircle,
    className: "bg-destructive/15 text-destructive",
  },
  Unavailable: {
    label: "Unavailable (not measured)",
    icon: Hourglass,
    className: "bg-warn-bg text-warn-foreground",
  },
  // Mandate lifecycle
  Bidding: {
    label: "Open for bids",
    icon: Megaphone,
    className: "bg-pending-bg text-pending-foreground",
  },
  Awarded: {
    label: "Awarded, not yet started",
    icon: CheckCircle2,
    className: "bg-ok-bg text-ok-foreground",
  },
  Active: { label: "Active", icon: CircleDot, className: "bg-primary/15 text-primary" },
  AwaitingFinalization: {
    label: "Awaiting final settlement",
    icon: Hourglass,
    className: "bg-warn-bg text-warn-foreground",
  },
  Closed: { label: "Closed", icon: Lock, className: "bg-pending-bg text-pending-foreground" },
  Cancelled: { label: "Cancelled", icon: Ban, className: "bg-pending-bg text-pending-foreground" },
  // Bid lifecycle
  RejectedByAward: {
    label: "Not accepted",
    icon: MinusCircle,
    className: "bg-pending-bg text-pending-foreground",
  },
  // Transaction phases
  signing: {
    label: "Awaiting your signature",
    icon: Loader2,
    className: "bg-pending-bg text-pending-foreground",
    spin: true,
  },
  pending: {
    label: "Pending confirmation",
    icon: Loader2,
    className: "bg-pending-bg text-pending-foreground",
    spin: true,
  },
  confirmed: { label: "Confirmed", icon: CheckCircle2, className: "bg-ok-bg text-ok-foreground" },
  failed: {
    label: "Failed on chain",
    icon: XCircle,
    className: "bg-destructive/15 text-destructive",
  },
  expired: {
    label: "Expired before confirming",
    icon: AlarmClockOff,
    className: "bg-warn-bg text-warn-foreground",
  },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const spec = SPECS[status];
  const text =
    label ?? spec?.label ?? EPOCH_OUTCOME_LABEL[status] ?? MANDATE_STATUS_LABEL[status] ?? status;
  const Icon = spec?.icon ?? CircleDot;
  return (
    <Badge
      data-status={status}
      className={spec?.className ?? "bg-pending-bg text-pending-foreground"}
    >
      <Icon className={spec?.spin ? "animate-spin" : undefined} aria-hidden="true" />
      {text}
    </Badge>
  );
}

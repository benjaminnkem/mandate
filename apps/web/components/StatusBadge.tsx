import { EPOCH_OUTCOME_LABEL, MANDATE_STATUS_LABEL } from "../lib/format.ts";

/**
 * Every outcome is distinguished by its own text label AND its own badge shape (see `.status` in
 * `app/globals.css`), never by color alone, so the distinction survives grayscale, color blindness and
 * screen readers alike.
 */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? EPOCH_OUTCOME_LABEL[status] ?? MANDATE_STATUS_LABEL[status] ?? status;
  return (
    <span className="status" data-status={status}>
      {text}
    </span>
  );
}

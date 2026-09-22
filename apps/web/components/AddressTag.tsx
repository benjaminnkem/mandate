"use client";

import { useState } from "react";

import { shortAddress } from "../lib/format.ts";

/** A shortened address, with the full value on hover/focus, and a copy-to-clipboard button. Never a link to an
 * external explorer we do not control the trustworthiness of. */
export function AddressTag({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="row" style={{ gap: "0.35rem", display: "inline-flex", alignItems: "center" }}>
      {label ? <span className="muted">{label}</span> : null}
      <span className="mono" title={address}>
        {shortAddress(address)}
      </span>
      <button
        type="button"
        aria-label={`Copy ${label ?? "address"} ${address} to clipboard`}
        onClick={() => {
          navigator.clipboard
            .writeText(address)
            .then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            })
            .catch(() => undefined);
        }}
        style={{ padding: "0.1rem 0.4rem", fontSize: "0.75rem" }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

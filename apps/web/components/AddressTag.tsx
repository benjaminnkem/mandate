"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "./ui/button.tsx";
import { shortAddress } from "../lib/format.ts";

/** A shortened address, with the full value on hover/focus, and a copy-to-clipboard button. Never a link to an
 * external explorer we do not control the trustworthiness of. */
export function AddressTag({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      <span className="font-mono-data" title={address}>
        {shortAddress(address)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={
          copied
            ? `Copied ${label ?? "address"} ${address}`
            : `Copy ${label ?? "address"} ${address} to clipboard`
        }
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
      >
        {copied ? <Check className="text-ok-foreground" /> : <Copy />}
      </Button>
    </span>
  );
}

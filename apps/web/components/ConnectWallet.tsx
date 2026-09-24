"use client";

import { ChevronDown, Wallet } from "lucide-react";
import { useState } from "react";

import { Button } from "./ui/button.tsx";
import { shortAddress } from "../lib/format.ts";
import { useWallet } from "../lib/solana/wallet-standard.tsx";

export function ConnectWallet() {
  const { wallets, account, walletName, connecting, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  if (account && walletName) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-mono-data text-sm text-muted-foreground" title={account.address}>
          {walletName}: {shortAddress(account.address)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void disconnect();
          }}
        >
          Disconnect
        </Button>
      </span>
    );
  }

  return (
    <span className="relative">
      <Button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <Wallet />
        {connecting ? "Connecting" : "Connect wallet"}
        <ChevronDown className="opacity-60" />
      </Button>
      {open ? (
        <span
          role="menu"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-20 flex min-w-56 flex-col gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10"
        >
          {wallets.length === 0 ? (
            <span className="block px-2 py-1.5 text-sm text-muted-foreground">
              No Solana wallet was found in this browser. Install one that supports the Wallet
              Standard (for example Phantom, Solflare or Backpack) and reload.
            </span>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.name}
                role="menuitem"
                type="button"
                className="flex items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setOpen(false);
                  void connect(wallet.name);
                }}
              >
                {wallet.name}
              </button>
            ))
          )}
        </span>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 max-w-64 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </span>
  );
}

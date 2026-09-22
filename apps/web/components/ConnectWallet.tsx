"use client";

import { useState } from "react";

import { shortAddress } from "../lib/format.ts";
import { useWallet } from "../lib/solana/wallet-standard.tsx";

export function ConnectWallet() {
  const { wallets, account, walletName, connecting, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  if (account && walletName) {
    return (
      <span className="row" style={{ alignItems: "center", gap: "0.5rem" }}>
        <span className="mono muted" title={account.address}>
          {walletName}: {shortAddress(account.address)}
        </span>
        <button
          type="button"
          onClick={() => {
            void disconnect();
          }}
        >
          Disconnect
        </button>
      </span>
    );
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        className="primary"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {open ? (
        <span
          role="menu"
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            zIndex: 20,
            minWidth: "220px",
          }}
        >
          {wallets.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              No Solana wallet was found in this browser. Install one that supports the Wallet
              Standard (for example Phantom, Solflare or Backpack) and reload.
            </p>
          ) : (
            <span className="stack" style={{ gap: "0.35rem" }}>
              {wallets.map((wallet) => (
                <button
                  key={wallet.name}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void connect(wallet.name);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  {wallet.name}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="notice danger"
          style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
        >
          {error}
        </p>
      ) : null}
    </span>
  );
}

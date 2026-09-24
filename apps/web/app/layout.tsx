import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Shell } from "../components/Shell.tsx";
import { cn } from "../lib/utils.ts";
import { WalletProvider } from "../lib/solana/wallet-standard.tsx";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Headings and anything data/address-like use the mono face: this is a measurement tool trading in exact
// integers, not a marketing site, and the monospace grid says so before a single word is read.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Mandate", template: "%s · Mandate" },
  description: "Pay for verified market quality, not deposited TVL.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable)}>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}

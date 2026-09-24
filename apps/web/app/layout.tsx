import { Geist } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Shell } from "../components/Shell.tsx";
import { cn } from "../lib/utils.ts";
import { WalletProvider } from "../lib/solana/wallet-standard.tsx";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Mandate", template: "%s · Mandate" },
  description: "Pay for verified market quality, not deposited TVL.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}

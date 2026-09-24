"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ConnectWallet } from "./ConnectWallet.tsx";
import { env } from "../lib/env.ts";

const LINKS: readonly { href: string; label: string }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/mandates", label: "Explore mandates" },
  { href: "/mandates/new", label: "Create a mandate" },
  { href: "/provider", label: "Provider workspace" },
  { href: "/methodology", label: "Methodology" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="whitespace-nowrap text-[0.95rem] font-semibold tracking-tight">
            Mandate
          </Link>
          <nav className="mr-auto flex flex-wrap gap-0.5" aria-label="Primary">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <span className="rounded-md border px-2 py-1 font-mono-data text-xs uppercase tracking-wide text-muted-foreground">
            {env.cluster}
          </span>
          <ConnectWallet />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4 px-4 py-5 text-sm text-muted-foreground">
          <span>
            Mandate pays for measured market quality. It is not investment advice and does not price
            fair value.
          </span>
          <span className="font-mono-data">
            Network: {env.cluster}. Program {env.programId.slice(0, 6)}...{env.programId.slice(-6)}
          </span>
        </div>
      </footer>
    </div>
  );
}

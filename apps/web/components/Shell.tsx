"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "../lib/env.ts";
import { ConnectWallet } from "./ConnectWallet.tsx";

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
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            Mandate
          </Link>
          <nav className="nav" aria-label="Primary">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <span className="network-badge">{env.cluster}</span>
          <ConnectWallet />
        </div>
      </header>
      <main id="main">{children}</main>
      <footer>
        <div className="footer-inner">
          <span>
            Mandate pays for measured market quality. It is not investment advice and does not price
            fair value.
          </span>
          <span>
            Network: {env.cluster} · Program {env.programId.slice(0, 6)}…{env.programId.slice(-6)}
          </span>
        </div>
      </footer>
    </div>
  );
}

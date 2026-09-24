"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { ButtonLink } from "./ButtonLink.tsx";
import { ConnectWallet } from "./ConnectWallet.tsx";
import { Footer } from "./Footer.tsx";
import { Logo } from "./Logo.tsx";
import { env } from "../lib/env.ts";

const LINKS: readonly { href: string; label: string }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/mandates", label: "Mandates" },
  { href: "/provider", label: "Provider" },
  { href: "/methodology", label: "Docs" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-saturate-150 supports-backdrop-filter:backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 whitespace-nowrap font-heading text-[0.95rem] font-medium tracking-tight"
          >
            <Logo className="size-6 text-primary" />
            Mandate
          </Link>
          <nav className="order-3 w-full sm:order-none sm:w-auto" aria-label="Primary">
            <div className="flex gap-1">
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
            </div>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-md border px-2 py-1 font-mono-data text-xs uppercase tracking-wide text-muted-foreground sm:inline-block">
              {env.cluster}
            </span>
            <ButtonLink
              href="/mandates/new"
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <Plus />
              New
            </ButtonLink>
            <ConnectWallet />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}

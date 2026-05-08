"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "Sectors" },
  { href: "/watchlist", label: "Watchlist" },
];

export function Nav() {
  const pathname = usePathname();
  const [ticker, setTicker] = React.useState("");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Capital Flow Predictor
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {tabs.map((t) => {
            const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = ticker.trim().toUpperCase();
            if (t) window.location.href = `/agents/${encodeURIComponent(t)}`;
          }}
        >
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="ticker (e.g. NVDA)"
            className="h-8 w-44 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            className="h-8 rounded-md border bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open
          </button>
        </form>
      </div>
    </header>
  );
}

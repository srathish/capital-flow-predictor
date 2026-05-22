"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal slide-over panel — no Radix/shadcn dep. Opens from the right,
// dims the page, closes on Esc, on backdrop click, or via the X button.
// Locks body scroll while open so the panel itself is the scroll target.
//
// Used by TickerDossierSheet (Pulse → Dossier verify-and-back workflow).

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  widthClass?: string;
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  widthClass = "w-full max-w-3xl",
  children,
}: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 ease-out",
          widthClass,
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <div className="text-base font-semibold leading-tight">{title}</div>}
            {subtitle && (
              <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </aside>
    </>
  );
}

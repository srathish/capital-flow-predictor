"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const REFETCH_MS = 30_000;

function formatRelative(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

// Live trading-halts strip. Auto-hides when there are no halts in the
// lookback window so the page stays quiet on uneventful days. When halts
// fire, they're often the loudest signal on the tape — a halt always
// precedes a news event we want to know about.
export function HaltsStrip({ openDossier }: { openDossier?: (t: string) => void }) {
  const { data } = useQuery({
    queryKey: ["halts-recent"],
    queryFn: () => api.haltsRecent({ lookbackMinutes: 240, limit: 30 }),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const active = items.filter((h) => h.is_active);

  return (
    <div className="mb-3 rounded-lg border border-rose-700/40 bg-rose-950/20 p-3">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-medium uppercase tracking-wider text-rose-300">
          🛑 Trading halts {active.length > 0 && `· ${active.length} active`}
        </span>
        <span className="text-[10px] text-muted-foreground">last 4h</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 20).map((h) => (
          <button
            key={`${h.ts}-${h.ticker}-${h.halt_code ?? ""}`}
            type="button"
            onClick={() => openDossier?.(h.ticker)}
            title={`${h.halt_reason ?? "halt"}${h.market ? ` · ${h.market}` : ""}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
              h.is_active
                ? "border-rose-500/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-semibold text-foreground">{h.ticker}</span>
            {h.halt_code && (
              <span className="font-mono text-[9px] uppercase">{h.halt_code}</span>
            )}
            <span className="text-[10px]">
              {h.is_active ? "active" : "resumed"} · {formatRelative(h.ts)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

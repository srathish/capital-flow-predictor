"use client";

// Conviction Board — multi-source agreement screen.
//
// The user's manual pre-trade checklist (8 sections, saved in memory)
// turned into one screen. For each ticker we show which sources agree
// with which direction; rows are sorted by # of confirming sources,
// then by Delphi score. Conflict pills are surfaced so the user can
// filter to "no-conflict only."

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type ConvictionRow = {
  ticker: string;
  spot_price: number | null;
  agreement_direction: "bullish" | "bearish" | "mixed";
  sources_agreeing: number;
  sources_total: number;
  sources: Record<string, string>;
  has_conflict: boolean;
  conflict_codes: string[];
  delphi_probability: number | null;
  delphi_score: number | null;
  regime: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  delphi: "Delphi",
  dark_pool: "Dark Pool",
  insider: "Insider",
  congress: "Congress",
  "13F": "13F",
  uw_smart_money: "UW SM",
  uw_whales: "UW Whales",
};
const SOURCE_ORDER = ["delphi", "dark_pool", "insider", "congress", "13F", "uw_smart_money", "uw_whales"];

const MIN_OPTS = [2, 3, 4, 5] as const;

async function fetchBoard(direction: string | null, minSources: number, excludeConflicts: boolean): Promise<ConvictionRow[]> {
  const sp = new URLSearchParams({
    min_sources: String(minSources),
    exclude_conflicts: String(excludeConflicts),
    limit: "100",
  });
  if (direction) sp.set("direction", direction);
  const res = await fetch(`${baseUrl()}/v1/conviction/board?${sp}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function ConvictionView() {
  const [direction, setDirection] = useState<"bullish" | "bearish" | null>(null);
  const [minSources, setMinSources] = useState(3);
  const [excludeConflicts, setExcludeConflicts] = useState(false);

  const q = useQuery({
    queryKey: ["conv", direction, minSources, excludeConflicts],
    queryFn: () => fetchBoard(direction, minSources, excludeConflicts),
    refetchInterval: 90_000,
  });
  const rows = q.data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Conviction Board</h1>
        <p className="text-sm text-muted-foreground">
          Tickers where multiple independent sources agree. Sorted by # of confirming sources,
          then Delphi score. Conflict pills surface source disagreement.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-full border bg-card p-1">
          {(["bullish", "bearish", null] as const).map((d) => (
            <button
              key={d ?? "all"}
              onClick={() => setDirection(d)}
              className={cn(
                "rounded-full px-3 py-1 text-xs capitalize",
                direction === d
                  ? d === "bullish" ? "bg-emerald-500/15 text-emerald-300"
                  : d === "bearish" ? "bg-rose-500/15 text-rose-300"
                  : "bg-primary/15 text-primary"
                  : "text-muted-foreground"
              )}
            >
              {d ?? "All"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Min sources:</span>
          {MIN_OPTS.map((n) => (
            <button
              key={n}
              onClick={() => setMinSources(n)}
              className={cn(
                "h-7 w-7 rounded-md border text-xs",
                minSources === n ? "border-primary bg-primary/15 text-primary" : "bg-card"
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={excludeConflicts}
            onChange={(e) => setExcludeConflicts(e.target.checked)}
          />
          exclude conflicts
        </label>

        <span className="ml-auto text-xs text-muted-foreground">{rows.length} matches</span>
      </div>

      <section className="rounded-2xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-right">Spot</th>
                <th className="px-3 py-2 text-center">Agreement</th>
                <th className="px-3 py-2 text-left">Sources</th>
                <th className="px-3 py-2 text-right">Delphi</th>
                <th className="px-3 py-2 text-left">Regime</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">loading…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No tickers meet the agreement threshold. Try lowering "min sources" or removing the direction filter.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.ticker} className="border-t hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.ticker}</div>
                    {r.has_conflict && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.conflict_codes.slice(0, 2).map((c) => (
                          <span key={c} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            {c.replace(/CONFLICT_/, "").replace(/_/g, " ").toLowerCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.spot_price != null ? `$${r.spot_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      r.agreement_direction === "bullish" && "bg-emerald-500/15 text-emerald-300",
                      r.agreement_direction === "bearish" && "bg-rose-500/15 text-rose-300",
                      r.agreement_direction === "mixed" && "bg-amber-500/15 text-amber-300"
                    )}>
                      {r.sources_agreeing}/{r.sources_total} {r.agreement_direction}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {SOURCE_ORDER.filter((s) => s in r.sources).map((s) => {
                        const sd = r.sources[s];
                        return (
                          <span
                            key={s}
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px]",
                              sd === "bullish" && "bg-emerald-500/10 text-emerald-300",
                              sd === "bearish" && "bg-rose-500/10 text-rose-300"
                            )}
                            title={`${SOURCE_LABELS[s] ?? s} — ${sd}`}
                          >
                            {SOURCE_LABELS[s] ?? s}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.delphi_probability != null && (
                      <>
                        <div className="text-sm font-semibold tabular-nums">
                          {(r.delphi_probability * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          score {r.delphi_score?.toFixed(0) ?? "—"}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {r.regime ? r.regime.replace(/_/g, " · ") : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

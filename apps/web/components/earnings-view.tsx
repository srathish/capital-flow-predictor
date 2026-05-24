"use client";

// Earnings Radar — upcoming earnings + IV/max-pain context + Delphi's take.
//
// Earnings are the #1 short-horizon catalyst. Each row joins UW's
// expected-move + IV rank with our composed features (max pain distance,
// historical 1d post-earnings move) and Delphi's pre-earnings hypothesis
// when one exists.

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type EarningsRow = {
  ticker: string;
  report_date: string;
  report_time: string | null;
  expected_move: number | null;
  expected_move_perc: number | null;
  iv_rank: number | null;
  iv30: number | null;
  spot: number | null;
  max_pain_distance: number | null;
  avg_post_earnings_1d: number | null;
  delphi_probability: number | null;
  delphi_bias: string | null;
  delphi_target_low: number | null;
  delphi_target_high: number | null;
};

const WINDOW_OPTS = [
  { id: 7,  label: "7d"  },
  { id: 14, label: "14d" },
  { id: 30, label: "30d" },
  { id: 60, label: "60d" },
] as const;

async function fetchUpcoming(days: number): Promise<EarningsRow[]> {
  const res = await fetch(`${baseUrl()}/v1/earnings/upcoming?days=${days}&limit=200`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function daysUntil(d: string): number {
  const dt = new Date(d);
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

export function EarningsView() {
  const [days, setDays] = useState(14);
  const [hideStale, setHideStale] = useState(true);

  const q = useQuery({ queryKey: ["earnings-up", days], queryFn: () => fetchUpcoming(days), refetchInterval: 5 * 60_000 });
  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (hideStale) r = r.filter((x) => daysUntil(x.report_date) >= 0);
    return r;
  }, [q.data, hideStale]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Earnings Radar</h1>
          <p className="text-sm text-muted-foreground">
            Upcoming reports with IV regime, max-pain pin, post-earnings drift, and Delphi's pre-earnings hypothesis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full border bg-card p-1">
            {WINDOW_OPTS.map((o) => (
              <button
                key={o.id}
                onClick={() => setDays(o.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs",
                  days === o.id ? "bg-primary/15 text-primary" : "text-muted-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={hideStale} onChange={(e) => setHideStale(e.target.checked)} />
            future only
          </label>
        </div>
      </header>

      <section className="rounded-2xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-center">When</th>
                <th className="px-3 py-2 text-right">Spot</th>
                <th className="px-3 py-2 text-right">Exp. move</th>
                <th className="px-3 py-2 text-right">IV30</th>
                <th className="px-3 py-2 text-right">IV rank</th>
                <th className="px-3 py-2 text-right">Max-pain Δ</th>
                <th className="px-3 py-2 text-right">Avg 1d post</th>
                <th className="px-3 py-2 text-center">Delphi</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">loading…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No earnings in window.</td></tr>
              )}
              {rows.map((r) => {
                const dteN = daysUntil(r.report_date);
                const dteLabel = dteN === 0 ? "today" : dteN > 0 ? `in ${dteN}d` : `${-dteN}d ago`;
                return (
                  <tr key={`${r.ticker}-${r.report_date}`} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <div className="text-sm">{new Date(r.report_date).toLocaleDateString()}</div>
                      <div className="text-xs text-muted-foreground">{dteLabel}</div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{r.ticker}</td>
                    <td className="px-3 py-2 text-center text-xs uppercase text-muted-foreground">
                      {r.report_time ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.spot != null ? `$${r.spot.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.expected_move_perc != null ? fmtPct(r.expected_move_perc / (r.expected_move_perc > 5 ? 100 : 1)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.iv30?.toFixed(1) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.iv_rank?.toFixed(0) ?? "—"}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums",
                      r.max_pain_distance != null && Math.abs(r.max_pain_distance) > 0.04 && "text-amber-400")}>
                      {fmtPct(r.max_pain_distance)}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums",
                      r.avg_post_earnings_1d != null && r.avg_post_earnings_1d > 0 && "text-emerald-400",
                      r.avg_post_earnings_1d != null && r.avg_post_earnings_1d < 0 && "text-rose-400")}>
                      {fmtPct(r.avg_post_earnings_1d)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.delphi_probability != null ? (
                        <div className="text-xs">
                          <div className={cn(
                            "font-semibold",
                            r.delphi_bias === "bullish" && "text-emerald-400",
                            r.delphi_bias === "bearish" && "text-rose-400"
                          )}>
                            {r.delphi_bias} {(r.delphi_probability * 100).toFixed(0)}%
                          </div>
                          {r.delphi_target_low != null && r.delphi_target_high != null && (
                            <div className="text-muted-foreground tabular-nums">
                              ${r.delphi_target_low.toFixed(0)}–${r.delphi_target_high.toFixed(0)}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

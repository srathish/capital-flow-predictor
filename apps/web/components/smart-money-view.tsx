"use client";

// Smart Money — unified institutional/insider/political tape.
//
// Two panes: per-ticker ROLLUP (the actionable screen) on top, raw TAPE
// (mixed-source reverse-chrono) below. Dark pool prints, Form 4 insider
// transactions, Capitol Hill trades, and 13F deltas — all in one place,
// so when the same ticker shows up across sources you spot it instantly.

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type TapeEntry = {
  ts: string;
  source: "dark_pool" | "insider" | "congress" | "inst";
  ticker: string;
  direction: "buy" | "sell" | "neutral";
  notional: number | null;
  detail: Record<string, unknown>;
};

type RollupRow = {
  ticker: string;
  dp_net_30d: number | null;
  insider_net_30d: number | null;
  insider_buyers_30d: number;
  insider_sellers_30d: number;
  congress_buys_14d: number;
  congress_sells_14d: number;
  inst_net_delta_90d: number | null;
  conviction_score: number | null;
  spot_price: number | null;
};

const SOURCE_OPTIONS = [
  { id: "dark_pool", label: "Dark Pool" },
  { id: "insider",   label: "Insiders" },
  { id: "congress",  label: "Congress" },
  { id: "inst",      label: "13F" },
] as const;

async function fetchTape(hours: number, sources: string[]): Promise<TapeEntry[]> {
  const sp = new URLSearchParams({ hours: String(hours), sources: sources.join(","), limit: "300" });
  const res = await fetch(`${baseUrl()}/v1/smart-money/tape?${sp}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fetchRollup(): Promise<RollupRow[]> {
  const res = await fetch(`${baseUrl()}/v1/smart-money/rollup?limit=80&min_signals=2`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtTs(s: string): string {
  const d = new Date(s);
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
  return d.toLocaleDateString();
}

const SOURCE_PILL: Record<string, string> = {
  dark_pool: "bg-purple-500/15 text-purple-300",
  insider:   "bg-amber-500/15 text-amber-300",
  congress:  "bg-blue-500/15 text-blue-300",
  inst:      "bg-emerald-500/15 text-emerald-300",
};

export function SmartMoneyView() {
  const [hours, setHours] = useState(48);
  const [sources, setSources] = useState<string[]>(["dark_pool", "insider", "congress", "inst"]);

  const tapeQ = useQuery({
    queryKey: ["sm-tape", hours, sources.join(",")],
    queryFn: () => fetchTape(hours, sources),
    refetchInterval: 60_000,
  });
  const rollupQ = useQuery({
    queryKey: ["sm-rollup"],
    queryFn: fetchRollup,
    refetchInterval: 60_000,
  });

  const tape = tapeQ.data ?? [];
  const rollup = useMemo(() => (rollupQ.data ?? []).slice(0, 60), [rollupQ.data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Smart Money</h1>
        <p className="text-sm text-muted-foreground">
          Dark pool · insider · congress · 13F — when sources stack on the same ticker, conviction floats up.
        </p>
      </header>

      {/* Rollup */}
      <section className="mb-6 rounded-2xl border bg-card">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Per-ticker rollup (latest 30d/90d window)</h2>
          {rollupQ.isFetching && <span className="text-xs text-muted-foreground">refreshing…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-right">Spot</th>
                <th className="px-3 py-2 text-right">Conviction</th>
                <th className="px-3 py-2 text-right">DP net 24h</th>
                <th className="px-3 py-2 text-right">Insider net 30d</th>
                <th className="px-3 py-2 text-center">Insider buy/sell</th>
                <th className="px-3 py-2 text-center">Congress 14d</th>
                <th className="px-3 py-2 text-right">13F net Δ</th>
              </tr>
            </thead>
            <tbody>
              {rollupQ.isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">loading…</td></tr>
              )}
              {!rollupQ.isLoading && rollup.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No rollup data yet — composer needs to run first.</td></tr>
              )}
              {rollup.map((r) => {
                const conv = r.conviction_score ?? 0;
                const dir = conv > 0.1 ? "bull" : conv < -0.1 ? "bear" : "mixed";
                return (
                  <tr key={r.ticker} className="border-t hover:bg-accent/40">
                    <td className="px-4 py-2 font-semibold">{r.ticker}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${(r.spot_price ?? 0).toFixed(2)}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold tabular-nums",
                      dir === "bull" && "text-emerald-400",
                      dir === "bear" && "text-rose-400",
                      dir === "mixed" && "text-muted-foreground"
                    )}>
                      {conv > 0 ? "+" : ""}{(conv * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.dp_net_30d)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.insider_net_30d)}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      <span className="text-emerald-400">{r.insider_buyers_30d}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-rose-400">{r.insider_sellers_30d}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {r.congress_buys_14d + r.congress_sells_14d === 0 ? "—" : (
                        <>
                          <span className="text-emerald-400">{r.congress_buys_14d}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-rose-400">{r.congress_sells_14d}</span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.inst_net_delta_90d == null ? "—" : r.inst_net_delta_90d.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground">Window</label>
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="h-8 rounded-md border bg-card px-2 text-xs"
        >
          <option value={6}>6h</option>
          <option value={24}>24h</option>
          <option value={48}>48h</option>
          <option value={168}>7d</option>
        </select>
        <div className="flex flex-wrap gap-1">
          {SOURCE_OPTIONS.map((s) => {
            const on = sources.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setSources((prev) => on ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs",
                  on ? SOURCE_PILL[s.id] : "bg-muted text-muted-foreground"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tape */}
      <section className="rounded-2xl border bg-card">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Live tape</h2>
          {tapeQ.isFetching && <span className="text-xs text-muted-foreground">refreshing…</span>}
        </div>
        <ul className="divide-y">
          {tapeQ.isLoading && <li className="px-4 py-8 text-center text-sm text-muted-foreground">loading…</li>}
          {!tapeQ.isLoading && tape.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">No prints in the selected window.</li>
          )}
          {tape.map((e, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent/40">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider", SOURCE_PILL[e.source])}>
                {e.source.replace("_", " ")}
              </span>
              <span className="w-16 font-semibold">{e.ticker}</span>
              <span className={cn("w-16 text-xs uppercase",
                e.direction === "buy"  && "text-emerald-400",
                e.direction === "sell" && "text-rose-400",
                e.direction === "neutral" && "text-muted-foreground"
              )}>
                {e.direction}
              </span>
              <span className="w-24 text-right tabular-nums">{fmtMoney(e.notional)}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {Object.entries(e.detail).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
              </span>
              <span className="w-20 text-right text-xs text-muted-foreground">{fmtTs(e.ts)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

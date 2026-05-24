"use client";

// Macro — top-down regime view.
//
// The composite regime label drives Delphi's calibration buckets and
// reason-code performance stratification. Surfacing it lets a trader
// see "we're in uptrend_normal_risk_on, so high-conviction bullish
// calls should hit at their stated rate" — or "we're risk_off, expect
// every bullish 70% to live at 55%."

import { useQuery } from "@tanstack/react-query";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type RegimePoint = {
  asof_date: string;
  composite_regime: string;
  vol_regime: string;
  trend_regime: string;
  macro_regime: string;
  vix_close: number | null;
  vix_z_30d: number | null;
  yield_curve_2_10: number | null;
  dxy_close: number | null;
  fed_funds_rate: number | null;
  spy_close: number | null;
};

type CurrentRegimeResponse = {
  current: RegimePoint | null;
  history: RegimePoint[];
};

async function fetchCurrent(): Promise<CurrentRegimeResponse> {
  const res = await fetch(`${baseUrl()}/v1/macro/current?days=180`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function RegimeBadge({ label, value }: { label: string; value: string }) {
  const tone =
    value === "uptrend" || value === "risk_on" || value === "low" ? "bg-emerald-500/15 text-emerald-300" :
    value === "downtrend" || value === "risk_off" || value === "crisis" || value === "high" ? "bg-rose-500/15 text-rose-300" :
    "bg-amber-500/15 text-amber-300";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", tone)}>
        {value.replace("_", " ")}
      </span>
    </div>
  );
}

function Sparkline({ points, color = "currentColor" }: { points: number[]; color?: string }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const w = 120, h = 32;
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * w} ${h - ((p - min) / span) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function MetricCard({ title, value, sub, sparkline, tone }: {
  title: string;
  value: string;
  sub?: string;
  sparkline?: number[];
  tone?: "good" | "bad" | "neutral";
}) {
  const c = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : "text-foreground";
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{title}</h3>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", c)}>{value}</div>
      {sparkline && (
        <div className={cn("mt-2", c)}>
          <Sparkline points={sparkline} />
        </div>
      )}
    </div>
  );
}

export function MacroView() {
  const q = useQuery({ queryKey: ["macro-current"], queryFn: fetchCurrent, refetchInterval: 5 * 60_000 });
  const cur = q.data?.current;
  const hist = q.data?.history ?? [];

  const vixSeries = hist.slice().reverse().map((p) => p.vix_close ?? 0).filter((v) => v > 0);
  const ycSeries = hist.slice().reverse().map((p) => p.yield_curve_2_10 ?? 0);
  const dxySeries = hist.slice().reverse().map((p) => p.dxy_close ?? 0).filter((v) => v > 0);
  const spySeries = hist.slice().reverse().map((p) => p.spy_close ?? 0).filter((v) => v > 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Macro</h1>
        <p className="text-sm text-muted-foreground">
          Composite regime drives Delphi's calibration. When the regime shifts, stated probabilities mean different things.
        </p>
      </header>

      {/* Current regime header */}
      <section className="mb-6 rounded-2xl border bg-card p-6">
        {q.isLoading && <div className="text-sm text-muted-foreground">loading…</div>}
        {!q.isLoading && !cur && (
          <div className="text-sm text-muted-foreground">
            macro_regime is empty — run <code>cfp-jobs delphi-regime --backfill-days 30</code> to populate.
          </div>
        )}
        {cur && (
          <>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Today's composite regime</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight">{cur.composite_regime.replace(/_/g, " · ")}</div>
            <div className="mt-4 flex flex-wrap items-end gap-6">
              <RegimeBadge label="Vol" value={cur.vol_regime} />
              <RegimeBadge label="Trend" value={cur.trend_regime} />
              <RegimeBadge label="Macro" value={cur.macro_regime} />
            </div>
          </>
        )}
      </section>

      {/* Metric cards */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="VIX"
          value={cur?.vix_close != null ? cur.vix_close.toFixed(2) : "—"}
          sub={cur?.vix_z_30d != null ? `Z₃₀ ${cur.vix_z_30d.toFixed(2)}` : undefined}
          sparkline={vixSeries}
          tone={cur?.vol_regime === "high" || cur?.vol_regime === "crisis" ? "bad" : "good"}
        />
        <MetricCard
          title="Yield curve 2s10s"
          value={cur?.yield_curve_2_10 != null ? `${cur.yield_curve_2_10.toFixed(2)}%` : "—"}
          sub={cur?.fed_funds_rate != null ? `Fed ${cur.fed_funds_rate.toFixed(2)}%` : undefined}
          sparkline={ycSeries}
          tone={cur?.yield_curve_2_10 != null && cur.yield_curve_2_10 < 0 ? "bad" : "neutral"}
        />
        <MetricCard
          title="DXY"
          value={cur?.dxy_close != null ? cur.dxy_close.toFixed(2) : "—"}
          sparkline={dxySeries}
          tone="neutral"
        />
        <MetricCard
          title="SPY"
          value={cur?.spy_close != null ? `$${cur.spy_close.toFixed(2)}` : "—"}
          sparkline={spySeries}
          tone={cur?.trend_regime === "uptrend" ? "good" : cur?.trend_regime === "downtrend" ? "bad" : "neutral"}
        />
      </section>

      {/* History table */}
      <section className="rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Regime history (last 60 days)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Composite</th>
                <th className="px-3 py-2 text-right">VIX</th>
                <th className="px-3 py-2 text-right">2s10s</th>
                <th className="px-3 py-2 text-right">DXY</th>
                <th className="px-3 py-2 text-right">SPY</th>
              </tr>
            </thead>
            <tbody>
              {hist.slice(0, 60).map((p) => (
                <tr key={p.asof_date} className="border-t">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{new Date(p.asof_date).toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-xs">{p.composite_regime.replace(/_/g, " · ")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.vix_close?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.yield_curve_2_10?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.dxy_close?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.spy_close?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

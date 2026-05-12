"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ReplayResponse, StockScreenItem } from "@/lib/types";

// Secret /lab tab — experiments + under-construction widgets. Reached by
// typing "saiyeesh" anywhere on the site (see lib/lab.ts).

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function OpportunityScreener() {
  const [items, setItems] = useState<StockScreenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.screenStocks({
          signal: "long",
          minConfidence: 0.5,
          limit: 25,
          sort: "opportunity",
          lookbackDays: 60,
        });
        if (!cancelled) setItems(res.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">Opportunity score · top 25 (long, conf ≥ 0.50)</h3>
        <span className="text-xs text-muted-foreground">
          0–100 composite · conviction + IV rank + liquidity + sector + earnings
        </span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {items === null && !error && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
      {items && items.length === 0 && (
        <p className="text-xs text-muted-foreground">No candidates pass the gate right now.</p>
      )}
      {items && items.length > 0 && (
        <div className="overflow-hidden rounded border border-border/50">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">Sector</th>
                <th className="px-2 py-1 text-right">Score</th>
                <th className="px-2 py-1 text-right">Conviction</th>
                <th className="px-2 py-1 text-right">IV rank</th>
                <th className="px-2 py-1 text-right">OI</th>
                <th className="px-2 py-1 text-right">Sector</th>
                <th className="px-2 py-1 text-right">Earn</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const b = it.opportunity_breakdown ?? {};
                return (
                  <tr key={it.ticker} className="border-t border-border/40">
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1 font-mono font-semibold">
                      <Link className="hover:underline" href={`/agents/${it.ticker}`}>{it.ticker}</Link>
                    </td>
                    <td className="px-2 py-1">{it.sector ?? "—"}</td>
                    <td className="px-2 py-1 text-right font-semibold">
                      {it.opportunity_score?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">{b.conviction?.toFixed(1) ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{b.iv_rank?.toFixed(1) ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{b.liquidity?.toFixed(1) ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{b.sector_strength?.toFixed(1) ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{b.earnings_window?.toFixed(1) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReplayPanel() {
  const [ticker, setTicker] = useState("NVDA");
  const [asOf, setAsOf] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [data, setData] = useState<ReplayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.agentsReplay(ticker.trim().toUpperCase(), asOf);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "replay failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">Replay · what did the ensemble say N days ago?</h3>
        <span className="text-xs text-muted-foreground">Joins run_evidence + forward returns vs SPY</span>
      </div>
      <div className="mb-3 flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker"
          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm uppercase"
          maxLength={12}
        />
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={go}
          disabled={loading}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          {loading ? "…" : "Replay"}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {data && (
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">PM call:</span>{" "}
            <span className="font-semibold">{data.pm_signal ?? "(none)"}</span>{" "}
            <span className="text-xs text-muted-foreground">
              conf {data.pm_confidence?.toFixed(2) ?? "—"} · run {data.run_ts?.slice(0, 16) ?? "—"}
            </span>
          </div>
          <div className="overflow-hidden rounded border border-border/50">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left">Horizon</th>
                  <th className="px-2 py-1 text-right">{data.ticker} return</th>
                  <th className="px-2 py-1 text-right">SPY return</th>
                  <th className="px-2 py-1 text-right">Excess</th>
                  <th className="px-2 py-1 text-center">Hit?</th>
                </tr>
              </thead>
              <tbody>
                {data.forward_returns.map((r) => (
                  <tr key={r.horizon_days} className="border-t border-border/40">
                    <td className="px-2 py-1">{r.horizon_days}d</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtPct(r.ticker_return)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtPct(r.spy_return)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtPct(r.excess_return)}</td>
                    <td className="px-2 py-1 text-center">
                      {r.hit === true ? "✓" : r.hit === false ? "✗" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.has_bundle ? "EvidenceBundle persisted" : "No bundle persisted for that run"} ·{" "}
            {data.signals.length} agent rows
          </p>
        </div>
      )}
    </div>
  );
}

function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
      <h3 className="mb-1 text-base font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{blurb}</p>
    </div>
  );
}

export function LabView() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">🧪 Lab</h1>
          <p className="text-xs text-muted-foreground">
            Under construction. Experiments, dashboards-not-yet-shipped, raw outputs.
          </p>
        </div>
        <Link
          href="/"
          className="rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
      </div>

      <OpportunityScreener />
      <ReplayPanel />
      <ComingSoon
        title="Morning brief preview"
        blurb="Rank movers + watchlist deltas + stale tables, posted to Discord at 09:00 ET. CLI: `cfp-jobs morning-brief`. UI preview lands here next."
      />
      <ComingSoon
        title="TradingView MCP bridge"
        blurb="Expose /v1/agents/run + comparison + backtest as MCP tools so Claude Code can drive the ensemble from inside any editor."
      />
      <ComingSoon
        title="Persona vote-weight auto-rollback"
        blurb="Each persona's running hit rate from agent_eval feeds back into the synthesizer's weighting. Buffett wrong 7 of 10 → his vote halves this week."
      />
    </div>
  );
}

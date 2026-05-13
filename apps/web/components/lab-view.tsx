"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FlowAggregatePanel } from "@/components/flow-aggregate-panel";
import type {
  CalibrationResponse,
  ReplayResponse,
  StockScreenItem,
} from "@/lib/types";

// Secret /lab tab — experiments + under-construction widgets. Reached by
// typing "saiyeesh" anywhere on the site (see lib/lab.ts).

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function CalibrationLine({ data }: { data: CalibrationResponse | null }) {
  if (!data) return null;
  if (data.n_total === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No matured PM signals over the last {data.window_days}d — calibration unavailable.
      </p>
    );
  }
  const top = data.buckets.find((b) => b.label === ">=75");
  const lo = data.buckets.find((b) => b.label === "<25");
  const overall = data.overall_hit_rate ?? 0;
  const overallExcess = data.overall_mean_excess ?? 0;
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">
        <span className="font-semibold text-foreground">Calibration ({data.horizon_days}d):</span>{" "}
        across {data.n_total} PM signals over the last {data.window_days}d,{" "}
        overall hit rate <span className="font-mono">{(overall * 100).toFixed(1)}%</span>,{" "}
        mean signed excess <span className="font-mono">{(overallExcess * 100).toFixed(2)}%</span>.
      </p>
      <div className="flex flex-wrap gap-3 font-mono text-[11px]">
        {data.buckets.map((b) => (
          <span
            key={b.label}
            className={`rounded border px-2 py-0.5 ${
              b.hit_rate_10d !== null && b.hit_rate_10d > overall
                ? "border-green-500/60 text-green-300"
                : "border-border/60 text-muted-foreground"
            }`}
          >
            score {b.label} (n={b.n}):{" "}
            {b.hit_rate_10d !== null ? `${(b.hit_rate_10d * 100).toFixed(0)}% hit` : "—"}
            {b.mean_excess_10d !== null ? ` · ${(b.mean_excess_10d * 100).toFixed(2)}% excess` : ""}
          </span>
        ))}
      </div>
      {top && lo && top.hit_rate_10d !== null && lo.hit_rate_10d !== null && (
        <p className="text-muted-foreground">
          Top bucket beat the bottom by{" "}
          <span className="font-mono text-foreground">
            {((top.hit_rate_10d - lo.hit_rate_10d) * 100).toFixed(1)} pp
          </span>{" "}
          on hit rate.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">{data.note}</p>
    </div>
  );
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / 3600_000;
}

function ageBadge(hours: number | null): { text: string; cls: string } {
  if (hours === null) return { text: "—", cls: "text-muted-foreground" };
  if (hours < 24) return { text: `${hours.toFixed(0)}h`, cls: "text-green-300" };
  if (hours < 48) return { text: `${hours.toFixed(0)}h`, cls: "text-amber-300" };
  const days = (hours / 24).toFixed(0);
  return { text: `${days}d`, cls: "text-rose-300" };
}

function OpportunityScreener() {
  const [items, setItems] = useState<StockScreenItem[] | null>(null);
  const [calib, setCalib] = useState<CalibrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rerunBusy, setRerunBusy] = useState<Set<string>>(new Set());

  async function fetchAll(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const [res, cal] = await Promise.all([
        api.screenStocks({
          signal: "long",
          minConfidence: 0.5,
          limit: 25,
          sort: "opportunity",
          lookbackDays: 60,
        }),
        api.screenerCalibration({ days: 90, horizon: 10 }).catch(() => null),
      ]);
      setItems(res.items);
      setCalib(cal);
      setLastFetch(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // Poll every 60s while the tab is open. Browser pauses requestAnimationFrame
    // on background tabs; setInterval continues but the fetches will be cheap.
    const id = setInterval(() => fetchAll(true), 60_000);
    const onFocus = () => fetchAll(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rerun(ticker: string, sector: string | null) {
    setRerunBusy((s) => new Set(s).add(ticker));
    try {
      await api.runEnsemble(ticker, sector ?? undefined);
      // Let the run land (typical 30-90s) then refetch — until then the row's
      // age column will still show the old value. Could poll the run-status
      // endpoint, but a single delayed refetch is simpler.
      setTimeout(() => fetchAll(true), 60_000);
    } catch (e) {
      setError(`re-run ${ticker} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRerunBusy((s) => {
        const n = new Set(s);
        n.delete(ticker);
        return n;
      });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium">Opportunity score · top 25 (long, conf ≥ 0.50)</h3>
        <span className="text-xs text-muted-foreground">
          0–100 composite · conviction + IV rank + liquidity + sector + earnings
          {lastFetch && (
            <span className="ml-2 text-[10px]">
              · refreshes every 60s · last {lastFetch.toLocaleTimeString()}
              {refreshing && " · …"}
            </span>
          )}
        </span>
      </div>
      <div className="mb-3 rounded border border-border/40 bg-muted/20 p-2">
        <CalibrationLine data={calib} />
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
                <th className="px-2 py-1 text-right">Age</th>
                <th className="px-2 py-1 text-right">Re-run</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const b = it.opportunity_breakdown ?? {};
                const age = ageHours(it.run_ts);
                const badge = ageBadge(age);
                const busy = rerunBusy.has(it.ticker);
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
                    <td className={`px-2 py-1 text-right font-mono ${badge.cls}`}>{badge.text}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => rerun(it.ticker, it.sector)}
                        className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Kick off a fresh ensemble run for this ticker"
                      >
                        {busy ? "…" : "↻"}
                      </button>
                    </td>
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
      <FlowAggregatePanel />
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

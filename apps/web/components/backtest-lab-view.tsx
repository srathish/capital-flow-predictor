"use client";

// Backtest Lab — model comparison + ML registry + walk-forward runs.
//
// This is the gate the "4× more accurate" claim has to clear. Three panes:
//   1. Model comparison — v0.1-rules vs v0.2-features vs any v0.3-lgbm
//      that earned status='active'. Hit rate + Brier + calibration error
//      per (horizon, model_version) so improvement is visible.
//   2. ML model registry — every trained model with overfit_gap and
//      tripwire_fired. Failed (rejected) models stay visible so we can
//      see WHY iterations don't ship.
//   3. Walk-forward runs — per-named replay with by_horizon and
//      by_regime breakdowns.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type ModelCompareRow = {
  model_version: string;
  family: string | null;
  description: string | null;
  is_default: boolean;
  signal_timeframe: string;
  forecast_horizon: string;
  prediction_count: number;
  target_hit_rate: number | null;
  brier_score: number | null;
  calibration_error: number | null;
  profit_factor: number | null;
  average_realized_return: number | null;
};

type MlModelRow = {
  model_version: string;
  created_at: string;
  status: string;
  n_train: number;
  n_val: number;
  n_holdout: number;
  train_brier: number | null;
  val_brier: number | null;
  holdout_brier: number | null;
  holdout_hit_rate: number | null;
  holdout_auc: number | null;
  overfit_gap: number | null;
  overfit_threshold: number | null;
  tripwire_fired: boolean;
  top_features: { name: string; gain: number }[];
};

type RunSummary = {
  run_id: string;
  created_at: string;
  model_version: string;
  window_start: string;
  window_end: string;
  n_predictions: number;
  n_scored: number;
  hit_rate: number | null;
  brier_score: number | null;
  log_loss: number | null;
  profit_factor: number | null;
  avg_realized_return: number | null;
  notes: string | null;
};

async function fetchModelCompare(): Promise<ModelCompareRow[]> {
  const res = await fetch(`${baseUrl()}/v1/backtest/model-compare`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchMlModels(): Promise<MlModelRow[]> {
  const res = await fetch(`${baseUrl()}/v1/backtest/ml-models`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch(`${baseUrl()}/v1/backtest/runs?limit=25`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function statusPill(s: string, tripwire: boolean): string {
  if (tripwire || s === "rejected") return "bg-rose-500/15 text-rose-300";
  if (s === "active") return "bg-emerald-500/15 text-emerald-300";
  if (s === "archived") return "bg-muted text-muted-foreground";
  return "bg-amber-500/15 text-amber-300";
}

export function BacktestLabView() {
  const [tab, setTab] = useState<"compare" | "ml" | "runs">("compare");
  const compareQ = useQuery({ queryKey: ["bt-compare"], queryFn: fetchModelCompare });
  const mlQ      = useQuery({ queryKey: ["bt-ml"],      queryFn: fetchMlModels });
  const runsQ    = useQuery({ queryKey: ["bt-runs"],    queryFn: fetchRuns });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Backtest Lab</h1>
        <p className="text-sm text-muted-foreground">
          Honest A/B comparison across Delphi model versions, ML registry with the overfitting tripwire surfaced,
          and walk-forward replay runs.
        </p>
      </header>

      <div className="mb-4 inline-flex gap-1 rounded-full border bg-card p-1">
        {(["compare", "ml", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs capitalize",
              tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground"
            )}
          >
            {t === "compare" ? "Model compare" : t === "ml" ? "ML registry" : "Replay runs"}
          </button>
        ))}
      </div>

      {tab === "compare" && (
        <section className="rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Version</th>
                  <th className="px-3 py-2 text-left">Family</th>
                  <th className="px-3 py-2 text-left">Signal</th>
                  <th className="px-3 py-2 text-left">Horizon</th>
                  <th className="px-3 py-2 text-right">N</th>
                  <th className="px-3 py-2 text-right">Hit rate</th>
                  <th className="px-3 py-2 text-right">Brier ↓</th>
                  <th className="px-3 py-2 text-right">Cal. err ↓</th>
                  <th className="px-3 py-2 text-right">PF</th>
                  <th className="px-3 py-2 text-right">Avg ret</th>
                </tr>
              </thead>
              <tbody>
                {compareQ.isLoading && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">loading…</td></tr>
                )}
                {!compareQ.isLoading && (compareQ.data ?? []).length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No model_performance rows yet — need outcomes (delphi-learn populates this nightly).
                  </td></tr>
                )}
                {(compareQ.data ?? []).map((r, i) => (
                  <tr key={i} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.model_version}
                      {r.is_default && <span className="ml-1 rounded bg-primary/15 px-1 text-[10px] text-primary">default</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.family ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.signal_timeframe}</td>
                    <td className="px-3 py-2 text-xs">{r.forecast_horizon}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.prediction_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.target_hit_rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.brier_score?.toFixed(4) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.calibration_error?.toFixed(4) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.profit_factor?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.average_realized_return, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "ml" && (
        <section className="space-y-3">
          {mlQ.isLoading && <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">loading…</div>}
          {!mlQ.isLoading && (mlQ.data ?? []).length === 0 && (
            <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
              No ML models yet — delphi-ml-train is in calibrating mode until 200 outcomes accrue.
            </div>
          )}
          {(mlQ.data ?? []).map((m) => (
            <article key={m.model_version} className="rounded-2xl border bg-card p-4">
              <header className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm font-semibold">{m.model_version}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleString()} · train {m.n_train.toLocaleString()} ·
                    val {m.n_val.toLocaleString()} · holdout {m.n_holdout.toLocaleString()}
                  </div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider",
                  statusPill(m.status, m.tripwire_fired))}>
                  {m.tripwire_fired ? "tripwire" : m.status}
                </span>
              </header>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Train Brier</div>
                  <div className="text-lg font-semibold tabular-nums">{m.train_brier?.toFixed(4) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Val Brier</div>
                  <div className="text-lg font-semibold tabular-nums">{m.val_brier?.toFixed(4) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Holdout Brier</div>
                  <div className={cn("text-lg font-semibold tabular-nums",
                    m.tripwire_fired && "text-rose-400")}>
                    {m.holdout_brier?.toFixed(4) ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Holdout AUC</div>
                  <div className="text-lg font-semibold tabular-nums">{m.holdout_auc?.toFixed(3) ?? "—"}</div>
                </div>
              </div>
              {m.overfit_gap != null && (
                <div className="mt-3 text-xs">
                  Overfit gap: <span className={cn("font-mono",
                    m.tripwire_fired ? "text-rose-400" : "text-muted-foreground")}>
                    {m.overfit_gap.toFixed(4)}
                  </span>
                  {" / threshold "}
                  <span className="font-mono text-muted-foreground">{m.overfit_threshold?.toFixed(4)}</span>
                </div>
              )}
              {m.top_features.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Top {Math.min(15, m.top_features.length)} features by gain
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.top_features.map((f) => (
                      <span key={f.name} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                        {f.name}: {f.gain.toFixed(0)}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </article>
          ))}
        </section>
      )}

      {tab === "runs" && (
        <section className="rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Run</th>
                  <th className="px-3 py-2 text-left">Window</th>
                  <th className="px-3 py-2 text-right">Scored</th>
                  <th className="px-3 py-2 text-right">Hit rate</th>
                  <th className="px-3 py-2 text-right">Brier ↓</th>
                  <th className="px-3 py-2 text-right">Log loss ↓</th>
                  <th className="px-3 py-2 text-right">PF</th>
                  <th className="px-3 py-2 text-right">Avg ret</th>
                </tr>
              </thead>
              <tbody>
                {runsQ.isLoading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">loading…</td></tr>
                )}
                {!runsQ.isLoading && (runsQ.data ?? []).length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No backtest runs yet — run <code>cfp-jobs delphi-replay --window-start YYYY-MM-DD --window-end YYYY-MM-DD</code>.
                  </td></tr>
                )}
                {(runsQ.data ?? []).map((r) => (
                  <tr key={r.run_id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{r.run_id}</div>
                      <div className="text-[10px] text-muted-foreground">{r.model_version}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(r.window_start).toLocaleDateString()} →{" "}
                      {new Date(r.window_end).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.n_scored.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.hit_rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.brier_score?.toFixed(4) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.log_loss?.toFixed(4) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.profit_factor?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.avg_realized_return, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

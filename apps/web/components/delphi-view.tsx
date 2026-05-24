"use client";

// Delphi — market-foresight tab.
//
// Reads /v1/delphi/predictions for each horizon and shows ranked rows. Each
// prediction is a *frozen hypothesis*: target range, probability, invalidation,
// reason codes. The memory dashboard at the top shows whether past forecasts
// actually paid off — without that loop, Delphi is just another ranker.
//
// Empty state is the default until the delphi-rank job has written rows.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { baseUrl, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const HORIZONS = ["EOD", "1w", "1mo", "3mo", "6mo", "12mo"] as const;
const RANK_MODES = [
  { id: "ev", label: "Best EV" },
  { id: "probability", label: "Highest Probability" },
  { id: "upside", label: "Highest Upside" },
] as const;
const BIAS_TOGGLES = [
  { id: null, label: "All" },
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "vol_expansion", label: "Volatility" },
] as const;

type Horizon = (typeof HORIZONS)[number];
type RankMode = (typeof RANK_MODES)[number]["id"];
type Bias = (typeof BIAS_TOGGLES)[number]["id"];

type PredictionRow = {
  prediction_id: string;
  created_at: string;
  ticker: string;
  signal_timeframe: string;
  forecast_horizon: string;
  horizon_ends_at: string;
  current_price: number;
  bias: string;
  target_range: { low: number; high: number };
  primary_target: number;
  expected_return: number;
  probability: number;
  downside_risk: number;
  risk_reward: number | null;
  invalidation: number;
  confidence: string;
  delphi_score: number;
  reason_codes: string[];
  regime: string | null;
  model_version: string;
  explanation: string | null;
  // v0.3 quant fields — optional because v0.1/v0.2 rows return null/false
  prob_lo?: number | null;
  prob_hi?: number | null;
  prob_ci_n?: number | null;
  kelly_fraction?: number | null;
  return_p10?: number | null;
  return_p50?: number | null;
  return_p90?: number | null;
  gex_wall_anchored?: boolean;
  // Phase 5d: concrete option suggestion (NULL until delphi-options-suggest runs)
  option?: {
    contract_symbol: string | null;
    option_type: string;
    strike: number;
    expiry: string;
    days_to_expiry: number;
    current_mid: number | null;
    current_iv: number | null;
    price_source: string | null;
    value_at_target: number | null;
    value_at_invalidation: number | null;
    ev_per_contract: number | null;
    ev_pct_of_cost: number | null;
    breakeven_probability: number | null;
    contracts_at_kelly: number | null;
  } | null;
};

type PredictionListResponse = {
  horizon: string;
  rank_mode: string;
  count: number;
  generated_at: string;
  predictions: PredictionRow[];
};

type HorizonStat = {
  horizon: string;
  prediction_count: number;
  evaluated_count: number;
  target_hit_rate: number | null;
  average_return: number | null;
};

type ReasonCodeStat = {
  reason_code: string;
  times_used: number;
  target_hit_rate: number | null;
  average_return: number | null;
  weight_modifier: number;
};

type MemoryStatsResponse = {
  generated_at: string;
  total_predictions: number;
  total_evaluated: number;
  overall_hit_rate: number | null;
  by_horizon: HorizonStat[];
  top_reason_codes: ReasonCodeStat[];
};

async function fetchPredictions(
  horizon: Horizon,
  bias: Bias,
  rankMode: RankMode,
): Promise<PredictionListResponse> {
  const sp = new URLSearchParams({
    horizon,
    rank_mode: rankMode,
    limit: "25",
  });
  if (bias) sp.set("bias", bias);
  const res = await fetch(`${baseUrl()}/v1/delphi/predictions?${sp}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchMemoryStats(): Promise<MemoryStatsResponse> {
  const res = await fetch(`${baseUrl()}/v1/delphi/memory/stats`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtPrice(x: number): string {
  if (x >= 1000) return x.toFixed(0);
  if (x >= 100) return x.toFixed(1);
  return x.toFixed(2);
}

function biasColor(bias: string): string {
  if (bias === "bullish") return "text-emerald-500";
  if (bias === "bearish") return "text-rose-500";
  return "text-amber-500";
}

export function DelphiView() {
  const [horizon, setHorizon] = useState<Horizon>("1w");
  const [bias, setBias] = useState<Bias>(null);
  const [rankMode, setRankMode] = useState<RankMode>("ev");

  const memoryQuery = useQuery({
    queryKey: ["delphi", "memory"],
    queryFn: fetchMemoryStats,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const predictionsQuery = useQuery({
    queryKey: ["delphi", "predictions", horizon, bias, rankMode],
    queryFn: () => fetchPredictions(horizon, bias, rankMode),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Delphi</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Market foresight from flow, Greeks, volatility, and adaptive prediction memory. Each row is
          a frozen hypothesis — target range, probability, invalidation, reason codes — that gets
          evaluated when the horizon closes. The memory panel below tracks whether past forecasts
          actually paid off.
        </p>
      </header>

      <MemoryPanel data={memoryQuery.data} isLoading={memoryQuery.isLoading} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {HORIZONS.map((h) => (
          <button
            key={h}
            onClick={() => setHorizon(h)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              horizon === h
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {h}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {BIAS_TOGGLES.map((b) => (
              <button
                key={b.label}
                onClick={() => setBias(b.id)}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors",
                  bias === b.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {RANK_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setRankMode(m.id)}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors",
                  rankMode === m.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PredictionTable
        data={predictionsQuery.data}
        isLoading={predictionsQuery.isLoading}
        isError={predictionsQuery.isError}
      />
    </div>
  );
}

function MemoryPanel({
  data,
  isLoading,
}: {
  data: MemoryStatsResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const evaluated = data.total_evaluated;
  const total = data.total_predictions;
  const coverage = total > 0 ? evaluated / total : 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <Stat label="Total predictions" value={total.toLocaleString()} />
          <Stat
            label="Evaluated"
            value={`${evaluated.toLocaleString()} (${fmtPct(coverage, 0)})`}
          />
          <Stat label="Overall hit rate" value={fmtPct(data.overall_hit_rate)} />
        </div>

        {data.by_horizon.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Hit rate by horizon
            </div>
            <div className="flex flex-wrap gap-3">
              {data.by_horizon.map((h) => (
                <div
                  key={h.horizon}
                  className="border border-border rounded-md px-3 py-2 min-w-[100px]"
                >
                  <div className="text-xs text-muted-foreground">{h.horizon}</div>
                  <div className="text-sm font-medium">{fmtPct(h.target_hit_rate)}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.evaluated_count}/{h.prediction_count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.top_reason_codes.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Top reason codes
            </div>
            <div className="flex flex-wrap gap-2">
              {data.top_reason_codes.map((rc) => (
                <Badge key={rc.reason_code} variant="muted" className="font-mono text-xs">
                  {rc.reason_code} · {fmtPct(rc.target_hit_rate)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  );
}

function PredictionTable({
  data,
  isLoading,
  isError,
}: {
  data: PredictionListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-rose-500">
          Couldn&apos;t load predictions. Check the API is up and the delphi-rank job has run at least
          once.
        </CardContent>
      </Card>
    );
  }

  if (!data || data.predictions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No predictions yet for this horizon. Run <code className="font-mono">cfp-jobs delphi-rank</code>{" "}
          to populate the table — it consumes the UW screener output and writes ranked predictions
          here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Rank</th>
            <th className="text-left px-3 py-2">Ticker</th>
            <th className="text-left px-3 py-2">Signal TF</th>
            <th className="text-left px-3 py-2">Bias</th>
            <th className="text-right px-3 py-2">Price</th>
            <th className="text-right px-3 py-2">Target</th>
            <th className="text-right px-3 py-2">Est. Return</th>
            <th className="text-right px-3 py-2" title="ML quantile fan: p10 / p50 / p90 of expected return distribution">
              Return fan
            </th>
            <th className="text-right px-3 py-2">Probability</th>
            <th className="text-right px-3 py-2" title="Fractional Kelly (0.25x) position size. Negative or unavailable = do not trade.">
              Kelly
            </th>
            <th className="text-left px-3 py-2" title="Suggested option contract with current mid price + expected value per contract">
              Option · EV
            </th>
            <th className="text-right px-3 py-2">Invalidation</th>
            <th className="text-right px-3 py-2">Score</th>
            <th className="text-left px-3 py-2">Why</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.predictions.map((p, i) => (
            <tr key={p.prediction_id} className="hover:bg-accent/30">
              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2 font-medium">
                <div className="flex items-center gap-1">
                  {p.ticker}
                  {p.gex_wall_anchored && (
                    <span
                      className="font-mono text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300"
                      title="Target anchored to dealer gamma wall — mechanical magnet for price"
                    >
                      GEX
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{p.signal_timeframe}</td>
              <td className={cn("px-3 py-2 capitalize", biasColor(p.bias))}>
                {p.bias.replace("_", " ")}
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmtPrice(p.current_price)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {fmtPrice(p.target_range.low)}–{fmtPrice(p.target_range.high)}
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right font-mono",
                  p.expected_return >= 0 ? "text-emerald-500" : "text-rose-500",
                )}
              >
                {p.expected_return >= 0 ? "+" : ""}
                {fmtPct(p.expected_return)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">
                {p.return_p10 != null && p.return_p50 != null && p.return_p90 != null ? (
                  <div className="flex flex-col items-end leading-tight">
                    <span>{fmtPct(p.return_p50)}</span>
                    <span className="text-[10px] opacity-70">
                      [{fmtPct(p.return_p10)}, {fmtPct(p.return_p90)}]
                    </span>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <div className="flex flex-col items-end leading-tight">
                  <span>{fmtPct(p.probability)}</span>
                  {p.prob_lo != null && p.prob_hi != null ? (
                    <span className="text-[10px] text-muted-foreground">
                      [{fmtPct(p.prob_lo)}, {fmtPct(p.prob_hi)}] · n={p.prob_ci_n}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic">calibrating</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {p.kelly_fraction != null && p.kelly_fraction > 0 ? (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded",
                      p.kelly_fraction >= 0.05
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-muted text-muted-foreground"
                    )}
                    title="Fractional Kelly at 0.25x — multiply by account equity for $ size"
                  >
                    {fmtPct(p.kelly_fraction)}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {p.option ? (
                  <div className="flex flex-col leading-tight gap-0.5">
                    <span className="font-semibold">
                      {p.option.strike}{p.option.option_type} {p.option.expiry.slice(0, 10)}
                      <span className="ml-1 text-muted-foreground">({p.option.days_to_expiry}d)</span>
                    </span>
                    <span>
                      mid <span className="font-semibold">${(p.option.current_mid ?? 0).toFixed(2)}</span>
                      {p.option.price_source && (
                        <span
                          className={cn(
                            "ml-1 px-1 py-0.5 rounded text-[9px]",
                            p.option.price_source === "uw_flow" && "bg-emerald-500/15 text-emerald-300",
                            p.option.price_source === "uw_history" && "bg-blue-500/15 text-blue-300",
                            p.option.price_source === "bs_theo" && "bg-muted text-muted-foreground"
                          )}
                          title={`Price source: ${p.option.price_source === "uw_flow" ? "live flow trade <7d" : p.option.price_source === "uw_history" ? "yesterday's close" : "Black-Scholes theoretical"}`}
                        >
                          {p.option.price_source === "uw_flow" ? "live" : p.option.price_source === "uw_history" ? "EOD" : "theo"}
                        </span>
                      )}
                    </span>
                    {p.option.ev_per_contract != null && (
                      <span
                        className={cn(
                          "font-semibold",
                          p.option.ev_per_contract > 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                        title={
                          p.option.breakeven_probability != null
                            ? `Breakeven at ${(p.option.breakeven_probability * 100).toFixed(0)}% probability`
                            : ""
                        }
                      >
                        EV {p.option.ev_per_contract >= 0 ? "+" : ""}
                        ${p.option.ev_per_contract.toFixed(0)}/contract
                        {p.option.ev_pct_of_cost != null && (
                          <span className="ml-1 text-[10px] opacity-80">
                            ({(p.option.ev_pct_of_cost * 100).toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    )}
                    {p.option.contracts_at_kelly != null && p.option.contracts_at_kelly > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        size: {p.option.contracts_at_kelly} contracts @ Kelly
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                {fmtPrice(p.invalidation)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {Math.round(p.delphi_score)}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {p.reason_codes.slice(0, 3).map((rc) => (
                    <span
                      key={rc}
                      className={cn(
                        "font-mono text-[10px] px-1.5 py-0.5 rounded",
                        rc.startsWith("CONFLICT_")
                          ? "bg-amber-500/15 text-amber-300"
                          : rc.startsWith("GEX_")
                            ? "bg-blue-500/15 text-blue-300"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {rc}
                    </span>
                  ))}
                  {p.reason_codes.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{p.reason_codes.length - 3}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

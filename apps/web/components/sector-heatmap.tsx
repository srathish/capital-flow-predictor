"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { SectorEntry, SectorForwardCallResponse, SectorScorecardResponse } from "@/lib/types";
import { cn, formatDate, formatNum } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";

// ────────────────────────────────────────────────────────────────────────────
// SPDR sector metadata
// ────────────────────────────────────────────────────────────────────────────

interface SectorMeta {
  name: string;
  theme: "secular growth" | "cyclical" | "defensive" | "rate-sensitive" | "commodity-linked" | "rate beneficiary";
  drivers: string[];
}

const SECTOR_META: Record<string, SectorMeta> = {
  XLK:  { name: "Technology",             theme: "secular growth",      drivers: ["AI capex", "rate sensitivity", "earnings momentum"] },
  XLC:  { name: "Communication Services", theme: "secular growth",      drivers: ["digital ad spend", "subscriber trends"] },
  XLY:  { name: "Consumer Discretionary", theme: "cyclical",            drivers: ["consumer sentiment", "wage growth", "credit conditions"] },
  XLI:  { name: "Industrials",            theme: "cyclical",            drivers: ["PMI trends", "capex cycle", "global trade"] },
  XLB:  { name: "Materials",              theme: "cyclical",            drivers: ["China demand", "USD strength", "commodity prices"] },
  XLE:  { name: "Energy",                 theme: "commodity-linked",    drivers: ["crude prices", "OPEC+ supply", "USD strength"] },
  XLF:  { name: "Financials",             theme: "rate beneficiary",    drivers: ["yield curve", "credit spreads", "loan demand"] },
  XLV:  { name: "Health Care",            theme: "defensive",           drivers: ["pricing power", "regulatory backdrop", "biotech pipelines"] },
  XLP:  { name: "Consumer Staples",       theme: "defensive",           drivers: ["risk-off rotation", "input costs", "USD strength"] },
  XLU:  { name: "Utilities",              theme: "rate-sensitive",      drivers: ["10Y yield", "power demand"] },
  XLRE: { name: "Real Estate",            theme: "rate-sensitive",      drivers: ["10Y yield", "cap rates", "occupancy trends"] },
};

function metaFor(symbol: string): SectorMeta {
  return SECTOR_META[symbol] ?? { name: symbol, theme: "cyclical", drivers: [] };
}

type Tier = "leader" | "strong" | "neutral" | "weak" | "laggard";

function tierFor(rank: number, total: number): Tier {
  const pos = (rank - 1) / Math.max(1, total - 1);
  if (pos < 0.2) return "leader";
  if (pos < 0.45) return "strong";
  if (pos > 0.8) return "laggard";
  if (pos > 0.55) return "weak";
  return "neutral";
}

function tileBg(tier: Tier | null): string {
  switch (tier) {
    case "leader":  return "bg-signal-bullish/25 hover:bg-signal-bullish/40";
    case "strong":  return "bg-signal-bullish/10 hover:bg-signal-bullish/20";
    case "weak":    return "bg-signal-bearish/10 hover:bg-signal-bearish/20";
    case "laggard": return "bg-signal-bearish/25 hover:bg-signal-bearish/40";
    case "neutral": return "bg-muted hover:bg-muted/70";
    default:        return "bg-muted/40";
  }
}

function captionFor(tier: Tier, score: number | null): string {
  switch (tier) {
    case "leader":
      return score !== null && score > 0
        ? "Leading the tape — model still favors this basket"
        : "Top of the pack on relative strength";
    case "strong":  return "Above the median — momentum intact";
    case "neutral": return "Middle of the pack — no edge signaled";
    case "weak":    return "Below the median — momentum fading";
    case "laggard": return "Underperforming peers — model expects continued lag";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Market read narrative (extended with rotation activity + dispersion)
// ────────────────────────────────────────────────────────────────────────────

interface MarketRead {
  leaders: SectorEntry[];
  laggards: SectorEntry[];
  scoreRange: number;
  scoreStdev: number;
  dominantLeaderTheme: string | null;
  dominantLaggardTheme: string | null;
  regime: "risk-on" | "risk-off" | "mixed" | "no-edge";
  paragraph: string;
  rotationActivity: "calm" | "moderate" | "high";
  avgAbsRankDelta: number;
}

function buildMarketRead(ranked: SectorEntry[]): MarketRead | null {
  if (ranked.length < 4) return null;
  const leaders = ranked.slice(0, 3);
  const laggards = ranked.slice(-3).reverse();
  const scores = ranked
    .map((s) => s.latest_score)
    .filter((v): v is number => v !== null);
  const scoreRange = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const variance = scores.length
    ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
    : 0;
  const scoreStdev = Math.sqrt(variance);

  const deltas = ranked
    .map((s) => (s.latest_rank !== null && s.prior_rank !== null ? Math.abs(s.latest_rank - s.prior_rank) : null))
    .filter((v): v is number => v !== null);
  const avgAbsRankDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const rotationActivity: MarketRead["rotationActivity"] =
    avgAbsRankDelta < 0.6 ? "calm" : avgAbsRankDelta < 1.5 ? "moderate" : "high";

  const themeMode = (rows: SectorEntry[]): string | null => {
    const tally = new Map<string, number>();
    for (const r of rows) {
      const t = metaFor(r.symbol).theme;
      tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of tally) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return bestN >= 2 ? best : null;
  };

  const dominantLeaderTheme = themeMode(leaders);
  const dominantLaggardTheme = themeMode(laggards);

  const cyclicalish = (t: string | null) =>
    t === "cyclical" || t === "secular growth" || t === "rate beneficiary" || t === "commodity-linked";
  const defensiveish = (t: string | null) =>
    t === "defensive" || t === "rate-sensitive";

  let regime: MarketRead["regime"] = "mixed";
  if (scoreRange < 0.05) regime = "no-edge";
  else if (cyclicalish(dominantLeaderTheme) && defensiveish(dominantLaggardTheme)) regime = "risk-on";
  else if (defensiveish(dominantLeaderTheme) && cyclicalish(dominantLaggardTheme)) regime = "risk-off";

  const leaderNames = leaders.map((s) => `${s.symbol} (${metaFor(s.symbol).name})`).join(", ");
  const laggardNames = laggards.map((s) => `${s.symbol} (${metaFor(s.symbol).name})`).join(", ");

  const themeReason = dominantLeaderTheme
    ? `Two-of-three leaders share a ${dominantLeaderTheme} profile, which the model is favoring right now.`
    : `Leaders span different themes — no single regime is dominating.`;

  const dispersionReason =
    scoreRange < 0.05
      ? `Score range is only ${scoreRange.toFixed(3)} (σ ${scoreStdev.toFixed(3)}) — pack is tight, don't read too much into rank order.`
      : scoreRange < 0.12
        ? `Score range is ${scoreRange.toFixed(3)} (σ ${scoreStdev.toFixed(3)}) — modest dispersion; the lead is real but not commanding.`
        : `Score range is ${scoreRange.toFixed(3)} (σ ${scoreStdev.toFixed(3)}) — wide dispersion; the model has a clear preference.`;

  const rotationReason = deltas.length
    ? rotationActivity === "calm"
      ? `Rotation is calm — avg rank change is ${avgAbsRankDelta.toFixed(2)} since the prior run.`
      : rotationActivity === "moderate"
        ? `Rotation is moderate — avg rank change ${avgAbsRankDelta.toFixed(2)}; some baskets are repositioning.`
        : `Rotation is hot — avg rank change ${avgAbsRankDelta.toFixed(2)}; leadership is shifting fast.`
    : "";

  const regimeLine = {
    "risk-on":  `Read: risk-on rotation. Cyclical / growth baskets lead while defensives lag.`,
    "risk-off": `Read: risk-off / defensive bid. Defensive baskets lead while cyclicals lag.`,
    "mixed":    `Read: rotation is mixed — leadership doesn't cleanly map to a single regime.`,
    "no-edge":  `Read: scores are bunched — model doesn't see a strong edge between baskets.`,
  }[regime];

  const paragraph = [
    `Top 3: ${leaderNames}.`,
    `Bottom 3: ${laggardNames}.`,
    themeReason,
    dispersionReason,
    rotationReason,
    regimeLine,
  ].filter(Boolean).join(" ");

  return {
    leaders,
    laggards,
    scoreRange,
    scoreStdev,
    dominantLeaderTheme,
    dominantLaggardTheme,
    regime,
    paragraph,
    rotationActivity,
    avgAbsRankDelta,
  };
}

const REGIME_BADGE: Record<MarketRead["regime"], { label: string; cls: string }> = {
  "risk-on":  { label: "Risk-on rotation",  cls: "bg-signal-bullish/15 text-signal-bullish ring-signal-bullish/30" },
  "risk-off": { label: "Defensive bid",     cls: "bg-signal-bearish/15 text-signal-bearish ring-signal-bearish/30" },
  "mixed":    { label: "Mixed leadership",  cls: "bg-muted/40 text-muted-foreground ring-border" },
  "no-edge":  { label: "No clear edge",     cls: "bg-muted/40 text-muted-foreground ring-border" },
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const HORIZON_OPTIONS: { value: number; label: string }[] = [
  { value: 5,  label: "5d"  },
  { value: 10, label: "10d" },
  { value: 20, label: "20d" },
];

export function SectorHeatmap() {
  const [horizon, setHorizon] = useState<number>(10);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sectors", { horizon }],
    queryFn: () => api.sectors({ horizon, history: 30 }),
  });

  const { data: scorecard } = useQuery({
    queryKey: ["sector-scorecard", { horizon }],
    queryFn: () => api.sectorScorecard({ horizon, lookbackRuns: 30 }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: forwardCall } = useQuery({
    queryKey: ["sector-forward-call", { horizon }],
    queryFn: () => api.sectorForwardCall({ horizon }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { ranked, unranked, total, marketRead } = useMemo(() => {
    const ranked = (data?.sectors ?? [])
      .filter((s) => s.latest_rank !== null)
      .sort((a, b) => (a.latest_rank ?? 999) - (b.latest_rank ?? 999));
    const unranked = (data?.sectors ?? []).filter((s) => s.latest_rank === null);
    return {
      ranked,
      unranked,
      total: ranked.length,
      marketRead: buildMarketRead(ranked),
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-signal-bearish/40">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Sector data is unavailable right now. Try again in a moment.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sector predictions</h1>
          <p className="text-sm text-muted-foreground">
            {horizon}-day relative-strength rankings from <code className="rounded bg-muted px-1">xgb_v1</code>.{" "}
            {data.run_ts && <>Last run {formatDate(data.run_ts)}.</>}
          </p>
        </div>
        <HorizonTabs value={horizon} onChange={setHorizon} />
      </div>

      {scorecard && <ScorecardStrip s={scorecard} />}

      {marketRead && <MarketReadCard read={marketRead} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {ranked.map((s) => (
          <Tile key={s.symbol} s={s} totalRanked={total} />
        ))}
      </div>

      {unranked.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Holdings without ranking</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {unranked.map((s) => (
              <Tile key={s.symbol} s={s} totalRanked={total} />
            ))}
          </div>
        </div>
      )}

      {forwardCall && <ForwardCallCard fc={forwardCall} scorecard={scorecard} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function HorizonTabs({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
      {HORIZON_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ScorecardStrip({ s }: { s: SectorScorecardResponse }) {
  const hit = s.hit_rate;
  const spread = s.avg_spread;
  const tone =
    hit === null ? "neutral" :
    hit >= 0.55 ? "bullish" :
    hit <= 0.45 ? "bearish" : "neutral";
  const toneCls =
    tone === "bullish" ? "text-signal-bullish" :
    tone === "bearish" ? "text-signal-bearish" :
    "text-foreground";
  const spreadCls =
    spread === null ? "text-muted-foreground" :
    spread > 0 ? "text-signal-bullish" :
    spread < 0 ? "text-signal-bearish" : "text-muted-foreground";

  // IC tone — anything > 0.05 is meaningful for a small-N ranker.
  const ic = s.ic_mean;
  const icCls =
    ic === null ? "text-muted-foreground" :
    ic > 0.05 ? "text-signal-bullish" :
    ic < -0.05 ? "text-signal-bearish" : "text-foreground";

  // Model vs naïve 20d-momentum baseline. If we can't beat the baseline,
  // call it out — that's the whole point of running this comparison.
  const b = s.baseline;
  const hitDelta = (hit !== null && b.hit_rate !== null) ? hit - b.hit_rate : null;
  const spreadDelta = (spread !== null && b.avg_spread !== null) ? spread - b.avg_spread : null;
  const beatsBaseline =
    hitDelta !== null && spreadDelta !== null && (hitDelta > 0.02 || spreadDelta > 0.002);
  const deltaCls = beatsBaseline ? "text-signal-bullish" : (hitDelta !== null && hitDelta < 0 ? "text-signal-bearish" : "text-muted-foreground");

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hit rate (top-3 &gt; bottom-3)</div>
          <div className={cn("mt-1 text-lg font-semibold num", toneCls)}>
            {hit === null ? "—" : `${(hit * 100).toFixed(0)}%`}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Naïve mom: {b.hit_rate === null ? "—" : `${(b.hit_rate * 100).toFixed(0)}%`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg spread (top − bottom)</div>
          <div className={cn("mt-1 text-lg font-semibold num", spreadCls)}>
            {spread === null ? "—" : `${spread > 0 ? "+" : ""}${(spread * 100).toFixed(2)}%`}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Naïve mom: {b.avg_spread === null ? "—" : `${b.avg_spread > 0 ? "+" : ""}${(b.avg_spread * 100).toFixed(2)}%`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rank IC (mean ± σ)</div>
          <div className={cn("mt-1 text-lg font-semibold num", icCls)}>
            {ic === null ? "—" : `${ic > 0 ? "+" : ""}${ic.toFixed(3)}`}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {s.ic_stdev === null ? "σ —" : `σ ${s.ic_stdev.toFixed(3)}`}
            {s.ic_t_stat !== null && <> · t={s.ic_t_stat.toFixed(2)}</>}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">vs 20d momentum</div>
          <div className={cn("mt-1 text-sm font-semibold num", deltaCls)}>
            {hitDelta === null ? "—" : `${hitDelta >= 0 ? "+" : ""}${(hitDelta * 100).toFixed(0)}pp hit`}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {spreadDelta === null ? "" : `${spreadDelta >= 0 ? "+" : ""}${(spreadDelta * 100).toFixed(2)}% spread`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Runs evaluated</div>
          <div className="mt-1 text-sm num">
            {s.n_runs_evaluated} <span className="text-muted-foreground">/ {s.n_runs_total}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            top-3 {s.avg_top3_return === null ? "—" : `${(s.avg_top3_return * 100).toFixed(1)}%`} /
            bot-3 {s.avg_bottom3_return === null ? "—" : `${(s.avg_bottom3_return * 100).toFixed(1)}%`}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketReadCard({ read }: { read: MarketRead }) {
  const badge = REGIME_BADGE[read.regime];
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Market read
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            How to read this rotation in plain English.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border">
            Rotation: {read.rotationActivity}
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              badge.cls
            )}
          >
            {badge.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-1 text-sm leading-relaxed text-foreground">
        <p>{read.paragraph}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LeaderLagBlock title="Why these are leading" rows={read.leaders} kind="leader" />
          <LeaderLagBlock title="Why these are lagging" rows={read.laggards} kind="laggard" />
        </div>
      </CardContent>
    </Card>
  );
}

function LeaderLagBlock({
  title, rows, kind,
}: { title: string; rows: SectorEntry[]; kind: "leader" | "laggard" }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => {
          const m = metaFor(r.symbol);
          const score = r.latest_score;
          const sign =
            score === null ? "—" : score > 0 ? `+${score.toFixed(3)}` : score.toFixed(3);
          const reason =
            kind === "leader"
              ? `model score ${sign} on a ${m.theme} basket`
              : `model score ${sign}, ${m.theme} basket out of favor`;
          const drivers = m.drivers.length ? `Watch: ${m.drivers.slice(0, 2).join(", ")}.` : "";
          return (
            <li key={r.symbol} className="text-foreground">
              <span className="font-semibold">{r.symbol}</span>{" "}
              <span className="text-muted-foreground">— {m.name}</span>{" "}
              <span className="text-muted-foreground">— {reason}.</span>{" "}
              {drivers && <span className="text-muted-foreground">{drivers}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function rankDelta(s: SectorEntry): { value: number | null; arrow: string; cls: string; tip: string } {
  if (s.latest_rank === null || s.prior_rank === null) {
    return { value: null, arrow: "·", cls: "text-muted-foreground", tip: "no prior run" };
  }
  // Smaller rank = better, so rising = prior > latest.
  const change = s.prior_rank - s.latest_rank;
  if (change > 0) {
    return {
      value: change,
      arrow: "▲",
      cls: "text-signal-bullish",
      tip: `Climbed ${change} rank${change === 1 ? "" : "s"} since the prior run`,
    };
  }
  if (change < 0) {
    return {
      value: change,
      arrow: "▼",
      cls: "text-signal-bearish",
      tip: `Fell ${Math.abs(change)} rank${Math.abs(change) === 1 ? "" : "s"} since the prior run`,
    };
  }
  return { value: 0, arrow: "•", cls: "text-muted-foreground", tip: "Unchanged since the prior run" };
}

function ConfidenceChip({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return null;
  const v = Math.max(0, Math.min(1, value));
  const level: "low" | "med" | "high" = v < 0.34 ? "low" : v < 0.67 ? "med" : "high";
  const cls = {
    low:  "bg-muted/60 text-muted-foreground",
    med:  "bg-amber-500/15 text-amber-400",
    high: "bg-signal-bullish/15 text-signal-bullish",
  }[level];
  return (
    <span
      className={cn("rounded-sm px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-border", cls)}
      title={`Model confidence ${v.toFixed(2)}`}
    >
      conf {v.toFixed(2)}
    </span>
  );
}

function Tile({ s, totalRanked }: { s: SectorEntry; totalRanked: number }) {
  const tier = s.latest_rank !== null ? tierFor(s.latest_rank, totalRanked) : null;
  const meta = metaFor(s.symbol);
  const delta = rankDelta(s);

  // Sparkline shows rank-over-time INVERTED so visually "up = better rank".
  const sparkValues = s.rank_history.map((r) => -r);

  return (
    <Link href={`/sectors/${encodeURIComponent(s.symbol)}`} className="block group">
      <Card className={cn("h-full transition-colors", tileBg(tier))}>
        <CardHeader className="p-3 pb-1">
          <div className="flex items-baseline justify-between">
            <CardTitle className="text-base">{s.symbol}</CardTitle>
            {s.latest_rank !== null && (
              <span className="num text-xs text-muted-foreground">
                <span className={cn("mr-1 font-semibold", delta.cls)} title={delta.tip}>
                  {delta.arrow}
                  {delta.value !== null && delta.value !== 0 ? Math.abs(delta.value) : ""}
                </span>
                #{s.latest_rank}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{meta.name}</div>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>score</span>
            <span className="num">{formatNum(s.latest_score, 4)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>holdings</span>
            <span className="num">{s.n_constituents}</span>
          </div>

          {sparkValues.length >= 2 && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide">rank trend</span>
              <Sparkline values={sparkValues} width={72} height={20} />
            </div>
          )}

          {s.confidence !== null && (
            <div className="mt-2">
              <ConfidenceChip value={s.confidence} />
            </div>
          )}

          {tier && (
            <p className="mt-2 line-clamp-2 leading-snug text-foreground/80">
              {captionFor(tier, s.latest_score)}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Forward call card — bottom-of-tab narrative ("for the next ~N days, the
// model thinks X, Y, Z keep leading…") with cross-horizon disagreement and
// stability anchor. Reads from /v1/sectors/forward-call + existing scorecard.
// ────────────────────────────────────────────────────────────────────────────

function horizonPhrase(d: number): string {
  if (d <= 6)  return `next week`;
  if (d <= 14) return `next ~2 weeks`;
  return `next ~${Math.round(d / 5)} weeks`;
}

const CONVICTION_LABEL: Record<SectorForwardCallResponse["conviction"], { tag: string; cls: string }> = {
  high:   { tag: "high conviction",   cls: "bg-signal-bullish/15 text-signal-bullish ring-signal-bullish/30" },
  medium: { tag: "medium conviction", cls: "bg-muted/40 text-foreground ring-border" },
  low:    { tag: "low conviction",    cls: "bg-muted/40 text-muted-foreground ring-border" },
};

function ForwardCallCard({
  fc,
  scorecard,
}: {
  fc: SectorForwardCallResponse;
  scorecard: SectorScorecardResponse | undefined;
}) {
  if (fc.top.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No forward call yet — wait for the next prediction run.
        </CardContent>
      </Card>
    );
  }

  const topNames = fc.top.map((e) => `${e.symbol} (${metaFor(e.symbol).name})`).join(", ");
  const botNames = fc.bottom.map((e) => `${e.symbol} (${metaFor(e.symbol).name})`).join(", ");
  const window = horizonPhrase(fc.horizon_d);
  const conv = CONVICTION_LABEL[fc.conviction];

  const leadLine = `Over the ${window}, the model expects ${topNames} to keep leading and ${botNames} to keep lagging.`;

  const spreadLine =
    fc.score_spread === null
      ? ""
      : fc.score_spread >= 0.12
        ? `Top-vs-bottom score gap is ${fc.score_spread.toFixed(3)} — wide, the call is decisive.`
        : fc.score_spread >= 0.05
          ? `Top-vs-bottom score gap is ${fc.score_spread.toFixed(3)} — modest edge.`
          : `Top-vs-bottom score gap is only ${fc.score_spread.toFixed(3)} — the pack is tight, treat rank order as soft.`;

  const stabilityLine =
    fc.stability_runs >= 2
      ? `Top-3 set has held for ${fc.stability_runs} consecutive runs — the model has been saying this for a while.`
      : `Top-3 set just shifted this run — fresh call, not yet confirmed.`;

  const hitLine =
    scorecard && scorecard.hit_rate !== null
      ? `Recent calibration at this horizon: ${(scorecard.hit_rate * 100).toFixed(0)}% top-3-beats-bottom-3 hit rate over the last ${scorecard.n_runs_evaluated} runs.`
      : `Calibration history isn't available yet for this horizon.`;

  const disagreeLines = fc.disagreements.map((d) => {
    const name = metaFor(d.symbol).name;
    const verdict =
      d.delta > 0
        ? `the ${d.other_horizon_d}d model is more bullish on ${d.symbol} (${name}): ranks it #${d.other_rank} vs #${d.active_rank} here`
        : `the ${d.other_horizon_d}d model is more bearish on ${d.symbol} (${name}): ranks it #${d.other_rank} vs #${d.active_rank} here`;
    return verdict;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Forward call · {fc.horizon_d}d</CardTitle>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
              conv.cls,
            )}
          >
            {conv.tag}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed">
        <p className="text-foreground">{leadLine}</p>
        <p className="text-muted-foreground">
          {[spreadLine, stabilityLine, hitLine].filter(Boolean).join(" ")}
        </p>

        {disagreeLines.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Cross-horizon disagreement
            </div>
            <ul className="space-y-1 text-xs text-foreground/85">
              {disagreeLines.map((line, i) => (
                <li key={i}>· {line}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          This is the model's view, not advice. {fc.target_ts && <>Target date: {formatDate(fc.target_ts)}.</>}
        </p>
      </CardContent>
    </Card>
  );
}

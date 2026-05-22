"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { SectorEntry } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { SectorRotationGraph } from "@/components/sector-rotation-graph";

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

function captionFor(tier: Tier): string {
  switch (tier) {
    case "leader":  return "Leading the tape on actual return";
    case "strong":  return "Above the median — outperforming peers";
    case "neutral": return "Middle of the pack";
    case "weak":    return "Below the median — underperforming peers";
    case "laggard": return "Worst-performing sector in the window";
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
  { value: 1,  label: "1d"  },
  { value: 5,  label: "5d"  },
  { value: 10, label: "10d" },
  { value: 20, label: "20d" },
];

const HORIZON_PHRASE: Record<number, string> = {
  1: "today's return",
  5: "this week's return",
  10: "trailing 10-day return",
  20: "trailing month's return",
};

export function SectorHeatmap() {
  const [horizon, setHorizon] = useState<number>(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sectors", { horizon }],
    queryFn: () => api.sectors({ horizon, history: 30 }),
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
          <h1 className="text-2xl font-semibold tracking-tight">Sector performance</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by {HORIZON_PHRASE[horizon] ?? `${horizon}-day return`}.{" "}
            {data.run_ts && <>Last close {formatDate(data.run_ts)}.</>}
          </p>
        </div>
        <HorizonTabs value={horizon} onChange={setHorizon} />
      </div>

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

      <SectorRotationGraph />
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
            <span>return</span>
            <span
              className={cn(
                "num font-semibold",
                s.latest_score !== null && s.latest_score > 0 && "text-signal-bullish",
                s.latest_score !== null && s.latest_score < 0 && "text-signal-bearish"
              )}
            >
              {s.latest_score === null
                ? "—"
                : `${s.latest_score >= 0 ? "+" : ""}${(s.latest_score * 100).toFixed(2)}%`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>holdings</span>
            <span className="num">{s.n_constituents}</span>
          </div>

          {sparkValues.length >= 2 && (() => {
            const first = s.rank_history[0];
            const last = s.rank_history[s.rank_history.length - 1];
            const runs = s.rank_history.length;
            const diff = first - last; // positive = climbed (smaller rank is better)
            let verb: string;
            let cls: string;
            if (diff > 0) { verb = "Climbed"; cls = "text-signal-bullish"; }
            else if (diff < 0) { verb = "Slipped"; cls = "text-signal-bearish"; }
            else { verb = "Held"; cls = "text-foreground/80"; }
            const sentence =
              diff === 0
                ? `Held #${last} across last ${runs} runs`
                : `${verb} #${first} → #${last} over last ${runs} runs`;
            return (
              <div className="mt-2">
                <div className={cn("text-[11px] leading-snug", cls)}>{sentence}</div>
                <Sparkline values={sparkValues} width={140} height={20} />
              </div>
            );
          })()}

          {tier && (
            <p className="mt-2 line-clamp-2 leading-snug text-foreground/80">
              {captionFor(tier)}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}


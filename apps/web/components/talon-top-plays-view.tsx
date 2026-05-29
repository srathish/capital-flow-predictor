"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import type { TalonContractPick, TalonTopPlay } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TIER_LABELS: Record<TalonContractPick["tier"], string> = {
  itm: "Defensive ITM",
  atm: "Standard ATM/OTM",
  otm: "Aggressive OTM",
};

const TIER_STYLES: Record<TalonContractPick["tier"], string> = {
  itm: "border-emerald-500/30 bg-emerald-500/5",
  atm: "border-primary/30 bg-primary/5",
  otm: "border-amber-500/30 bg-amber-500/5",
};

function fmtMoney(x: number | null): string {
  if (x == null || Number.isNaN(x)) return "—";
  if (x >= 1000) return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${x.toFixed(2)}`;
}
function fmtPct(x: number | null | undefined, digits = 1, signed = false): string {
  if (x == null || Number.isNaN(x)) return "—";
  const sign = signed && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(digits)}%`;
}
function fmtK(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return "—";
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1000) return `$${(x / 1000).toFixed(0)}K`;
  return `$${x}`;
}
function confidenceColor(c: number): string {
  if (c >= 70) return "bg-signal-bullish/15 text-signal-bullish";
  if (c >= 45) return "bg-amber-500/15 text-amber-400";
  if (c > 0) return "bg-foreground/10 text-muted-foreground";
  return "bg-signal-bearish/15 text-signal-bearish";
}

function EvidenceChips({ pick }: { pick: TalonContractPick }) {
  const e = pick.evidence;
  if (e.unbacked_reason) {
    return (
      <p className="mt-2 text-[10px] leading-snug text-signal-bearish/80">
        ✗ {e.unbacked_reason}
      </p>
    );
  }
  const chips: { label: string; tone?: "good" | "neutral" }[] = [];
  if (e.total_ask_side_prem != null && e.total_ask_side_prem > 0) {
    chips.push({ label: `${fmtK(e.total_ask_side_prem)} ask-side`, tone: "good" });
  }
  if (e.n_alerts != null && e.n_alerts >= 2) {
    chips.push({ label: `${e.n_alerts} hits`, tone: "good" });
  }
  if (e.oi_growth_pct != null && e.oi_growth_pct > 25) {
    chips.push({ label: `OI ↑${e.oi_growth_pct.toFixed(0)}%`, tone: "good" });
  } else if (e.current_oi != null) {
    chips.push({ label: `OI ${e.current_oi.toLocaleString()}`, tone: "neutral" });
  }
  if (e.has_sweep) chips.push({ label: "sweep", tone: "good" });
  if (e.has_floor) chips.push({ label: "floor block", tone: "good" });
  if (e.iv_latest_pct != null) chips.push({ label: `IV ${e.iv_latest_pct.toFixed(0)}%`, tone: "neutral" });
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
            c.tone === "good"
              ? "bg-signal-bullish/10 text-signal-bullish"
              : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function PickCard({ pick, currentPrice }: { pick: TalonContractPick; currentPrice: number }) {
  const isBacked = pick.confidence_score > 0;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3",
        TIER_STYLES[pick.tier],
        !isBacked && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{TIER_LABELS[pick.tier]}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 tabular-nums", confidenceColor(pick.confidence_score))}>
          conf {pick.confidence_score.toFixed(0)}
        </span>
      </div>
      {isBacked ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums">
              ${pick.strike?.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">C {pick.expiry}</span>
          </div>
          <div className="flex justify-between text-[11px] tabular-nums">
            <span className="text-muted-foreground">cost</span>
            <span className="font-medium">{fmtMoney(pick.cost_estimate)}</span>
          </div>
          <div className="flex justify-between text-[11px] tabular-nums">
            <span className="text-muted-foreground">breakeven</span>
            <span className="font-medium">
              {fmtMoney(pick.breakeven)}{" "}
              {pick.breakeven_pct_above_price != null && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({fmtPct(pick.breakeven_pct_above_price, 0, true)} from spot)
                </span>
              )}
            </span>
          </div>
          <EvidenceChips pick={pick} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center py-4">
          <EvidenceChips pick={pick} />
        </div>
      )}
    </div>
  );
}

function PlayCard({ play, rank }: { play: TalonTopPlay; rank: number }) {
  const gradeColor =
    play.grade >= 85 ? "bg-signal-bullish/20 text-signal-bullish" :
    play.grade >= 70 ? "bg-primary/15 text-primary" :
    "bg-amber-500/15 text-amber-400";
  const dirColor = play.direction === "bull"
    ? "bg-signal-bullish/15 text-signal-bullish"
    : play.direction === "bear" ? "bg-signal-bearish/15 text-signal-bearish"
    : "bg-foreground/10 text-muted-foreground";
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">#{rank}</span>
          <span className="text-xl font-bold tracking-tight">{play.ticker}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", gradeColor)}>
            G {play.grade.toFixed(1)}
          </span>
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase", dirColor)}>
            {play.direction}
          </span>
          <span className="text-xs text-muted-foreground">{play.theme}</span>
          {play.dp_skew_pct != null && (
            <span className={cn(
              "ml-auto text-xs tabular-nums",
              play.dp_skew_pct > 0.1 ? "text-signal-bullish" :
              play.dp_skew_pct < -0.1 ? "text-signal-bearish" :
              "text-muted-foreground",
            )}>
              DP {fmtPct(play.dp_skew_pct, 2, true)} · share {play.dp_share_pct?.toFixed(0)}%
            </span>
          )}
        </div>

        {/* Levels strip */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-foreground/[0.03] px-3 py-2 text-xs tabular-nums">
          <div>
            <span className="text-muted-foreground">Current</span>{" "}
            <span className="font-semibold">${play.current_price.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Soft Inval</span>{" "}
            <span className="font-medium text-signal-bearish/80">
              {play.soft_inval != null ? `$${play.soft_inval.toFixed(2)}` : "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">ST Target</span>{" "}
            <span className="font-medium text-signal-bullish">
              {play.st_target != null ? `$${play.st_target.toFixed(2)}` : "—"}
            </span>
          </div>
          {play.swing_targets.length > 0 && (
            <div>
              <span className="text-muted-foreground">Swing</span>{" "}
              <span className="font-medium text-signal-bullish/80">
                {play.swing_targets.map((s) => `$${s.toFixed(2)}`).join(" / ")}
              </span>
            </div>
          )}
          <div className="ml-auto text-[10px] text-muted-foreground">
            {play.n_picks_backed} / 3 tiers UW-backed
          </div>
        </div>

        {/* 3 picks side by side */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {play.picks.map((p) => (
            <PickCard key={p.tier} pick={p} currentPrice={play.current_price} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TalonTopPlaysView() {
  const qc = useQueryClient();

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["talon-top-plays"],
    queryFn: () => api.talonTopPlays().catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => api.talonTopPlays(true),
    onSuccess: (fresh) => { qc.setQueryData(["talon-top-plays"], fresh); },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0,1,2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-signal-bearish">
          {error instanceof ApiError ? `${error.status}: ${error.message}` : String(error)}
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No scan available yet. Go to <em>Scanner</em> and click <em>Run Scan</em>.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
          <div>
            <span className="text-muted-foreground">Top {data.top_plays.length} plays</span>{" "}
            from scan {data.scan_date}{" "}
            <span className="text-xs text-muted-foreground">
              · enriched via UW flow-alerts · {data._cache_hit ? "cached" : "fresh"}
            </span>
          </div>
          <button
            type="button"
            disabled={refresh.isPending || isFetching}
            onClick={() => refresh.mutate()}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              refresh.isPending
                ? "cursor-not-allowed bg-foreground/10 text-muted-foreground"
                : "bg-primary text-white hover:bg-primary/90",
            )}
          >
            {refresh.isPending ? "Re-enriching…" : "Force refresh"}
          </button>
        </CardContent>
      </Card>
      {data.top_plays.map((p, i) => (
        <PlayCard key={p.ticker} play={p} rank={i + 1} />
      ))}
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          <strong>Defensibility:</strong> Each contract pick is selected from
          the UW flow-alert tape — strikes with the highest combined ask-side
          premium, alert repetition, OI growth, and sweep/floor flags within
          the tier's price range. Confidence score (0–100) combines all four
          signals. A pick marked "no recent UW backing" means no qualifying
          alert exists in that tier's strike range — grade conviction only.
        </CardContent>
      </Card>
    </div>
  );
}

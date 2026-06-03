"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import type { TalonV2ContractPick, TalonV2TopPlay } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TIER_LABELS: Record<TalonV2ContractPick["tier"], string> = {
  itm: "Defensive ITM",
  atm: "Standard ATM/OTM",
  otm: "Aggressive OTM",
};

const TIER_STYLES: Record<TalonV2ContractPick["tier"], string> = {
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

function EvidenceChips({ pick }: { pick: TalonV2ContractPick }) {
  const e = pick.evidence;
  if (e.unbacked_reason) {
    return (
      <p className="mt-2 text-[10px] leading-snug text-signal-bearish/80">
        ✗ {e.unbacked_reason}
      </p>
    );
  }
  const chips: { label: string; tone?: "good" | "neutral" | "warn" }[] = [];
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
  // v2 warning chips
  for (const w of e.v2_warnings ?? []) {
    chips.push({ label: w.replace(/_/g, " "), tone: "warn" });
  }
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.map((c, i) => (
          <span
            key={i}
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
              c.tone === "good"
                ? "bg-signal-bullish/10 text-signal-bullish"
                : c.tone === "warn"
                ? "bg-rose-500/15 text-rose-300"
                : "bg-foreground/10 text-muted-foreground",
            )}
          >
            {c.label}
          </span>
        ))}
      </div>
      {(e.v2_anchor_notes ?? []).map((n, i) => (
        <p key={`anc-${i}`} className="mt-1 text-[10px] leading-snug text-emerald-300/80">
          🐋 {n}
        </p>
      ))}
      {(e.v2_notes ?? []).map((n, i) => (
        <p key={`note-${i}`} className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {n}
        </p>
      ))}
    </>
  );
}

function PickCard({ pick, currentPrice }: { pick: TalonV2ContractPick; currentPrice: number }) {
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
          {pick.confidence_score.toFixed(0)}
        </span>
      </div>
      {pick.strike != null && pick.expiry != null ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tabular-nums">${pick.strike}C</span>
            <span className="text-xs text-muted-foreground tabular-nums">{pick.expiry}</span>
            {pick.dte != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] tabular-nums",
                  pick.dte >= 25 && pick.dte <= 75
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pick.dte < 25
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-foreground/10 text-muted-foreground",
                )}
                title={
                  pick.dte >= 25 && pick.dte <= 75
                    ? "Swing window (25-75 DTE)"
                    : pick.dte < 25
                    ? "Near-term — outside swing window"
                    : "Long-dated — outside swing window"
                }
              >
                {pick.dte}d
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] tabular-nums">
            <span className="text-muted-foreground">
              ~cost: <span className="text-foreground">{fmtMoney(pick.cost_estimate)}</span>
            </span>
            <span className="text-muted-foreground">
              BE: <span className="text-foreground">{fmtMoney(pick.breakeven)}</span>
              {pick.breakeven_pct_above_price != null && (
                <span className="ml-1 text-muted-foreground">
                  ({fmtPct(pick.breakeven_pct_above_price, 1, true)})
                </span>
              )}
            </span>
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">No backed pick</div>
      )}
      <EvidenceChips pick={pick} />
    </div>
  );
}

function SignalBadges({ play }: { play: TalonV2TopPlay }) {
  const badges: { label: string; cls: string; title?: string }[] = [];
  if (play.coiled_score != null && play.coiled_score >= 0.65) {
    badges.push({
      label: `coiled ${Math.round(play.coiled_score * 100)}`,
      cls: "bg-amber-500/15 text-amber-300",
      title: "Chart base + volume dry-up",
    });
  }
  if (play.earnings_risk === "imminent") {
    badges.push({
      label: `E${play.dte_to_earnings ?? "?"}d`,
      cls: "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40",
      title: "Earnings within 7 days",
    });
  } else if (play.earnings_risk === "near") {
    badges.push({
      label: `E${play.dte_to_earnings ?? "?"}d`,
      cls: "bg-amber-500/15 text-amber-300",
      title: "Earnings within 21 days",
    });
  }
  if (play.whale_flag && play.whale_top_strike_prem) {
    badges.push({
      label: `🐋 ${fmtK(play.whale_top_strike_prem)} @ $${play.whale_top_strike}`,
      cls: "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40",
      title: "Whale-flagged single-strike accumulation",
    });
  }
  if (play.pattern) {
    badges.push({
      label: play.pattern.replace(/_/g, " "),
      cls: "bg-sky-500/15 text-sky-300",
      title: `Pattern score ${(play.pattern_score ?? 0).toFixed(2)}`,
    });
  }
  if (play.squeeze_flag) {
    badges.push({
      label: "🔥 squeeze",
      cls: "bg-orange-500/15 text-orange-300",
      title: "Short squeeze profile",
    });
  }
  if (play.insider_cluster_flag) {
    badges.push({
      label: "👥 insider",
      cls: "bg-emerald-500/15 text-emerald-300",
      title: "3+ insider buys in 30d",
    });
  }
  if (play.analyst_skew && play.analyst_skew !== "unknown") {
    badges.push({
      label: `A ${play.analyst_pt_vs_spot_pct != null ? fmtPct(play.analyst_pt_vs_spot_pct, 0, true) : play.analyst_skew}`,
      cls:
        play.analyst_skew === "bull"
          ? "bg-emerald-500/10 text-emerald-300"
          : play.analyst_skew === "bear"
          ? "bg-rose-500/10 text-rose-300"
          : "bg-foreground/10 text-muted-foreground",
      title: `Analyst skew ${play.analyst_skew}`,
    });
  }
  if (play.fund_quality && play.fund_quality !== "unknown") {
    badges.push({
      label: `F:${play.fund_quality}`,
      cls:
        play.fund_quality === "high"
          ? "bg-emerald-500/15 text-emerald-300"
          : play.fund_quality === "low"
          ? "bg-rose-500/15 text-rose-300"
          : "bg-foreground/10 text-muted-foreground",
      title: "Fundamentals quality",
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {badges.map((b, i) => (
        <span
          key={i}
          title={b.title}
          className={cn(
            "inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tabular-nums",
            b.cls,
          )}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function PlayCard({ play }: { play: TalonV2TopPlay }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold">{play.ticker}</span>
            <span className="text-xs text-muted-foreground">{play.theme}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              ${play.current_price}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                (play.grade ?? 0) >= 80
                  ? "bg-emerald-500/15 text-emerald-300"
                  : (play.grade ?? 0) >= 70
                  ? "bg-primary/15 text-primary"
                  : "bg-foreground/10 text-muted-foreground",
              )}
            >
              {(play.grade ?? 0).toFixed(0)}
              {play.ma_gate_adjust ? (
                <span
                  className={cn(
                    "ml-1 text-[9px]",
                    play.ma_gate_adjust > 0 ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  ({play.ma_gate_adjust > 0 ? "+" : ""}
                  {play.ma_gate_adjust})
                </span>
              ) : null}
            </span>
          </div>
          <SignalBadges play={play} />
        </div>

        {/* Levels */}
        <div className="grid grid-cols-3 gap-2 rounded-md bg-foreground/[0.02] p-2 text-[11px] tabular-nums">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Soft invalidation
            </p>
            <p className="font-semibold">${play.soft_inval ?? "—"}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
              ST target
            </p>
            <p className="font-semibold text-primary">${play.st_target ?? "—"}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Swing targets
            </p>
            <p className="font-semibold">
              {play.swing_targets.length
                ? play.swing_targets.map((s) => `$${s}`).join(" · ")
                : "—"}
            </p>
          </div>
        </div>

        {/* Row warnings */}
        {play.row_warnings.length > 0 && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[10px] text-rose-300">
            ⚠ {play.row_warnings.join(" · ")}
          </div>
        )}

        {/* 3-tier picks */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {play.picks.map((p) => (
            <PickCard key={p.tier} pick={p} currentPrice={play.current_price} />
          ))}
        </div>

        {/* Footer — backed count */}
        <p className="text-[10px] text-muted-foreground">
          {play.n_picks_backed} of {play.picks.length} tiers backed by recent UW flow ·
          v1 grade {play.grade_v1?.toFixed(0) ?? play.grade?.toFixed(0) ?? "?"}
          {play.ma_gate_adjust ? ` · MA gate ${play.ma_gate_adjust > 0 ? "+" : ""}${play.ma_gate_adjust}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export function TalonV2TopPlaysView() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["talon-v2-top-plays"],
    queryFn: () =>
      api.talonV2TopPlays(false).catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 422)) return null;
        throw e;
      }),
    staleTime: 60_000,
  });

  const recompute = useMutation({
    mutationFn: () => api.talonV2TopPlays(true),
    onSuccess: (fresh) => qc.setQueryData(["talon-v2-top-plays"], fresh),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Top 20 Plays — v2</h1>
          <p className="text-xs text-muted-foreground">
            Contracts anchored to whale concentration + earnings guardrails + MA-structure-aware tier sizing.
            <br />Defensive ITM · Standard ATM (whale-anchored) · Aggressive OTM (suppressed if structure broken).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="h-9 rounded-full border border-primary/40 bg-primary/10 px-4 text-sm text-primary hover:border-primary disabled:opacity-50"
          >
            {recompute.isPending ? "Recomputing…" : "Force refresh"}
          </button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-rose-400">
            Failed to load v2 top plays: {String(error)}
          </CardContent>
        </Card>
      )}

      {!data && !isLoading && !error && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="text-foreground">No v2 top plays yet.</p>
            <p>
              Run a v2 scan first (Scanner tab → Run scan), then come back here. First load
              after a scan computes the picks (~30-60s).
            </p>
          </CardContent>
        </Card>
      )}

      {data?.top_plays && data.top_plays.length > 0 && (
        <div className="space-y-3">
          {data.top_plays.map((p) => (
            <PlayCard key={p.ticker} play={p} />
          ))}
        </div>
      )}
    </div>
  );
}

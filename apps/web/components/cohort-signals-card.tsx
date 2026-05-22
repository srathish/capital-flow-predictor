"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CohortSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Window matches the Cohorts tab default so a stretched pair surfaced there
// and a dossier visit a few seconds later show the same z. If the tab toggle
// becomes a user preference, this should mirror it.
const DEFAULT_WINDOW_DAYS = 60;

function fmtEarn(offset: number | null) {
  if (offset === null) return null;
  if (offset === 0) return "ER today";
  if (offset > 0) return `ER in ${offset}d`;
  return `Reported ${Math.abs(offset)}d ago`;
}

export function CohortSignalsCard({ ticker }: { ticker: string }) {
  const upper = ticker.toUpperCase();
  const { data, isLoading, error } = useQuery({
    queryKey: ["cohorts-by-ticker", upper, DEFAULT_WINDOW_DAYS],
    queryFn: () => api.cohortsByTicker(upper, DEFAULT_WINDOW_DAYS),
    retry: false,
  });

  // Stay quiet when there's nothing to say — the dossier already has plenty
  // of cards, no need to add a "no cohort data" placeholder for tickers we
  // don't classify (most names).
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-3">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data || data.cohorts.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Cohort signals
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            Sub-industry peers of {upper} and where the spread sits vs its own history. Decision-grade
            = stretched (|z| ≥ 1.5) AND cointegrated.
          </div>
        </div>
        <div className="space-y-2">
          {data.cohorts.map((c) => (
            <CohortRow key={c.key} ticker={upper} cohort={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CohortRow({ ticker, cohort }: { ticker: string; cohort: CohortSummary }) {
  const role =
    cohort.leader === ticker ? "leader" : cohort.laggard === ticker ? "laggard" : "member";
  const stretched = cohort.max_abs_z !== null && cohort.max_abs_z >= 1.5;
  const decisionGrade = stretched && cohort.max_abs_z_coint === true;
  const earningsOffset =
    role === "leader"
      ? cohort.leader_earnings_offset_days
      : role === "laggard"
        ? cohort.laggard_earnings_offset_days
        : null;
  const earnText = fmtEarn(earningsOffset);

  return (
    <div
      className={cn(
        "rounded border border-border p-2 text-xs",
        decisionGrade && "border-signal-bearish/40 bg-signal-bearish/5"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{cohort.label}</span>
          <RoleBadge role={role} />
        </div>
        <div className="flex items-baseline gap-2 num">
          <span className="text-[10px] uppercase text-muted-foreground">top pair</span>
          <span>
            {cohort.max_abs_z_pair
              ? `${cohort.max_abs_z_pair[0]} / ${cohort.max_abs_z_pair[1]}`
              : "—"}
          </span>
          <span className={cn(stretched && "font-semibold")}>
            |z| {cohort.max_abs_z !== null ? cohort.max_abs_z.toFixed(2) : "—"}
          </span>
          {cohort.max_abs_z_coint === true ? (
            <span className="rounded border border-signal-bullish/40 px-1 text-[9px] uppercase text-signal-bullish">
              coint
            </span>
          ) : cohort.max_abs_z_coint === false ? (
            <span
              className="rounded border border-border px-1 text-[9px] uppercase text-muted-foreground"
              title="Spread isn't cointegrated — |z| may be noise"
            >
              no coint
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{cohort.members.join(" · ")}</span>
        {earnText && (
          <span
            className={cn(
              "rounded border px-1 text-[10px] uppercase tracking-wide",
              earningsOffset !== null && earningsOffset >= 0
                ? "border-amber-500/40 text-amber-400"
                : "border-sky-500/40 text-sky-400"
            )}
            title={
              earningsOffset !== null && earningsOffset >= 0
                ? "Upcoming earnings — catalyst risk AND potential catch-up trigger"
                : "Recently reported — lag may be fundamental"
            }
          >
            {earnText}
          </span>
        )}
        <Link
          href={`/`}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Open Cohorts tab"
        >
          Cohorts ↗
        </Link>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: "leader" | "laggard" | "member" }) {
  if (role === "leader") {
    return (
      <span className="rounded border border-signal-bullish/40 px-1 text-[9px] uppercase tracking-wide text-signal-bullish">
        leader
      </span>
    );
  }
  if (role === "laggard") {
    return (
      <span className="rounded border border-signal-bearish/40 px-1 text-[9px] uppercase tracking-wide text-signal-bearish">
        laggard
      </span>
    );
  }
  return (
    <span className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
      member
    </span>
  );
}

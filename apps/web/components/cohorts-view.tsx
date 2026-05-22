"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { CohortDetail, CohortSummary } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Curated set of windows that match how a discretionary trader would think
// about a pair: ~3 weeks, ~3 months, ~half a year.
const WINDOW_OPTIONS = [
  { value: 20, label: "20D" },
  { value: 60, label: "60D" },
  { value: 120, label: "120D" },
] as const;

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const fmtZ = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

function EarningsBadge({ offsetDays }: { offsetDays: number | null }) {
  // Earnings annotation only — never a suppression. Pre-earnings can be the
  // catalyst that triggers a laggard catch-up; post-earnings means the lag
  // was fundamentally confirmed. Label both clearly so the operator decides.
  if (offsetDays === null) return null;
  const label = offsetDays === 0 ? "ER TODAY" : offsetDays > 0 ? `ER T-${offsetDays}` : `ER ${offsetDays}d`;
  const tone = offsetDays >= 0 ? "border-amber-500/40 text-amber-400" : "border-sky-500/40 text-sky-400";
  const title = offsetDays >= 0
    ? `Reports in ${offsetDays} day(s) — catalyst risk AND potential catch-up trigger`
    : `Reported ${Math.abs(offsetDays)} day(s) ago — lag may be fundamental`;
  return (
    <span
      title={title}
      className={cn("ml-1 rounded border px-1 text-[9px] uppercase tracking-wide", tone)}
    >
      {label}
    </span>
  );
}

function CointBadge({
  five,
  ten,
}: {
  five: boolean | null | undefined;
  ten: boolean | null | undefined;
}) {
  // null = not enough data; false/false = no evidence of cointegration;
  // 10pct only = weak; 5pct = strong. A non-cointegrated stretched pair is
  // mostly noise — the spread doesn't actually mean-revert.
  if (five) {
    return (
      <span
        title="Engle-Granger cointegrated at 5% — spread reliably mean-reverts"
        className="rounded border border-signal-bullish/40 px-1 text-[9px] uppercase tracking-wide text-signal-bullish"
      >
        COINT
      </span>
    );
  }
  if (ten) {
    return (
      <span
        title="Engle-Granger cointegrated at 10% — weaker mean-reversion evidence"
        className="rounded border border-amber-500/40 px-1 text-[9px] uppercase tracking-wide text-amber-400"
      >
        COINT 10%
      </span>
    );
  }
  if (five === false && ten === false) {
    return (
      <span
        title="Not cointegrated — spread doesn't reliably mean-revert; treat |z| as noise"
        className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
      >
        NO COINT
      </span>
    );
  }
  return null;
}

export function CohortsView() {
  const [windowDays, setWindowDays] = useState<number>(60);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cohorts", windowDays],
    queryFn: () => api.cohorts(windowDays),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Cohort dispersion</h2>
          <p className="text-xs text-muted-foreground">
            Sub-industry groups ranked by their most-stretched pair spread (|z|). High |z| means the
            spread between two members is unusual vs its own history — convergence candidates if the
            divergence isn&apos;t fundamental.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-[11px]">
          {WINDOW_OPTIONS.map((w) => {
            const active = windowDays === w.value;
            return (
              <button
                key={w.value}
                type="button"
                onClick={() => setWindowDays(w.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Cohort data isn&apos;t available right now.
          </CardContent>
        </Card>
      )}
      {data && data.cohorts.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No cohorts defined.
          </CardContent>
        </Card>
      )}
      {data &&
        data.cohorts.map((c) => (
          <CohortRow
            key={c.key}
            cohort={c}
            windowDays={windowDays}
            open={openKey === c.key}
            onToggle={() => setOpenKey((k) => (k === c.key ? null : c.key))}
          />
        ))}
    </div>
  );
}

function CohortRow({
  cohort,
  windowDays,
  open,
  onToggle,
}: {
  cohort: CohortSummary;
  windowDays: number;
  open: boolean;
  onToggle: () => void;
}) {
  // |z| ≥ 1.5 is the threshold we visually flag — same convention as the
  // sector laggards panel so the eye learns one rule across the funnel.
  const flagged = cohort.max_abs_z !== null && cohort.max_abs_z >= 1.5;
  return (
    <Card className={cn(flagged && "border-signal-bearish/40")}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="grid w-full grid-cols-[1fr_auto_auto_auto] items-baseline gap-4 px-4 py-3 text-left hover:bg-muted/30"
        >
          <div>
            <div className="text-sm font-semibold">{cohort.label}</div>
            <div className="text-[11px] text-muted-foreground">{cohort.description}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {cohort.members.join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Top pair
            </div>
            <div className="flex items-baseline justify-end gap-1 text-xs num">
              {cohort.max_abs_z_pair
                ? `${cohort.max_abs_z_pair[0]} / ${cohort.max_abs_z_pair[1]}`
                : "—"}
              <CointBadge five={cohort.max_abs_z_coint} ten={null} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">|z|</div>
            <div className={cn("text-sm font-semibold num", flagged && "text-signal-bearish")}>
              {cohort.max_abs_z !== null ? cohort.max_abs_z.toFixed(2) : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Leader / Laggard
            </div>
            <div className="flex items-baseline justify-end gap-1 text-xs num">
              <span className="text-signal-bullish">
                {cohort.leader ?? "—"}
                <EarningsBadge offsetDays={cohort.leader_earnings_offset_days} />
              </span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-signal-bearish">
                {cohort.laggard ?? "—"}
                <EarningsBadge offsetDays={cohort.laggard_earnings_offset_days} />
              </span>
            </div>
          </div>
        </button>
        {open && <CohortDetailPanel cohortKey={cohort.key} windowDays={windowDays} />}
      </CardContent>
    </Card>
  );
}

function CohortDetailPanel({
  cohortKey,
  windowDays,
}: {
  cohortKey: string;
  windowDays: number;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cohort-detail", cohortKey, windowDays],
    queryFn: () => api.cohortDetail(cohortKey, windowDays),
    retry: false,
  });
  if (isLoading) return <div className="border-t border-border p-4"><Skeleton className="h-32 w-full" /></div>;
  if (error || !data) {
    return (
      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        Detail unavailable.
      </div>
    );
  }
  return <CohortDetailContent detail={data} />;
}

function CohortDetailContent({ detail }: { detail: CohortDetail }) {
  return (
    <div className="border-t border-border bg-muted/10 p-4">
      <div className="mb-3 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>
          {detail.window_days}D window · {detail.pairs.length} pairs ·{" "}
          {detail.last_close_ts ? `last close ${formatDate(detail.last_close_ts)}` : "no closes"}
        </span>
      </div>

      {/* Per-member positioning */}
      <div className="mb-4">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Members</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {detail.members.map((m) => (
            <Link
              key={m.ticker}
              href={`/agents/${encodeURIComponent(m.ticker)}`}
              className={cn(
                "flex items-baseline justify-between rounded px-2 py-1 text-xs hover:bg-muted/40",
                m.is_leader && "bg-signal-bullish/5",
                m.is_laggard && "bg-signal-bearish/5"
              )}
            >
              <span className="flex items-baseline gap-2 font-medium">
                {m.ticker}
                {m.is_leader && (
                  <span className="text-[9px] uppercase text-signal-bullish">leader</span>
                )}
                {m.is_laggard && (
                  <span className="text-[9px] uppercase text-signal-bearish">laggard</span>
                )}
                <EarningsBadge offsetDays={m.earnings_offset_days} />
              </span>
              <span className="flex items-baseline gap-3 num">
                <span
                  className={cn(
                    m.ret_window !== null && m.ret_window > 0 && "text-signal-bullish",
                    m.ret_window !== null && m.ret_window < 0 && "text-signal-bearish"
                  )}
                >
                  {fmtPct(m.ret_window)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Δ med {fmtPct(m.rel_vs_median)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Pair table */}
      {detail.pairs.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Pairs · sorted by |z|
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Pair</th>
                  <th className="px-2 py-1 text-left">Coint</th>
                  <th className="px-2 py-1 text-right">n</th>
                  <th className="px-2 py-1 text-right">z</th>
                  <th className="px-2 py-1 text-right">Pctile</th>
                  <th className="px-2 py-1 text-right">ADF t</th>
                  <th className="px-2 py-1 text-right">β</th>
                </tr>
              </thead>
              <tbody>
                {detail.pairs.map((p) => {
                  // Decision-quality = stretched AND cointegrated. Highlight
                  // only when both conditions hold; a flagged-but-not-coint pair
                  // is just noise dressed up as a signal.
                  const stretched = Math.abs(p.z) >= 1.5;
                  const decisionGrade = stretched && p.coint_5pct === true;
                  return (
                    <tr
                      key={`${p.leg_a}-${p.leg_b}`}
                      className={cn(
                        "border-b border-border/40 last:border-0",
                        decisionGrade && "bg-signal-bearish/5"
                      )}
                    >
                      <td className="px-2 py-1 font-medium">
                        {p.leg_a} / {p.leg_b}
                      </td>
                      <td className="px-2 py-1">
                        <CointBadge five={p.coint_5pct} ten={p.coint_10pct} />
                      </td>
                      <td className="px-2 py-1 text-right num text-muted-foreground">{p.n_obs}</td>
                      <td className={cn("px-2 py-1 text-right num", stretched && "font-semibold")}>
                        {fmtZ(p.z)}
                      </td>
                      <td className="px-2 py-1 text-right num text-muted-foreground">
                        {p.pctile === null ? "—" : `${(p.pctile * 100).toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-1 text-right num text-muted-foreground">
                        {p.eg_adf_t === null ? "—" : p.eg_adf_t.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right num text-muted-foreground">
                        {p.eg_beta === null ? "—" : p.eg_beta.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

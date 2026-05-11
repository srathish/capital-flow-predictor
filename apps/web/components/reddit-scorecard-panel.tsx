"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  RedditScorecardCalibrationBucket,
  RedditSubredditEdge,
  RedditAuthorEdge,
} from "@/lib/types";
import { cn, formatDate, formatNum } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Production scorecard for the Reddit predictor + the catalyst feed.
// Shows: hit rate, mean error, calibration ladder, best/worst calls, and
// per-subreddit / per-author predictive edge. Empty/calibrating until
// enough predictions have matured (~28 calendar days per anchor).

function pctClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground";
  if (v > 0) return "text-signal-bullish";
  if (v < 0) return "text-signal-bearish";
  return "text-muted-foreground";
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtRate(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

export function RedditScorecardPanel({ windowDays = 90 }: { windowDays?: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reddit-scorecard", windowDays],
    queryFn: () => api.redditScorecard({ windowDays }),
    retry: false,
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-signal-bearish">
          {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const calibrating = data.status === "calibrating";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <CardTitle className="text-base">Reddit predictor scorecard</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Past {data.window_days}d · model {data.model_version ?? "—"} · {data.n_matured} matured
              {" "}prediction{data.n_matured === 1 ? "" : "s"} (each needs ~28d to score)
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              calibrating ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
            )}
            title={
              calibrating
                ? "Not enough predictions have matured yet (each needs ~28 calendar days)."
                : "Live scorekeeping — every prediction this old has been compared to the actual 20d return."
            }
          >
            {calibrating ? "calibrating" : "live"}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Top-line accuracy */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Hit rate" value={fmtRate(data.hit_rate)} tip="Fraction of predictions whose sign matched the realized 20d return" />
          <StatTile label="Bull hit rate" value={fmtRate(data.bullish_hit_rate)} tip="Accuracy when the model said up" />
          <StatTile label="Bear hit rate" value={fmtRate(data.bearish_hit_rate)} tip="Accuracy when the model said down" />
          <StatTile label="Mean realized" value={fmtPct(data.mean_realized_pct)} cls={pctClass(data.mean_realized_pct)} tip="Average actual 20d return across all matured predictions in the window" />
          <StatTile label="Mean error" value={fmtPct(data.mean_abs_error_pct)} tip="Average |predicted − realized| in percentage points" />
        </div>

        {/* Calibration ladder */}
        {data.calibration.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              calibration — does a higher score actually mean a bigger return?
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left">Score band</th>
                    <th className="px-2 py-1 text-right">n</th>
                    <th className="px-2 py-1 text-right">Mean predicted</th>
                    <th className="px-2 py-1 text-right">Mean realized</th>
                    <th className="px-2 py-1 text-right">Hit rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calibration.map((b: RedditScorecardCalibrationBucket) => (
                    <tr key={b.score_bucket} className="border-b border-border/40">
                      <td className="px-2 py-1 font-medium">{b.score_bucket}</td>
                      <td className="px-2 py-1 text-right">{b.n}</td>
                      <td className={cn("px-2 py-1 text-right num", pctClass(b.mean_predicted_pct))}>
                        {fmtPct(b.mean_predicted_pct)}
                      </td>
                      <td className={cn("px-2 py-1 text-right num", pctClass(b.mean_realized_pct))}>
                        {fmtPct(b.mean_realized_pct)}
                      </td>
                      <td className="px-2 py-1 text-right num">{fmtRate(b.hit_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top hits / misses */}
        <div className="grid gap-4 md:grid-cols-2">
          <CallList title="Best calls (sign-correct, biggest move)" calls={data.top_hits} kind="hit" />
          <CallList title="Worst calls (wrong sign, biggest miss)" calls={data.top_misses} kind="miss" />
        </div>

        {/* Subreddit edges */}
        {data.subreddit_edges.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              subreddits by realized 20d edge — which feeds actually predicted moves
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left">Subreddit</th>
                    <th className="px-2 py-1 text-right">Posts matured</th>
                    <th className="px-2 py-1 text-right">Mean 20d</th>
                    <th className="px-2 py-1 text-right">Up rate</th>
                    <th className="px-2 py-1 text-right">Mean 5d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subreddit_edges.slice(0, 10).map((s: RedditSubredditEdge) => (
                    <tr key={s.subreddit} className="border-b border-border/40">
                      <td className="px-2 py-1 font-medium">r/{s.subreddit}</td>
                      <td className="px-2 py-1 text-right">{s.n_matured}</td>
                      <td className={cn("px-2 py-1 text-right num", pctClass(s.mean_realized_20d_pct))}>
                        {fmtPct(s.mean_realized_20d_pct)}
                      </td>
                      <td className="px-2 py-1 text-right num">{fmtRate(s.hit_rate_up)}</td>
                      <td className={cn("px-2 py-1 text-right num", pctClass(s.mean_realized_5d_pct))}>
                        {fmtPct(s.mean_realized_5d_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Author edges */}
        {data.author_edges.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              top authors by realized 20d edge (≥3 matured posts)
            </div>
            <div className="grid gap-1 md:grid-cols-2">
              {data.author_edges.slice(0, 10).map((a: RedditAuthorEdge) => (
                <div
                  key={a.author}
                  className="flex items-center justify-between rounded border border-border/60 bg-card/40 px-2 py-1 text-xs"
                >
                  <span className="truncate font-medium">
                    u/{a.author}
                    {a.subreddit && (
                      <span className="ml-1 text-muted-foreground">· r/{a.subreddit}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{a.n_matured}p</span>
                    <span className={cn("num font-semibold", pctClass(a.mean_realized_20d_pct))}>
                      {fmtPct(a.mean_realized_20d_pct)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {calibrating && data.subreddit_edges.length === 0 && data.author_edges.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing has matured yet — predictions need ~28 calendar days before they can be scored.
            Run{" "}
            <code className="rounded bg-muted px-1">cfp-jobs reddit-backfill-outcomes</code>{" "}
            nightly to fill realized returns.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  cls,
  tip,
}: {
  label: string;
  value: string;
  cls?: string;
  tip?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2" title={tip}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("num text-base font-semibold", cls ?? "text-foreground")}>{value}</div>
    </div>
  );
}

function CallList({
  title,
  calls,
  kind,
}: {
  title: string;
  calls: { snapshot_date: string; ticker: string; predicted_pct: number; realized_pct: number; pred_score: number | null; error_pct: number }[];
  kind: "hit" | "miss";
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {calls.length === 0 ? (
        <p className="text-xs text-muted-foreground">No matured calls yet.</p>
      ) : (
        <ul className="space-y-1">
          {calls.map((c) => (
            <li
              key={`${c.snapshot_date}-${c.ticker}`}
              className="flex items-center justify-between rounded border border-border/60 bg-card/40 px-2 py-1 text-xs"
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold">{c.ticker}</span>
                <span className="text-muted-foreground">{formatDate(c.snapshot_date)}</span>
              </span>
              <span className="flex items-center gap-3 num">
                <span className="text-muted-foreground" title="predicted 20d">
                  pred {fmtPct(c.predicted_pct, 1)}
                </span>
                <span className={pctClass(c.realized_pct)} title="actual 20d">
                  real {fmtPct(c.realized_pct, 1)}
                </span>
                {kind === "miss" && (
                  <span
                    className={pctClass(-Math.abs(c.error_pct))}
                    title="realized − predicted"
                  >
                    Δ {formatNum(c.error_pct, 1)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

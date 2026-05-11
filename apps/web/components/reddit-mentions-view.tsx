"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  RedditAudienceSkew,
  RedditMentionRow,
  RedditMentionsSort,
  RedditPredictiveSignal,
  RedditRuleId,
  RedditRuleStats,
} from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { RedditTickerDrawer } from "@/components/reddit-ticker-drawer";

const SORT_OPTIONS: { value: RedditMentionsSort; label: string }[] = [
  { value: "predicted", label: "Best predicted edge" },
  { value: "mentions", label: "Most mentions" },
  { value: "spike", label: "Biggest spike" },
  { value: "rank_change", label: "Climbing fastest" },
  { value: "momentum", label: "Strongest momentum" },
];

const SIGNAL_STYLE: Record<RedditPredictiveSignal, { label: string; cls: string }> = {
  buy: { label: "BUY", cls: "bg-signal-bullish/15 text-signal-bullish" },
  fade: { label: "FADE", cls: "bg-signal-bearish/15 text-signal-bearish" },
  watch: { label: "WATCH", cls: "bg-primary/15 text-primary" },
  neutral: { label: "—", cls: "bg-muted text-muted-foreground" },
};

const RULE_LABEL: Record<RedditRuleId, string> = {
  contrarian_top: "crowded top",
  stealth_setup: "stealth",
  first_time_bull: "first-time bull",
  wsb_only_hype: "wsb-only",
  investing_accumulation: "quality accum",
  fading_hype: "fading",
  price_confirming_spike: "price confirms",
};

const SKEW_COLOR: Record<RedditAudienceSkew, string> = {
  wsb: "bg-signal-bearish/15 text-signal-bearish",
  investing: "bg-signal-bullish/15 text-signal-bullish",
  mixed: "bg-primary/15 text-primary",
  unknown: "bg-muted text-muted-foreground",
};

const SKEW_LABEL: Record<RedditAudienceSkew, string> = {
  wsb: "WSB",
  investing: "investing",
  mixed: "mixed",
  unknown: "—",
};

function freshnessTone(hours: number | null): {
  text: string;
  tone: "fresh" | "ok" | "stale";
} {
  if (hours === null) return { text: "snapshot age unknown", tone: "stale" };
  if (hours < 12) return { text: `${hours.toFixed(0)}h fresh`, tone: "fresh" };
  if (hours < 36) return { text: `${hours.toFixed(0)}h old`, tone: "ok" };
  return { text: `${(hours / 24).toFixed(1)}d stale`, tone: "stale" };
}

function normalizeSparkline(values: number[], mode: "raw" | "z"): number[] {
  if (mode === "raw" || values.length < 2) return values;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

export function RedditMentionsView() {
  const [sort, setSort] = useState<RedditMentionsSort>("predicted");
  const [q, setQ] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [excludeMeme, setExcludeMeme] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sparkMode, setSparkMode] = useState<"raw" | "z">("raw");
  const [selected, setSelected] = useState<RedditMentionRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reddit-mentions", sort, q, sectorFilter, excludeMeme, watchlistOnly],
    queryFn: () =>
      api.redditMentions({
        sort,
        limit: 80,
        q: q.trim().toUpperCase() || undefined,
        sector: sectorFilter || undefined,
        excludeMeme,
        watchlist: watchlistOnly,
      }),
    retry: false,
  });

  // Lazy-load backtest stats (cheap, runs once).
  const { data: backtest } = useQuery({
    queryKey: ["reddit-backtest"],
    queryFn: () => api.redditBacktest(),
    retry: false,
    staleTime: 1000 * 60 * 30,
  });

  // Rule win-rate stats — drives the confidence dots + the "rule edge" panel.
  const { data: rules } = useQuery({
    queryKey: ["reddit-rules"],
    queryFn: () => api.redditRules(),
    retry: false,
    staleTime: 1000 * 60 * 30,
  });
  const rulesById = useMemo<Record<RedditRuleId, RedditRuleStats | undefined>>(
    () => {
      const acc: Record<string, RedditRuleStats | undefined> = {};
      for (const r of rules ?? []) acc[r.rule_id] = r;
      return acc as Record<RedditRuleId, RedditRuleStats | undefined>;
    },
    [rules],
  );

  const sectors = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.rows) if (r.sector) s.add(r.sector);
    return Array.from(s).sort();
  }, [data]);

  const fresh = freshnessTone(data?.snapshot_age_hours ?? null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Reddit chatter</h1>
          <p className="text-sm text-muted-foreground">
            Predicted 20-day edge from retail chatter — composite score, pattern rules, and
            backtested win rates. Sort by predicted edge to see the best setups first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              fresh.tone === "fresh" && "bg-signal-bullish/15 text-signal-bullish",
              fresh.tone === "ok" && "bg-muted text-muted-foreground",
              fresh.tone === "stale" && "bg-signal-bearish/15 text-signal-bearish",
            )}
          >
            {fresh.text}
            {data?.snapshot_date && <> · {formatDate(data.snapshot_date)}</>}
          </span>
        </div>
      </div>

      {/* sort + filter row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition-colors",
              sort === opt.value
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="mx-2 h-5 border-l border-border" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ticker (e.g. NVDA)"
          className="h-8 w-36 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          className="h-8 rounded-full border border-border bg-card px-3 text-xs outline-none focus:border-primary/60"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={excludeMeme}
            onChange={(e) => setExcludeMeme(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>exclude meme floor</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={watchlistOnly}
            onChange={(e) => setWatchlistOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>watchlist only</span>
        </label>
        <span className="mx-2 h-5 border-l border-border" />
        <button
          onClick={() => setSparkMode(sparkMode === "raw" ? "z" : "raw")}
          className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          title="Toggle sparkline normalization"
        >
          spark: {sparkMode === "raw" ? "raw" : "z-score"}
        </button>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-signal-bearish/15 px-1.5 py-0.5 font-semibold text-signal-bearish">⚠ contrarian</span>
          <span className="opacity-70">3x+ spike, top 20</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">🔍 stealth</span>
          <span className="opacity-70">low chatter, off the radar</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-signal-bullish/15 px-1.5 py-0.5 font-semibold text-signal-bullish">★ new</span>
          <span className="opacity-70">first appearance in 30d</span>
        </span>
      </div>

      {isLoading && <Skeleton className="h-96 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No Reddit data for these filters. Run{" "}
            <code className="rounded bg-muted px-1">cfp-jobs reddit</code> to snapshot today's
            Apewisdom rankings, or relax the filter set.
          </CardContent>
        </Card>
      )}

      {/* desktop table */}
      {data && data.rows.length > 0 && (
        <Card className="hidden md:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Signal</th>
                    <th className="px-3 py-2 text-right">Pred 20d</th>
                    <th className="px-3 py-2 text-left">Conf</th>
                    <th className="px-3 py-2 text-left">Rules</th>
                    <th className="px-3 py-2 text-right">Mentions</th>
                    <th className="px-3 py-2 text-right">Spike</th>
                    <th className="px-3 py-2 text-right">Rank</th>
                    <th className="px-3 py-2 text-right">Δ rank</th>
                    <th className="px-3 py-2 text-left">7d trend</th>
                    <th className="px-3 py-2 text-left">Sentiment</th>
                    <th className="px-3 py-2 text-right">Δ 1d</th>
                    <th className="px-3 py-2 text-right">Δ 5d</th>
                    <th className="px-3 py-2 text-left">Audience</th>
                    <th className="px-3 py-2 text-right">6h</th>
                    <th className="px-3 py-2 text-right">Posts</th>
                    <th className="px-3 py-2 text-left">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr
                      key={r.ticker}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer border-b border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold">{r.ticker}</div>
                        {r.name && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {r.name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <SignalBadge signal={r.pred_signal} score={r.pred_score} />
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right font-semibold",
                          r.pred_return_20d_pct > 0 && "text-signal-bullish",
                          r.pred_return_20d_pct < 0 && "text-signal-bearish",
                        )}
                      >
                        {r.pred_return_20d_pct >= 0 ? "+" : ""}
                        {r.pred_return_20d_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceDots value={r.pred_confidence} />
                      </td>
                      <td className="px-3 py-2">
                        <RuleChips rules={r.matched_rules} stats={rulesById} />
                      </td>
                      <td className="num px-3 py-2 text-right">
                        <div>{r.mentions_today}</div>
                        <div className="text-[10px] text-muted-foreground">
                          avg {r.mentions_7d_avg.toFixed(0)}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.spike_ratio !== null && r.spike_ratio > 1.5 && "text-signal-bullish",
                          r.spike_ratio !== null && r.spike_ratio < 0.5 && "text-signal-bearish",
                        )}
                      >
                        {r.spike_ratio !== null ? `${r.spike_ratio.toFixed(1)}x` : "—"}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        <div>{r.rank_today !== null ? `#${r.rank_today}` : "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          top20 {r.days_in_top20_14d}/14
                        </div>
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.rank_change_7d !== null && r.rank_change_7d < 0 && "text-signal-bullish",
                          r.rank_change_7d !== null && r.rank_change_7d > 0 && "text-signal-bearish",
                        )}
                      >
                        {r.rank_change_7d !== null
                          ? r.rank_change_7d > 0
                            ? `▼${r.rank_change_7d}`
                            : r.rank_change_7d < 0
                              ? `▲${Math.abs(r.rank_change_7d)}`
                              : "—"
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.sparkline_7d.length > 1 ? (
                          <Sparkline
                            values={normalizeSparkline(r.sparkline_7d, sparkMode)}
                            width={80}
                            height={22}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">need 2d</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <SentimentBar
                          bull={r.n_bullish_kw}
                          bear={r.n_bearish_kw}
                          share={r.sentiment_bull_share}
                        />
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.price_change_1d !== null && r.price_change_1d > 0 && "text-signal-bullish",
                          r.price_change_1d !== null && r.price_change_1d < 0 && "text-signal-bearish",
                        )}
                      >
                        {r.price_change_1d !== null
                          ? `${r.price_change_1d >= 0 ? "+" : ""}${r.price_change_1d.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "num px-3 py-2 text-right",
                          r.price_change_5d !== null && r.price_change_5d > 0 && "text-signal-bullish",
                          r.price_change_5d !== null && r.price_change_5d < 0 && "text-signal-bearish",
                        )}
                      >
                        {r.price_change_5d !== null
                          ? `${r.price_change_5d >= 0 ? "+" : ""}${r.price_change_5d.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            SKEW_COLOR[r.audience_skew],
                          )}
                        >
                          {SKEW_LABEL[r.audience_skew]}
                        </span>
                      </td>
                      <td className="num px-3 py-2 text-right text-[11px] text-muted-foreground">
                        {r.mentions_last_6h > 0 ? r.mentions_last_6h : "—"}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        {r.catalyst_post_count > 0 ? (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {r.catalyst_post_count}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.is_contrarian_warning && (
                            <span className="rounded-full bg-signal-bearish/15 px-2 py-0.5 text-[10px] font-semibold text-signal-bearish">
                              ⚠
                            </span>
                          )}
                          {r.is_stealth && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              🔍
                            </span>
                          )}
                          {r.is_first_time_entrant && (
                            <span className="rounded-full bg-signal-bullish/15 px-2 py-0.5 text-[10px] font-semibold text-signal-bullish">
                              ★
                            </span>
                          )}
                          {r.is_meme && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              meme
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* mobile cards */}
      {data && data.rows.length > 0 && (
        <div className="space-y-2 md:hidden">
          {data.rows.map((r) => (
            <Card
              key={r.ticker}
              onClick={() => setSelected(r)}
              className="cursor-pointer"
            >
              <CardContent className="p-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-semibold">{r.ticker}</div>
                      <SignalBadge signal={r.pred_signal} score={r.pred_score} />
                    </div>
                    {r.name && (
                      <div className="text-[10px] text-muted-foreground">{r.name}</div>
                    )}
                  </div>
                  <div className="num text-right text-sm">
                    <div
                      className={cn(
                        "font-semibold",
                        r.pred_return_20d_pct > 0 && "text-signal-bullish",
                        r.pred_return_20d_pct < 0 && "text-signal-bearish",
                      )}
                    >
                      {r.pred_return_20d_pct >= 0 ? "+" : ""}
                      {r.pred_return_20d_pct.toFixed(1)}% 20d
                    </div>
                    <ConfidenceDots value={r.pred_confidence} />
                  </div>
                </div>
                {r.matched_rules.length > 0 && (
                  <div className="mt-1">
                    <RuleChips rules={r.matched_rules} stats={rulesById} />
                  </div>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">rank</span>{" "}
                    {r.rank_today !== null ? `#${r.rank_today}` : "—"}
                  </div>
                  <div
                    className={cn(
                      r.price_change_1d !== null && r.price_change_1d > 0 && "text-signal-bullish",
                      r.price_change_1d !== null && r.price_change_1d < 0 && "text-signal-bearish",
                    )}
                  >
                    <span className="text-muted-foreground">1d</span>{" "}
                    {r.price_change_1d !== null
                      ? `${r.price_change_1d >= 0 ? "+" : ""}${r.price_change_1d.toFixed(1)}%`
                      : "—"}
                  </div>
                  <div
                    className={cn(
                      r.price_change_5d !== null && r.price_change_5d > 0 && "text-signal-bullish",
                      r.price_change_5d !== null && r.price_change_5d < 0 && "text-signal-bearish",
                    )}
                  >
                    <span className="text-muted-foreground">5d</span>{" "}
                    {r.price_change_5d !== null
                      ? `${r.price_change_5d >= 0 ? "+" : ""}${r.price_change_5d.toFixed(1)}%`
                      : "—"}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <SentimentBar
                    bull={r.n_bullish_kw}
                    bear={r.n_bearish_kw}
                    share={r.sentiment_bull_share}
                  />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      SKEW_COLOR[r.audience_skew],
                    )}
                  >
                    {SKEW_LABEL[r.audience_skew]}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.is_contrarian_warning && <Flag tone="bear">⚠ contrarian</Flag>}
                  {r.is_stealth && <Flag tone="primary">🔍 stealth</Flag>}
                  {r.is_first_time_entrant && <Flag tone="bull">★ new</Flag>}
                  {r.catalyst_post_count > 0 && (
                    <Flag tone="primary">{r.catalyst_post_count} posts</Flag>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* backtest blurb */}
      {backtest && backtest.length > 0 && (
        <Card>
          <CardContent className="p-4 text-xs">
            <div className="mb-1.5 font-semibold">
              Historical: did mention spikes lead price moves?
            </div>
            <div className="grid grid-cols-1 gap-2 text-muted-foreground sm:grid-cols-3">
              {backtest.map((b) => (
                <div key={b.spike_threshold} className="rounded-md border border-border p-2">
                  <div className="text-[11px] uppercase tracking-wide">
                    spike ≥ {b.spike_threshold.toFixed(1)}x
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-sm font-semibold",
                      b.mean_5d_return_pct !== null && b.mean_5d_return_pct > 0 && "text-signal-bullish",
                      b.mean_5d_return_pct !== null && b.mean_5d_return_pct < 0 && "text-signal-bearish",
                    )}
                  >
                    {b.mean_5d_return_pct !== null
                      ? `${b.mean_5d_return_pct >= 0 ? "+" : ""}${b.mean_5d_return_pct.toFixed(2)}%`
                      : "—"}{" "}
                    avg 5d
                  </div>
                  <div className="text-[11px]">
                    win {b.win_rate !== null ? `${(b.win_rate * 100).toFixed(0)}%` : "—"} ·
                    n={b.n_observations}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Click a row for the catalyst-post drawer (no agent run). Hit "Run agent ensemble" inside
        the drawer when you want the full work-up.
      </p>

      <RedditTickerDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SentimentBar({
  bull,
  bear,
  share,
}: {
  bull: number;
  bear: number;
  share: number | null;
}) {
  if (bull + bear === 0 || share === null) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="bg-signal-bullish" style={{ width: `${share * 100}%` }} />
        <div className="bg-signal-bearish" style={{ width: `${(1 - share) * 100}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {bull}/{bear}
      </span>
    </div>
  );
}

function SignalBadge({
  signal,
  score,
}: {
  signal: RedditPredictiveSignal;
  score: number;
}) {
  const s = SIGNAL_STYLE[signal];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
        s.cls,
      )}
      title={`composite score ${score.toFixed(1)}/100`}
    >
      {s.label}
      <span className="ml-1 opacity-70">{score.toFixed(0)}</span>
    </span>
  );
}

function ConfidenceDots({ value }: { value: number }) {
  // 4-dot scale, filled in by win-rate-distance-from-coin-flip.
  const filled = Math.round(_clip01(value) * 4);
  return (
    <div className="flex items-center gap-0.5" title={`confidence ${(value * 100).toFixed(0)}%`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < filled ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function _clip01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function RuleChips({
  rules,
  stats,
}: {
  rules: RedditRuleId[];
  stats: Record<RedditRuleId, RedditRuleStats | undefined>;
}) {
  if (rules.length === 0) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {rules.map((rid) => {
        const s = stats[rid];
        const wr = s?.win_rate ?? null;
        const n = s?.n_events ?? 0;
        const isBull = s?.expected_direction === "long";
        const cls = wr === null
          ? "bg-muted text-muted-foreground"
          : isBull
            ? "bg-signal-bullish/15 text-signal-bullish"
            : "bg-signal-bearish/15 text-signal-bearish";
        const tip = wr === null || n < 5
          ? `${s?.description ?? rid} (calibrating, n=${n})`
          : `${s?.description ?? rid} — win ${(wr * 100).toFixed(0)}% over n=${n}`;
        return (
          <span
            key={rid}
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              cls,
            )}
            title={tip}
          >
            {RULE_LABEL[rid]}
            {wr !== null && n >= 5 && (
              <span className="ml-1 opacity-70">{(wr * 100).toFixed(0)}%</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Flag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "bull" | "bear" | "primary";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "bull" && "bg-signal-bullish/15 text-signal-bullish",
        tone === "bear" && "bg-signal-bearish/15 text-signal-bearish",
        tone === "primary" && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </span>
  );
}

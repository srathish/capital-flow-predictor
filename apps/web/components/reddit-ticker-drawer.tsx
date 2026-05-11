"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";
import type {
  RedditMentionRow,
  RedditRuleId,
  RedditRuleStats,
  RedditPredictiveSignal,
} from "@/lib/types";

const SIGNAL_STYLE: Record<RedditPredictiveSignal, { label: string; cls: string }> = {
  buy: { label: "BUY", cls: "bg-signal-bullish/15 text-signal-bullish" },
  fade: { label: "FADE", cls: "bg-signal-bearish/15 text-signal-bearish" },
  watch: { label: "WATCH", cls: "bg-primary/15 text-primary" },
  neutral: { label: "NEUTRAL", cls: "bg-muted text-muted-foreground" },
};

const RULE_LABEL: Record<RedditRuleId, string> = {
  contrarian_top: "crowded top",
  stealth_setup: "stealth",
  first_time_bull: "first-time bull",
  wsb_only_hype: "wsb-only hype",
  investing_accumulation: "quality accumulation",
  fading_hype: "fading hype",
  price_confirming_spike: "price-confirming spike",
};

const COMPONENT_LABEL: Record<keyof RedditMentionRow["score_components"], string> = {
  spike: "Spike",
  momentum: "Momentum",
  sentiment: "Sentiment",
  audience: "Audience",
  price_confirm: "Price confirm",
  freshness: "Freshness",
  stealth_bonus: "Stealth bonus",
};

function formatHoursAgo(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function RedditTickerDrawer({
  row,
  onClose,
}: {
  row: RedditMentionRow | null;
  onClose: () => void;
}) {
  // Lazy-load catalyst posts for the selected ticker.
  const { data: catalysts, isLoading } = useQuery({
    queryKey: ["reddit-catalysts", row?.ticker],
    queryFn: () =>
      row
        ? api.redditCatalysts({ ticker: row.ticker, hours: 168, limit: 25, minScore: 0.05 })
        : Promise.resolve({ n_total: 0, posts: [] }),
    enabled: !!row,
    retry: false,
  });

  // Rule stats — used to annotate which patterns matched this row.
  const { data: rules } = useQuery({
    queryKey: ["reddit-rules"],
    queryFn: () => api.redditRules(),
    enabled: !!row,
    retry: false,
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    if (!row) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [row, onClose]);

  if (!row) return null;

  const sentimentLabel =
    row.sentiment_bull_share === null
      ? "—"
      : row.sentiment_bull_share >= 0.65
        ? "bullish lean"
        : row.sentiment_bull_share <= 0.35
          ? "bearish lean"
          : "mixed";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">${row.ticker}</h2>
              {row.name && (
                <span className="text-xs text-muted-foreground">{row.name}</span>
              )}
            </div>
            {row.sector && (
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {row.sector}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            esc ✕
          </button>
        </div>

        {/* quick-stats grid */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Mentions" value={row.mentions_today.toString()} />
          <Stat
            label="Spike"
            value={row.spike_ratio !== null ? `${row.spike_ratio.toFixed(1)}x` : "—"}
            tone={row.spike_ratio && row.spike_ratio > 1.5 ? "up" : row.spike_ratio && row.spike_ratio < 0.5 ? "down" : undefined}
          />
          <Stat
            label="Rank"
            value={row.rank_today !== null ? `#${row.rank_today}` : "—"}
          />
          <Stat
            label="Δ price 1d"
            value={row.price_change_1d !== null ? `${row.price_change_1d >= 0 ? "+" : ""}${row.price_change_1d.toFixed(1)}%` : "—"}
            tone={row.price_change_1d && row.price_change_1d > 0 ? "up" : row.price_change_1d && row.price_change_1d < 0 ? "down" : undefined}
          />
          <Stat
            label="Δ price 5d"
            value={row.price_change_5d !== null ? `${row.price_change_5d >= 0 ? "+" : ""}${row.price_change_5d.toFixed(1)}%` : "—"}
            tone={row.price_change_5d && row.price_change_5d > 0 ? "up" : row.price_change_5d && row.price_change_5d < 0 ? "down" : undefined}
          />
          <Stat label="Sentiment" value={sentimentLabel} />
          <Stat label="Audience" value={row.audience_skew} />
          <Stat label="Top-20 days /14" value={String(row.days_in_top20_14d)} />
          <Stat label="Last 6h posts" value={String(row.mentions_last_6h)} />
        </div>

        {/* prediction breakdown */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              20-day prediction
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                SIGNAL_STYLE[row.pred_signal].cls,
              )}
            >
              {SIGNAL_STYLE[row.pred_signal].label} · {row.pred_score.toFixed(0)}/100
            </span>
          </div>
          <div className="mb-2 flex items-baseline gap-3 text-sm">
            <span
              className={cn(
                "num font-semibold",
                row.pred_return_20d_pct > 0 && "text-signal-bullish",
                row.pred_return_20d_pct < 0 && "text-signal-bearish",
              )}
            >
              {row.pred_return_20d_pct >= 0 ? "+" : ""}
              {row.pred_return_20d_pct.toFixed(2)}% expected
            </span>
            <span className="text-[11px] text-muted-foreground">
              confidence {(row.pred_confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="space-y-1">
            {(Object.keys(row.score_components) as (keyof typeof row.score_components)[])
              .filter((k) => Math.abs(row.score_components[k]) >= 0.5)
              .sort((a, b) => Math.abs(row.score_components[b]) - Math.abs(row.score_components[a]))
              .map((k) => {
                const v = row.score_components[k];
                const w = Math.min(100, (Math.abs(v) / 15) * 100);
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="w-28 text-muted-foreground">{COMPONENT_LABEL[k]}</span>
                    <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                      <div
                        className={cn(
                          "absolute top-0 h-full rounded-full",
                          v > 0 ? "bg-signal-bullish left-1/2" : "bg-signal-bearish right-1/2",
                        )}
                        style={{ width: `${w / 2}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        "num w-12 text-right tabular-nums",
                        v > 0 ? "text-signal-bullish" : "text-signal-bearish",
                      )}
                    >
                      {v > 0 ? "+" : ""}
                      {v.toFixed(1)}
                    </span>
                  </div>
                );
              })}
          </div>
          {row.matched_rules.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Matched patterns
              </div>
              <div className="space-y-1">
                {row.matched_rules.map((rid) => {
                  const s = (rules ?? []).find((x) => x.rule_id === rid);
                  return (
                    <div key={rid} className="flex items-baseline justify-between text-[11px]">
                      <span className="font-medium">{RULE_LABEL[rid]}</span>
                      <span className="text-muted-foreground">
                        {s && s.n_events >= 5 && s.win_rate !== null ? (
                          <>
                            win {(s.win_rate * 100).toFixed(0)}% · n={s.n_events}
                            {s.edge_vs_baseline_pct !== null && (
                              <span
                                className={cn(
                                  "ml-1 num tabular-nums",
                                  s.edge_vs_baseline_pct > 0 && "text-signal-bullish",
                                  s.edge_vs_baseline_pct < 0 && "text-signal-bearish",
                                )}
                              >
                                ({s.edge_vs_baseline_pct >= 0 ? "+" : ""}
                                {s.edge_vs_baseline_pct.toFixed(1)}% vs SPY)
                              </span>
                            )}
                          </>
                        ) : (
                          <span>calibrating · n={s?.n_events ?? 0}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* sparkline */}
        {row.sparkline_7d.length > 1 && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>7d mention trend</span>
              <span>
                avg {row.mentions_7d_avg.toFixed(0)} · momentum{" "}
                {row.momentum_score !== null ? `${(row.momentum_score * 100).toFixed(0)}%/d` : "—"}
              </span>
            </div>
            <Sparkline values={row.sparkline_7d} width={520} height={48} />
          </div>
        )}

        {/* sentiment bar */}
        {(row.n_bullish_kw + row.n_bearish_kw) > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
              <span>Catalyst keyword sentiment (7d)</span>
              <span>
                {row.n_bullish_kw} bull · {row.n_bearish_kw} bear
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-signal-bullish"
                style={{
                  width: `${(row.sentiment_bull_share ?? 0) * 100}%`,
                }}
              />
              <div
                className="bg-signal-bearish"
                style={{
                  width: `${(1 - (row.sentiment_bull_share ?? 0)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* per-subreddit */}
        {row.by_subreddit.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Per-subreddit
            </div>
            <div className="space-y-1.5">
              {row.by_subreddit
                .slice()
                .sort((a, b) => b.mentions - a.mentions)
                .map((s) => {
                  const max = Math.max(...row.by_subreddit.map((x) => x.mentions));
                  const w = max > 0 ? (s.mentions / max) * 100 : 0;
                  return (
                    <div key={s.subreddit} className="flex items-center gap-2 text-[11px]">
                      <span className="w-28 truncate text-muted-foreground">r/{s.subreddit}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${w}%` }} />
                      </div>
                      <span className="num w-10 text-right tabular-nums">{s.mentions}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* recent catalyst posts */}
        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Catalyst posts (7d)</span>
            <span>{catalysts?.posts.length ?? 0} found</span>
          </div>
          {isLoading && (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              loading…
            </div>
          )}
          {!isLoading && catalysts && catalysts.posts.length === 0 && (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              No keyword-flagged posts mentioning this ticker. Try the Apewisdom thread feed
              directly.
            </div>
          )}
          <div className="space-y-1.5">
            {catalysts?.posts.map((p) => (
              <a
                key={p.id}
                href={p.permalink ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-border p-2.5 hover:border-primary/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium leading-snug">{p.title}</span>
                  <span className="num shrink-0 text-[10px] text-muted-foreground">
                    {p.catalyst_score.toFixed(2)} · {formatHoursAgo(p.hours_old)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="rounded-full bg-muted px-1.5 py-0.5">r/{p.subreddit}</span>
                  {p.author && <span>u/{p.author}</span>}
                  {p.keywords.slice(0, 4).map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-signal-bearish/15 px-1.5 py-0.5 font-semibold text-signal-bearish"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Link
            href={`/agents/${encodeURIComponent(row.ticker)}`}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-center text-xs font-semibold text-white hover:opacity-90"
          >
            Run agent ensemble →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "up" && "text-signal-bullish",
          tone === "down" && "text-signal-bearish",
        )}
      >
        {value}
      </div>
    </div>
  );
}

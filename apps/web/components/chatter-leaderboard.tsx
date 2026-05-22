"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import {
  CATALYST_CATEGORIES,
  classifyKeywords,
  type CatalystCategoryId,
} from "@/lib/catalyst-categories";
import type { CatalystPost, RedditMentionRow } from "@/lib/types";

const LEADERBOARD_HOURS = 48;
const REFETCH_MS = 60_000;
const TOP_N = 10;

type SourceMix = {
  reddit: number; // 0..1, normalized
  catalyst: number; // 0..1, normalized
  news: number; // 0..1, stage 2
};

type LeaderboardEntry = {
  ticker: string;
  name: string | null;
  composite: number; // 0..100 (relative within result set)
  catalystPosts: number;
  maxCatalystScore: number;
  topCategory: CatalystCategoryId | null;
  whyTag: string; // one-line "why is this on the board"
  mentionsToday: number;
  mentionsLast6h: number;
  spikeRatio: number | null;
  sparkline7d: number[];
  priceChange1d: number | null;
  priceChange5d: number | null;
  sources: SourceMix;
  newestHoursOld: number; // freshness of most recent signal
  predSignal: "buy" | "fade" | "watch" | "neutral";
  predReturn20d: number | null;
  // Raw catalyst posts that match this ticker, sorted by score desc.
  // Powers the click-through drawer; carries the full per-event evidence.
  events: CatalystPost[];
  mentionsRow: RedditMentionRow | null;
};

function formatPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(digits)}%`;
}

function returnTone(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-muted-foreground";
  if (p > 0.5) return "text-signal-bullish";
  if (p < -0.5) return "text-signal-bearish";
  return "text-muted-foreground";
}

function freshnessLabel(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function pickWhyTag(
  topCategory: CatalystCategoryId | null,
  spike: number | null,
  predSignal: LeaderboardEntry["predSignal"],
  catalystPosts: number,
  topKeywords: string[],
): string {
  if (topCategory && catalystPosts > 0) {
    const cat = CATALYST_CATEGORIES[topCategory];
    if (topKeywords[0]) {
      return `${cat.label} · "${topKeywords[0]}"`;
    }
    return cat.label;
  }
  if (spike != null && spike >= 2) return `Mention spike ${spike.toFixed(1)}×`;
  if (predSignal === "buy") return "Model BUY";
  if (predSignal === "fade") return "Model FADE";
  if (catalystPosts > 0) return "Catalyst chatter";
  return "Reddit chatter";
}

function buildLeaderboard(
  catalysts: CatalystPost[],
  mentions: RedditMentionRow[],
): LeaderboardEntry[] {
  // Per-ticker catalyst aggregates.
  type CatAgg = {
    posts: number;
    maxScore: number;
    sumScore: number;
    newest: number;
    catCounts: Map<CatalystCategoryId, number>;
    topKeywords: Map<string, number>;
    events: CatalystPost[];
  };
  const catByTicker = new Map<string, CatAgg>();
  for (const p of catalysts) {
    const { primary } = classifyKeywords(p.keywords);
    // Time-decayed contribution so older posts don't dominate.
    const recency = Math.max(0.2, Math.exp(-p.hours_old / 24));
    for (const t of p.tickers) {
      const a: CatAgg = catByTicker.get(t) ?? {
        posts: 0,
        maxScore: 0,
        sumScore: 0,
        newest: Infinity,
        catCounts: new Map(),
        topKeywords: new Map(),
        events: [],
      };
      a.posts += 1;
      a.maxScore = Math.max(a.maxScore, p.catalyst_score);
      a.sumScore += p.catalyst_score * recency;
      a.newest = Math.min(a.newest, p.hours_old);
      a.catCounts.set(primary, (a.catCounts.get(primary) ?? 0) + 1);
      for (const k of p.keywords) {
        a.topKeywords.set(k, (a.topKeywords.get(k) ?? 0) + 1);
      }
      a.events.push(p);
      catByTicker.set(t, a);
    }
  }

  const mentionsByTicker = new Map<string, RedditMentionRow>();
  for (const m of mentions) mentionsByTicker.set(m.ticker, m);

  const allTickers = new Set<string>([
    ...catByTicker.keys(),
    ...mentionsByTicker.keys(),
  ]);

  const rows: LeaderboardEntry[] = [];
  for (const ticker of allTickers) {
    const cat = catByTicker.get(ticker);
    const m = mentionsByTicker.get(ticker);

    const catalystSignal = cat ? cat.sumScore : 0;
    const mentionsToday = m?.mentions_today ?? 0;
    const spike = m?.spike_ratio ?? null;
    const mentionsSignal =
      Math.log10(mentionsToday + 1) * (spike != null && spike > 1 ? Math.min(spike, 5) : 1);
    const predScore = m?.pred_score ?? 0;
    const predSignal = m?.pred_signal ?? "neutral";
    const predContribution =
      predSignal === "buy" || predSignal === "watch"
        ? Math.max(0, predScore)
        : 0;

    // Raw composite — relative ranking, not an absolute scale.
    const raw =
      catalystSignal * 1.5 + mentionsSignal * 0.8 + predContribution * 0.6;
    if (raw <= 0) continue;

    let topCategory: CatalystCategoryId | null = null;
    let topKeywords: string[] = [];
    if (cat) {
      let topN = -1;
      for (const [c, n] of cat.catCounts) {
        if (n > topN) {
          topN = n;
          topCategory = c;
        }
      }
      topKeywords = Array.from(cat.topKeywords.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k);
    }

    const totalSrc = catalystSignal + mentionsSignal + predContribution + 1e-9;
    const sources: SourceMix = {
      catalyst: catalystSignal / totalSrc,
      reddit: (mentionsSignal + predContribution) / totalSrc,
      news: 0, // wired in stage 2
    };

    const newestHours = cat
      ? cat.newest
      : m
        ? 0 // mentions snapshot is "today"
        : Infinity;

    const events = cat
      ? [...cat.events].sort((a, b) => b.catalyst_score - a.catalyst_score)
      : [];

    rows.push({
      ticker,
      name: m?.name ?? null,
      composite: raw, // will normalize below
      catalystPosts: cat?.posts ?? 0,
      maxCatalystScore: cat?.maxScore ?? 0,
      topCategory,
      whyTag: pickWhyTag(
        topCategory,
        spike,
        predSignal,
        cat?.posts ?? 0,
        topKeywords,
      ),
      mentionsToday,
      mentionsLast6h: m?.mentions_last_6h ?? 0,
      spikeRatio: spike,
      sparkline7d: m?.sparkline_7d ?? [],
      priceChange1d: m?.price_change_1d ?? null,
      priceChange5d: m?.price_change_5d ?? null,
      sources,
      newestHoursOld: newestHours,
      predSignal,
      predReturn20d: m?.pred_return_20d_pct ?? null,
      events,
      mentionsRow: m ?? null,
    });
  }

  rows.sort((a, b) => b.composite - a.composite);
  const top = rows.slice(0, TOP_N);

  // Normalize composite to 0..100 within the displayed set so the bars are
  // readable even when raw scores cluster.
  const maxRaw = top[0]?.composite ?? 1;
  for (const r of top) r.composite = Math.round((r.composite / maxRaw) * 100);

  return top;
}

function SourceDots({ sources }: { sources: SourceMix }) {
  // Reddit | Catalyst | News (stage 2). Opacity encodes contribution share.
  const dot = (key: keyof SourceMix, label: string, color: string) => {
    const v = sources[key];
    return (
      <span
        title={`${label} ${(v * 100).toFixed(0)}%`}
        className={cn(
          "inline-block h-2 w-2 rounded-full transition-opacity",
          color,
        )}
        style={{ opacity: v < 0.05 ? 0.15 : 0.4 + 0.6 * v }}
      />
    );
  };
  return (
    <span className="inline-flex items-center gap-1">
      {dot("reddit", "Reddit chatter", "bg-orange-500")}
      {dot("catalyst", "Catalyst posts", "bg-primary")}
      {dot("news", "News (coming soon)", "bg-emerald-500")}
    </span>
  );
}

function HeroCard({
  entry,
  onOpen,
}: {
  entry: LeaderboardEntry;
  onOpen: () => void;
}) {
  const cat = entry.topCategory ? CATALYST_CATEGORIES[entry.topCategory] : null;
  return (
    <Card
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer border-primary/40 bg-gradient-to-br from-primary/5 to-card transition-colors hover:border-primary/70"
    >
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                #1 on the board
              </span>
              <SourceDots sources={entry.sources} />
              <span className="ml-auto text-[10px] text-muted-foreground sm:ml-0">
                click for evidence →
              </span>
            </div>
            <div className="mt-1 font-mono text-4xl font-bold">
              ${entry.ticker}
            </div>
            {entry.name && (
              <div className="text-sm text-muted-foreground">{entry.name}</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 font-semibold",
                  cat ? cn(cat.swatch, cat.text) : "bg-muted text-foreground",
                )}
              >
                {entry.whyTag}
              </span>
              {entry.predSignal !== "neutral" && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    entry.predSignal === "buy"
                      ? "bg-signal-bullish/15 text-signal-bullish"
                      : entry.predSignal === "fade"
                        ? "bg-signal-bearish/15 text-signal-bearish"
                        : "bg-primary/15 text-primary",
                  )}
                >
                  {entry.predSignal.toUpperCase()}
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Metric
                label="Mentions today"
                value={entry.mentionsToday > 0 ? String(entry.mentionsToday) : "—"}
                hint={
                  entry.spikeRatio != null && entry.spikeRatio > 1
                    ? `${entry.spikeRatio.toFixed(1)}× vs 7d avg`
                    : entry.mentionsLast6h > 0
                      ? `${entry.mentionsLast6h} in last 6h`
                      : null
                }
              />
              <Metric
                label="Catalyst posts"
                value={entry.catalystPosts > 0 ? String(entry.catalystPosts) : "—"}
                hint={
                  entry.maxCatalystScore > 0
                    ? `top score ${entry.maxCatalystScore.toFixed(2)}`
                    : null
                }
              />
              <Metric
                label="Freshness"
                value={`${freshnessLabel(entry.newestHoursOld)} ago`}
                hint={null}
              />
              <Metric
                label="5d price"
                value={formatPct(entry.priceChange5d)}
                valueClass={returnTone(entry.priceChange5d)}
                hint={
                  entry.priceChange1d != null
                    ? `1d ${formatPct(entry.priceChange1d)}`
                    : null
                }
              />
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Composite
              </div>
              <div className="num text-3xl font-semibold text-primary">
                {entry.composite}
              </div>
            </div>
            {entry.sparkline7d.length > 0 && (
              <div title="7d mention history">
                <Sparkline values={entry.sparkline7d} width={160} height={36} />
              </div>
            )}
            {entry.predReturn20d != null && (
              <span
                className={cn("num text-[11px]", returnTone(entry.predReturn20d))}
                title="Predicted 20-day return from the Reddit model"
              >
                pred 20d {formatPct(entry.predReturn20d)}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string | null;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("num text-base font-semibold", valueClass)}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function RankCard({
  entry,
  rank,
  onOpen,
}: {
  entry: LeaderboardEntry;
  rank: number;
  onOpen: () => void;
}) {
  const cat = entry.topCategory ? CATALYST_CATEGORIES[entry.topCategory] : null;
  return (
    <Card
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="min-w-[200px] shrink-0 cursor-pointer transition-colors hover:border-primary/60"
    >
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">
            #{rank}
          </span>
          <span className="num text-[11px] font-semibold text-primary">
            {entry.composite}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-base font-semibold">
          ${entry.ticker}
        </div>
        <div
          className={cn(
            "mt-1 line-clamp-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            cat ? cn(cat.swatch, cat.text) : "bg-muted text-foreground",
          )}
          title={entry.whyTag}
        >
          {entry.whyTag}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
          <div>
            <span className="text-muted-foreground">mentions </span>
            <span className="num font-semibold">
              {entry.mentionsToday > 0 ? entry.mentionsToday : "—"}
            </span>
            {entry.spikeRatio != null && entry.spikeRatio >= 1.5 && (
              <span className="ml-1 text-signal-bullish">
                ↑{entry.spikeRatio.toFixed(1)}×
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">catalysts </span>
            <span className="num font-semibold">
              {entry.catalystPosts > 0 ? entry.catalystPosts : "—"}
            </span>
          </div>
        </div>
        {entry.sparkline7d.length > 0 && (
          <div className="mt-2">
            <Sparkline values={entry.sparkline7d} width={180} height={20} />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <SourceDots sources={entry.sources} />
          {entry.priceChange5d != null ? (
            <span className={cn("num", returnTone(entry.priceChange5d))}>
              5d {formatPct(entry.priceChange5d, 0)}
            </span>
          ) : (
            <span>{freshnessLabel(entry.newestHoursOld)} ago</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TickerEvidenceDrawer({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry;
  onClose: () => void;
}) {
  // ESC closes; body scroll lock while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const events = entry.events;
  const m = entry.mentionsRow;
  const cat = entry.topCategory ? CATALYST_CATEGORIES[entry.topCategory] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold">${entry.ticker}</span>
              <span className="num text-sm font-semibold text-primary">
                {entry.composite}
              </span>
              <SourceDots sources={entry.sources} />
            </div>
            {entry.name && (
              <div className="text-sm text-muted-foreground">{entry.name}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-semibold",
                  cat ? cn(cat.swatch, cat.text) : "bg-muted text-foreground",
                )}
              >
                {entry.whyTag}
              </span>
              <span className="text-muted-foreground">
                {entry.mentionsToday > 0 && (
                  <>{entry.mentionsToday} mentions today · </>
                )}
                {entry.catalystPosts} event{entry.catalystPosts === 1 ? "" : "s"} ·{" "}
                {freshnessLabel(entry.newestHoursOld)} ago
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            close ✕
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 border-b border-border p-5 sm:grid-cols-4">
          <Metric
            label="Mentions today"
            value={entry.mentionsToday > 0 ? String(entry.mentionsToday) : "—"}
            hint={
              entry.spikeRatio != null && entry.spikeRatio > 1
                ? `${entry.spikeRatio.toFixed(1)}× vs 7d avg`
                : entry.mentionsLast6h > 0
                  ? `${entry.mentionsLast6h} in last 6h`
                  : null
            }
          />
          <Metric
            label="Last 6h"
            value={entry.mentionsLast6h > 0 ? String(entry.mentionsLast6h) : "—"}
            hint={null}
          />
          <Metric
            label="1d / 5d price"
            value={`${formatPct(entry.priceChange1d, 0)} / ${formatPct(entry.priceChange5d, 0)}`}
            hint={null}
          />
          <Metric
            label="Pred 20d"
            value={formatPct(entry.predReturn20d)}
            valueClass={returnTone(entry.predReturn20d)}
            hint={
              entry.predSignal !== "neutral"
                ? `signal: ${entry.predSignal}`
                : null
            }
          />
        </div>

        {/* Events list, ranked by confidence (catalyst_score desc) */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence — ranked by confidence
            </h3>
            <span className="text-[10px] text-muted-foreground">
              {events.length} event{events.length === 1 ? "" : "s"} (last{" "}
              {LEADERBOARD_HOURS}h)
            </span>
          </div>
          {events.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                No catalyst-flagged posts for this ticker yet. The ranking is
                driven by raw mention volume{m?.matched_rules?.length
                  ? ` and these rule matches: ${m.matched_rules.join(", ")}`
                  : ""}.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {events.map((p) => {
                const { primary } = classifyKeywords(p.keywords);
                const pCat = CATALYST_CATEGORIES[primary];
                return (
                  <li key={p.id}>
                    <Card>
                      <CardContent className="p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <a
                            href={p.permalink ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-semibold leading-snug hover:text-primary"
                          >
                            {p.title}
                          </a>
                          <span
                            className="num shrink-0 text-[11px] text-primary"
                            title="Higher score = stronger catalyst signal (keyword weight × ticker × recency × author trust)"
                          >
                            {p.catalyst_score.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 font-semibold",
                              pCat.swatch,
                              pCat.text,
                            )}
                          >
                            {pCat.label}
                          </span>
                          <span>r/{p.subreddit}</span>
                          <span>{freshnessLabel(p.hours_old)} ago</span>
                          {p.upvotes != null && <span>▲ {p.upvotes}</span>}
                          {p.num_comments != null && (
                            <span>💬 {p.num_comments}</span>
                          )}
                          {p.return_since_post_pct != null && (
                            <span
                              className={cn(
                                "num",
                                returnTone(p.return_since_post_pct),
                              )}
                              title="Price change since the post went up"
                            >
                              since {formatPct(p.return_since_post_pct)}
                            </span>
                          )}
                          {p.keywords.slice(0, 3).map((k) => (
                            <span
                              key={k}
                              className="rounded-full bg-muted px-1.5 py-0.5"
                            >
                              {k}
                            </span>
                          ))}
                          {p.keywords.length > 3 && (
                            <span>+{p.keywords.length - 3}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer link to full ticker page */}
        <div className="border-t border-border p-4">
          <Link
            href={`/agents/${encodeURIComponent(entry.ticker)}`}
            className="block w-full rounded-full border border-primary/50 px-4 py-2 text-center text-xs font-semibold text-primary hover:bg-primary/10"
          >
            Open full ${entry.ticker} analyst dossier →
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ChatterLeaderboard() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const catalystsQuery = useQuery({
    queryKey: ["chatter-leaderboard-catalysts"],
    queryFn: () =>
      api.redditCatalysts({
        hours: LEADERBOARD_HOURS,
        minScore: 0.05,
        limit: 200,
      }),
    retry: false,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const mentionsQuery = useQuery({
    queryKey: ["chatter-leaderboard-mentions"],
    queryFn: () =>
      api.redditMentions({ sort: "predicted", limit: 80 }),
    retry: false,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const entries = useMemo<LeaderboardEntry[]>(() => {
    const catalysts = catalystsQuery.data?.posts ?? [];
    const mentions = mentionsQuery.data?.rows ?? [];
    if (catalysts.length === 0 && mentions.length === 0) return [];
    return buildLeaderboard(catalysts, mentions);
  }, [catalystsQuery.data, mentionsQuery.data]);

  const isLoading = catalystsQuery.isLoading || mentionsQuery.isLoading;
  const error = catalystsQuery.error || mentionsQuery.error;
  const selectedEntry = selectedTicker
    ? entries.find((e) => e.ticker === selectedTicker) ?? null
    : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Chatter board
          </h1>
          <p className="text-sm text-muted-foreground">
            Top {TOP_N} tickers right now across Reddit chatter, catalyst posts,
            and (soon) news feeds. Click any card to see every event behind the
            score, ranked by confidence.
          </p>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {LEADERBOARD_HOURS}h window · refresh 60s
        </div>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No chatter signals in the last {LEADERBOARD_HOURS}h. The catalyst
            feed and mentions snapshot are both empty.
          </CardContent>
        </Card>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          <HeroCard
            entry={entries[0]!}
            onOpen={() => setSelectedTicker(entries[0]!.ticker)}
          />
          {entries.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {entries.slice(1).map((e, i) => (
                <RankCard
                  key={e.ticker}
                  entry={e}
                  rank={i + 2}
                  onOpen={() => setSelectedTicker(e.ticker)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedEntry && (
        <TickerEvidenceDrawer
          entry={selectedEntry}
          onClose={() => setSelectedTicker(null)}
        />
      )}
    </section>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, baseUrl } from "@/lib/api";
import type {
  DiscordAuthorStats,
  DiscordMessage,
  DiscordTickerScore,
  DiscordVerdict,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Server -> channel grouping; within each group we sort by confluence
// (alerts confirmed by more of our own signals float to the top), then by
// recency. The "Alerts only" toggle hides chat banter — messages with no
// extracted ticker and no attachment.

type Group = {
  guildName: string;
  channelName: string;
  channelId: string;
  messages: DiscordMessage[];
  newestAt: string;
  topConfluence: number;
};

function groupMessages(msgs: DiscordMessage[]): Group[] {
  const buckets = new Map<string, Group>();
  for (const m of msgs) {
    const key = `${m.guild_name}::${m.channel_id}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.messages.push(m);
      if (m.posted_at > existing.newestAt) existing.newestAt = m.posted_at;
      if (m.confluence > existing.topConfluence) existing.topConfluence = m.confluence;
    } else {
      buckets.set(key, {
        guildName: m.guild_name,
        channelName: m.channel_name,
        channelId: m.channel_id,
        messages: [m],
        newestAt: m.posted_at,
        topConfluence: m.confluence,
      });
    }
  }
  // Composite sort priority within each group:
  //   parsed-play (typed strike/side) > watchlist hit > confluence > recency
  const priority = (m: DiscordMessage): number => {
    const hasPlay = m.has_parsed_play ? 1 : 0;
    const watchlist = m.scores.some((s) => s.in_watchlist) ? 1 : 0;
    return hasPlay * 100 + watchlist * 50 + m.confluence * 10;
  };
  for (const g of buckets.values()) {
    g.messages.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pb - pa;
      return a.posted_at < b.posted_at ? 1 : a.posted_at > b.posted_at ? -1 : 0;
    });
  }
  // Sort groups: highest top-confluence first, then most-recent.
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.topConfluence !== b.topConfluence) return b.topConfluence - a.topConfluence;
    return a.newestAt < b.newestAt ? 1 : a.newestAt > b.newestAt ? -1 : 0;
  });
}

function formatPlay(s: { side: string | null; strike: number | null; expiry: string | null }): string | null {
  if (!s.side && !s.strike) return null;
  const sideAbbrev =
    s.side === "call" ? "c" : s.side === "put" ? "p" : s.side ?? "";
  const strike = s.strike != null ? String(s.strike) : "";
  const expiry = s.expiry ?? "";
  const inner = [strike + sideAbbrev, expiry].filter(Boolean).join(" ");
  return inner || null;
}

function formatPnl(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const VERDICT_STYLE: Record<NonNullable<DiscordVerdict>, string> = {
  bull: "bg-signal-bullish/15 text-signal-bullish border-signal-bullish/30",
  bear: "bg-signal-bearish/15 text-signal-bearish border-signal-bearish/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

function VerdictChip({
  label,
  verdict,
}: {
  label: string;
  verdict: DiscordVerdict;
}) {
  if (verdict == null) {
    return (
      <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
        {label}: —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase",
        VERDICT_STYLE[verdict]
      )}
    >
      {label}: {verdict}
    </span>
  );
}

export function DiscordAlertsView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeGuild, setActiveGuild] = useState<string | null>(null);
  const [alertsOnly, setAlertsOnly] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discord", "messages", search],
    queryFn: () => api.discordMessages({ limit: 300, q: search || undefined }),
    refetchInterval: 30_000,  // background safety net; SSE handles real-time
  });

  // Real-time: SSE stream tells us when a new message lands, and we
  // invalidate the messages query so React Query refetches with full scoring.
  // We don't render SSE rows directly because scoring + watchlist + author
  // stats are computed on the /messages endpoint, not the lightweight stream.
  useEffect(() => {
    const url = `${baseUrl()}/v1/discord/stream`;
    const es = new EventSource(url, { withCredentials: false });
    es.addEventListener("message", () => {
      queryClient.invalidateQueries({ queryKey: ["discord", "messages"] });
    });
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => es.close();
  }, [queryClient]);

  const rawMessages = data?.messages ?? [];
  const visibleMessages = useMemo(() => {
    if (!alertsOnly) return rawMessages;
    return rawMessages.filter(
      (m) => m.tickers.length > 0 || m.attachment_urls.length > 0
    );
  }, [rawMessages, alertsOnly]);

  const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages]);
  const guilds = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const g of groups) {
      if (!seen.has(g.guildName)) {
        seen.add(g.guildName);
        ordered.push(g.guildName);
      }
    }
    return ordered;
  }, [groups]);
  const visibleGroups = activeGuild
    ? groups.filter((g) => g.guildName === activeGuild)
    : groups;

  const hiddenCount = rawMessages.length - visibleMessages.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discord Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Verified against your own flow / GEX / whale / reddit signals.
            Stronger confluence floats up. Refreshes every 15s.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link href="/discord/sources" className="underline-offset-4 hover:underline">
            sources
          </Link>
          <Link href="/discord/authors" className="underline-offset-4 hover:underline">
            authors
          </Link>
          <Link
            href="/discord/notifications"
            className="underline-offset-4 hover:underline"
          >
            notifications
          </Link>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search content (ticker, strike, keyword)…"
          className="h-9 w-72 rounded-full border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
        />
        <button
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["discord", "messages"] })
          }
          className="h-9 rounded-full border border-border bg-card px-3 text-sm hover:border-primary/40"
        >
          refresh
        </button>
        <label className="ml-1 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            checked={alertsOnly}
            onChange={(e) => setAlertsOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Alerts only{" "}
          {hiddenCount > 0 && (
            <span className="text-muted-foreground">(hides {hiddenCount})</span>
          )}
        </label>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveGuild(null)}
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              activeGuild === null
                ? "bg-primary/15 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            all servers
          </button>
          {guilds.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGuild(g)}
              className={cn(
                "rounded-full px-3 py-1 text-xs",
                activeGuild === g
                  ? "bg-primary/15 text-primary"
                  : "bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-signal-bearish">
            failed to load: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!isLoading && !error && visibleGroups.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {rawMessages.length === 0
              ? "No messages captured yet. Add a (server, channel) pair in configure sources."
              : alertsOnly
                ? "No ticker-bearing messages in the current view. Toggle 'Alerts only' off to see chat."
                : "No messages match the current filter."}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {visibleGroups.map((g) => (
          <Card key={`${g.guildName}::${g.channelId}`}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {g.guildName}
                  </div>
                  <div className="text-base font-semibold">#{g.channelName}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {g.messages.length} msg · last {timeAgo(g.newestAt)}
                </div>
              </div>
              <ul className="space-y-3">
                {g.messages.map((m) => (
                  <MessageRow key={m.message_id} msg={m} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuthorTrustBadge({ stats }: { stats: DiscordAuthorStats }) {
  if (stats.win_rate == null) {
    return (
      <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
        {stats.total_plays}p · ?
      </span>
    );
  }
  const pct = Math.round(stats.win_rate * 100);
  const cls =
    pct >= 60
      ? "border-signal-bullish/40 bg-signal-bullish/10 text-signal-bullish"
      : pct <= 40
        ? "border-signal-bearish/40 bg-signal-bearish/10 text-signal-bearish"
        : "border-border bg-card text-muted-foreground";
  return (
    <span
      title={`${stats.wins}W / ${stats.losses}L over ${stats.lookback_days}d · ${stats.total_plays} total plays`}
      className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", cls)}
    >
      {pct}% · {stats.resolved_plays}p
    </span>
  );
}

function MessageRow({ msg }: { msg: DiscordMessage }) {
  const images = msg.attachment_urls.filter((u) =>
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)
  );
  const otherFiles = msg.attachment_urls.filter((u) => !images.includes(u));
  const hasWatchlist = msg.scores.some((s) => s.in_watchlist);
  const hasPlay = msg.has_parsed_play;

  return (
    <li
      className={cn(
        "rounded-lg border bg-background/40 p-3",
        hasPlay
          ? "border-primary/60 ring-1 ring-primary/20"
          : hasWatchlist
            ? "border-primary/40"
            : msg.confluence >= 2
              ? "border-primary/40"
              : "border-border"
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{msg.author_name}</span>
        {msg.author_is_bot && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase">
            bot
          </span>
        )}
        {msg.author_stats && <AuthorTrustBadge stats={msg.author_stats} />}
        {msg.thread_name && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            thread: {msg.thread_name}
          </span>
        )}
        <span className="ml-auto">{timeAgo(msg.posted_at)}</span>
      </div>
      {msg.content && (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {msg.content}
        </div>
      )}
      {msg.scores.map((s) => (
        <TickerScoreRow key={s.ticker} score={s} />
      ))}
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="discord attachment"
                className="max-h-48 rounded-md border border-border object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
      {otherFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {otherFiles.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              attachment ↗
            </a>
          ))}
        </div>
      )}
    </li>
  );
}

function TickerScoreRow({ score }: { score: DiscordTickerScore }) {
  const playText = formatPlay(score);
  const pnl = score.pnl_pct_underlying;
  const pnlClass =
    pnl == null
      ? ""
      : pnl > 0
        ? "text-signal-bullish"
        : pnl < 0
          ? "text-signal-bearish"
          : "text-muted-foreground";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Link
        href={`/agents/${score.ticker}`}
        className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
      >
        ${score.ticker}
      </Link>
      {score.in_watchlist && (
        <span
          title="In your watchlist"
          className="rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
        >
          ★ watchlist
        </span>
      )}
      {score.first_mover && (
        <span
          title="This server was first to mention this ticker today"
          className="rounded-md border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500"
        >
          FIRST
        </span>
      )}
      {playText && (
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase">
          {playText}
        </span>
      )}
      {score.entry_price != null && (
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
          entry @ {score.entry_price.toFixed(2)}
        </span>
      )}
      {pnl != null && (
        <span
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
            pnl > 0
              ? "border-signal-bullish/40 bg-signal-bullish/10"
              : pnl < 0
                ? "border-signal-bearish/40 bg-signal-bearish/10"
                : "border-border bg-card",
            pnlClass
          )}
        >
          spot {formatPnl(pnl)}
        </span>
      )}
      <VerdictChip label="flow" verdict={score.flow} />
      <VerdictChip label="gex" verdict={score.gex} />
      <VerdictChip label="whale" verdict={score.whale} />
      <VerdictChip label="reddit" verdict={score.reddit} />
      {score.cross_chat_count >= 2 && (
        <span className="rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
          {score.cross_chat_count} servers · 30m
        </span>
      )}
    </div>
  );
}

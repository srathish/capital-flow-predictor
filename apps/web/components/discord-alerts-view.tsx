"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { DiscordMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Grouped view: server -> channel -> messages, newest first within each group.
// Refreshes every 15s so plays show up without manual reload. The listener
// service writes into discord_messages from Railway; the API serves /v1/discord/messages.

type Group = {
  guildName: string;
  channelName: string;
  channelId: string;
  messages: DiscordMessage[];
  newestAt: string;
};

function groupMessages(msgs: DiscordMessage[]): Group[] {
  const buckets = new Map<string, Group>();
  for (const m of msgs) {
    const key = `${m.guild_name}::${m.channel_id}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.messages.push(m);
      if (m.posted_at > existing.newestAt) existing.newestAt = m.posted_at;
    } else {
      buckets.set(key, {
        guildName: m.guild_name,
        channelName: m.channel_name,
        channelId: m.channel_id,
        messages: [m],
        newestAt: m.posted_at,
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.newestAt < b.newestAt ? 1 : a.newestAt > b.newestAt ? -1 : 0
  );
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

// Light-touch ticker extractor for the "tickers seen" chip row.
// Matches $XXXX or bare uppercase 1-5 letter tokens that aren't common
// English words. Good enough to scan the feed at a glance.
const TICKER_STOPLIST = new Set([
  "A", "I", "AM", "PM", "ET", "EOD", "OTM", "ITM", "ATM", "FOMC", "CPI",
  "PPI", "GDP", "EPS", "PE", "USD", "ETF", "YOLO", "DD", "TLDR", "FYI",
  "EDIT", "LFG", "GM", "GN", "BTC", "ETH", "TBH", "IMO", "IMHO",
]);

function extractTickers(content: string): string[] {
  const tickers = new Set<string>();
  for (const m of content.matchAll(/\$([A-Z]{1,5})\b/g)) tickers.add(m[1]);
  for (const m of content.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (!TICKER_STOPLIST.has(m[1])) tickers.add(m[1]);
  }
  return Array.from(tickers);
}

export function DiscordAlertsView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeGuild, setActiveGuild] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discord", "messages", search],
    queryFn: () => api.discordMessages({ limit: 300, q: search || undefined }),
    refetchInterval: 15_000,
  });

  const messages = data?.messages ?? [];
  const groups = useMemo(() => groupMessages(messages), [messages]);
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discord Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Live mirror of plays from the channels you're in — newest first,
            refreshes every 15s.
          </p>
        </div>
        <Link
          href="/discord/sources"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          configure sources
        </Link>
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
            No messages captured yet. If the listener is running, make sure
            you've added at least one row to <code>discord_sources</code>
            (server + channel name) and that your user account is in those
            channels.
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

function MessageRow({ msg }: { msg: DiscordMessage }) {
  const tickers = useMemo(() => extractTickers(msg.content), [msg.content]);
  const images = msg.attachment_urls.filter((u) =>
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)
  );
  const otherFiles = msg.attachment_urls.filter((u) => !images.includes(u));

  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{msg.author_name}</span>
        {msg.author_is_bot && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase">
            bot
          </span>
        )}
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
      {tickers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tickers.map((t) => (
            <Link
              key={t}
              href={`/agents/${t}`}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
            >
              ${t}
            </Link>
          ))}
        </div>
      )}
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

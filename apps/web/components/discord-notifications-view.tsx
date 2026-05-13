"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Configure push rules. The dispatcher worker in apps/jobs polls this table
// every N seconds (set via Railway cron) and POSTs matching alerts to the
// target URL — either a Discord webhook or an ntfy.sh topic. Idempotent;
// each (message, ticker, rule) tuple fires at most once.

export function DiscordNotificationsView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["discord", "notifications", "rules"],
    queryFn: () => api.discordNotificationRules(),
  });

  const [name, setName] = useState("");
  const [minConfluence, setMinConfluence] = useState(3);
  const [tickers, setTickers] = useState("");
  const [channel, setChannel] = useState<"ntfy" | "discord_webhook">("ntfy");
  const [target, setTarget] = useState("");

  const addMutation = useMutation({
    mutationFn: () =>
      api.discordAddNotificationRule({
        name: name.trim(),
        min_confluence: minConfluence,
        tickers: tickers
          .split(/[\s,]+/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
        channel,
        target: target.trim(),
      }),
    onSuccess: () => {
      setName("");
      setTickers("");
      setTarget("");
      queryClient.invalidateQueries({
        queryKey: ["discord", "notifications", "rules"],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.discordDeleteNotificationRule(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["discord", "notifications", "rules"],
      }),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Notification Rules
          </h1>
          <p className="text-sm text-muted-foreground">
            Push high-confluence alerts to ntfy.sh or a Discord webhook.
          </p>
        </div>
        <Link
          href="/discord"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          ← back to feed
        </Link>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !target.trim()) return;
              addMutation.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Rule name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 3+ bull on SPY/QQQ"
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Min confluence</span>
                <select
                  value={minConfluence}
                  onChange={(e) => setMinConfluence(Number(e.target.value))}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                  <option value={2}>2 agreeing signals</option>
                  <option value={3}>3 agreeing signals</option>
                  <option value={4}>4 agreeing signals (all)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">
                  Tickers (comma-separated, blank = any)
                </span>
                <input
                  value={tickers}
                  onChange={(e) => setTickers(e.target.value)}
                  placeholder="SPY, QQQ, NVDA"
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Channel</span>
                <select
                  value={channel}
                  onChange={(e) =>
                    setChannel(e.target.value as "ntfy" | "discord_webhook")
                  }
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                  <option value="ntfy">ntfy.sh (phone push)</option>
                  <option value="discord_webhook">Discord webhook</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs md:col-span-2">
                <span className="text-muted-foreground">
                  Target URL{" "}
                  <span className="text-muted-foreground/70">
                    (
                    {channel === "ntfy"
                      ? "e.g. https://ntfy.sh/bellwether-saiyeesh"
                      : "Discord channel webhook URL"}
                    )
                  </span>
                </span>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="https://..."
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? "adding…" : "add rule"}
            </button>
            {addMutation.error && (
              <p className="text-xs text-signal-bearish">
                {(addMutation.error as Error).message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && (data?.rules.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              No rules configured. Add one above to start receiving pushes.
              For ntfy.sh: pick a random topic name and install the ntfy app;
              you'll get notifications instantly.
            </p>
          )}
          {!isLoading && (data?.rules.length ?? 0) > 0 && (
            <ul className="divide-y divide-border">
              {data!.rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.channel} · min {r.min_confluence} · tickers:{" "}
                      {r.tickers.length ? r.tickers.join(", ") : "any"}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                      → {r.target}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(r.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-muted-foreground hover:text-signal-bearish"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

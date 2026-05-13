"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Admin surface for the (guild, channel) allowlist the listener reads.
// Names are matched case-insensitively against the live message stream.
// The listener reloads this every 60s, so changes here propagate quickly
// without restarting the Railway service.

export function DiscordSourcesView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["discord", "sources"],
    queryFn: () => api.discordSources(),
  });

  const [guildName, setGuildName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [label, setLabel] = useState("");

  const addMutation = useMutation({
    mutationFn: () =>
      api.discordAddSource({
        guild_name: guildName.trim(),
        channel_name: channelName.trim(),
        label: label.trim() || null,
        include_threads: true,
      }),
    onSuccess: () => {
      setGuildName("");
      setChannelName("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["discord", "sources"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.discordDeleteSource(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["discord", "sources"] }),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discord Sources</h1>
          <p className="text-sm text-muted-foreground">
            Channels the listener captures. Empty = nothing is captured.
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
            className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!guildName.trim() || !channelName.trim()) return;
              addMutation.mutate();
            }}
          >
            <input
              value={guildName}
              onChange={(e) => setGuildName(e.target.value)}
              placeholder="Server name"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
            />
            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="channel-name (no #)"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="label (optional)"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
            />
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? "adding…" : "add"}
            </button>
          </form>
          {addMutation.error && (
            <p className="mt-2 text-xs text-signal-bearish">
              {(addMutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {isLoading && <Skeleton className="h-32 w-full" />}
          {!isLoading && (data?.sources.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              No sources configured. Add the (server, channel) pairs you want
              the listener to mirror — threads under those channels are
              included automatically.
            </p>
          )}
          {!isLoading && (data?.sources.length ?? 0) > 0 && (
            <ul className="divide-y divide-border">
              {data!.sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {s.guild_name} <span className="text-muted-foreground">/</span>{" "}
                      #{s.channel_name}
                    </div>
                    {s.label && (
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(s.id)}
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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { DiscordInventoryGuild } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Admin surface for the (guild, channel) allowlist the listener reads.
// Dropdowns are sourced from discord_inventory (written by the listener on
// connect + on guild/channel events). If the listener hasn't synced yet,
// we fall back to free-text entry so you can still configure on day one.
// Listener reloads the allowlist every 60s — no redeploy needed.

export function DiscordSourcesView() {
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ["discord", "sources"],
    queryFn: () => api.discordSources(),
  });
  const inventoryQuery = useQuery({
    queryKey: ["discord", "inventory"],
    queryFn: () => api.discordInventory(),
    refetchInterval: 30_000,
  });

  const inventory = inventoryQuery.data?.guilds ?? [];
  const hasInventory = inventory.length > 0;

  const [guildName, setGuildName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [label, setLabel] = useState("");
  const [manualMode, setManualMode] = useState(false);

  // When inventory loads, default selection to first guild if user hasn't picked one yet.
  const activeGuild: DiscordInventoryGuild | undefined = useMemo(() => {
    if (!hasInventory) return undefined;
    return inventory.find((g) => g.guild_name === guildName) ?? inventory[0];
  }, [inventory, guildName, hasInventory]);

  // The set of (guild, channel) pairs already configured — used to gray out
  // already-added options in the channel dropdown.
  const existingPairs = useMemo(() => {
    const s = new Set<string>();
    for (const src of sourcesQuery.data?.sources ?? []) {
      s.add(`${src.guild_name.toLowerCase()}::${src.channel_name.toLowerCase()}`);
    }
    return s;
  }, [sourcesQuery.data]);

  const addMutation = useMutation({
    mutationFn: () =>
      api.discordAddSource({
        guild_name: (manualMode ? guildName : activeGuild?.guild_name ?? "").trim(),
        channel_name: channelName.trim(),
        label: label.trim() || null,
        include_threads: true,
      }),
    onSuccess: () => {
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

  const canSubmit = manualMode
    ? guildName.trim().length > 0 && channelName.trim().length > 0
    : !!activeGuild && channelName.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discord Sources</h1>
          <p className="text-sm text-muted-foreground">
            Channels the listener captures.{" "}
            {hasInventory
              ? `Pulling from ${inventory.length} servers your account is in.`
              : "Listener hasn't synced its server list yet — falls back to manual entry."}
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
              if (!canSubmit) return;
              addMutation.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              {/* Server picker */}
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Server</span>
                {hasInventory && !manualMode ? (
                  <select
                    value={activeGuild?.guild_name ?? ""}
                    onChange={(e) => {
                      setGuildName(e.target.value);
                      setChannelName("");
                    }}
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-primary/60"
                  >
                    {inventory.map((g) => (
                      <option key={g.guild_id} value={g.guild_name}>
                        {g.guild_name} ({g.channels.length})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={guildName}
                    onChange={(e) => setGuildName(e.target.value)}
                    placeholder="Server name (exact)"
                    className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
                  />
                )}
              </label>

              {/* Channel picker */}
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Channel</span>
                {hasInventory && !manualMode && activeGuild ? (
                  <select
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="">— pick a channel —</option>
                    {activeGuild.channels
                      .filter((c) => !c.is_thread)
                      .map((c) => {
                        const taken = existingPairs.has(
                          `${activeGuild.guild_name.toLowerCase()}::${c.channel_name.toLowerCase()}`
                        );
                        return (
                          <option
                            key={c.channel_id}
                            value={c.channel_name}
                            disabled={taken}
                          >
                            #{c.channel_name}
                            {taken ? " (already added)" : ""}
                          </option>
                        );
                      })}
                  </select>
                ) : (
                  <input
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="channel-name (no #)"
                    className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
                  />
                )}
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="label (optional)"
                className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary/60"
              />
              <button
                type="submit"
                disabled={!canSubmit || addMutation.isPending}
                className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {addMutation.isPending ? "adding…" : "add source"}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setManualMode((v) => !v)}
                className="underline-offset-4 hover:underline"
              >
                {manualMode ? "← use dropdowns" : "type manually instead"}
              </button>
              {inventoryQuery.data?.refreshed_at && (
                <span>
                  inventory updated{" "}
                  {new Date(inventoryQuery.data.refreshed_at).toLocaleString()}
                </span>
              )}
            </div>

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
          {sourcesQuery.isLoading && <Skeleton className="h-32 w-full" />}
          {!sourcesQuery.isLoading &&
            (sourcesQuery.data?.sources.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                No sources configured yet — pick a server and channel above to
                get started. Threads under captured channels are included
                automatically.
              </p>
            )}
          {!sourcesQuery.isLoading &&
            (sourcesQuery.data?.sources.length ?? 0) > 0 && (
              <ul className="divide-y divide-border">
                {sourcesQuery.data!.sources.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {s.guild_name}{" "}
                        <span className="text-muted-foreground">/</span> #
                        {s.channel_name}
                      </div>
                      {s.label && (
                        <div className="text-xs text-muted-foreground">
                          {s.label}
                        </div>
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

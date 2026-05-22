"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { getSessionId } from "@/lib/session";
import type { CustomWatchlistResponse } from "@/lib/types";

// Portfolio-construction stub. Users add tickers; entries persist in
// custom_watchlist keyed by a browser session id. When real auth lands, the
// session_id column becomes user_id and the UI flow is unchanged.

export const CUSTOM_WATCHLIST_KEY = ["custom-watchlist"] as const;

export function useCustomWatchlist() {
  return useQuery<CustomWatchlistResponse>({
    queryKey: CUSTOM_WATCHLIST_KEY,
    queryFn: () => api.listCustomWatchlist(getSessionId()),
    enabled: typeof window !== "undefined",
  });
}

export function useAddToCustomWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticker, note }: { ticker: string; note?: string }) =>
      api.addToCustomWatchlist(getSessionId(), ticker, note),
    onSuccess: (res) => qc.setQueryData(CUSTOM_WATCHLIST_KEY, res),
  });
}

export function useRemoveFromCustomWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticker }: { ticker: string }) =>
      api.removeFromCustomWatchlist(getSessionId(), ticker),
    onSuccess: (res) => qc.setQueryData(CUSTOM_WATCHLIST_KEY, res),
  });
}

export function MyWatchlist() {
  const { data, error: loadError } = useCustomWatchlist();
  const add = useAddToCustomWatchlist();
  const remove = useRemoveFromCustomWatchlist();
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");

  const entries = data?.entries ?? [];
  const error =
    add.error?.message ?? remove.error?.message ?? (loadError as Error | null)?.message ?? null;

  async function submit() {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    await add.mutateAsync({ ticker: t, note: note.trim() || undefined });
    setTicker("");
    setNote("");
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <h3 className="mb-3 text-base font-medium">My watchlist</h3>
      <div className="mb-3 flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker"
          className="w-24 rounded border border-border bg-background px-2 py-1 text-sm uppercase"
          maxLength={12}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          maxLength={200}
        />
        <button
          type="button"
          onClick={submit}
          disabled={add.isPending || !ticker.trim()}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing tracked yet. Star a row in the screener or add a ticker above.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li
              key={e.ticker}
              className="flex items-center justify-between rounded border border-border/50 px-2 py-1"
            >
              <div>
                <span className="font-mono font-semibold">{e.ticker}</span>
                {e.note && <span className="ml-2 text-xs text-muted-foreground">{e.note}</span>}
              </div>
              <button
                type="button"
                onClick={() => remove.mutate({ ticker: e.ticker })}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

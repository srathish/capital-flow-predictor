"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSessionId } from "@/lib/session";
import type { CustomWatchlistEntry } from "@/lib/types";

// Minimal portfolio-construction stub. Users add tickers; entries persist in
// custom_watchlist keyed by a browser session id. When real auth lands, the
// session_id column becomes user_id and the UI flow is unchanged.

export function MyWatchlist() {
  const [entries, setEntries] = useState<CustomWatchlistEntry[]>([]);
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sid = getSessionId();
        if (!sid) return;
        const res = await api.listCustomWatchlist(sid);
        if (!cancelled) setEntries(res.entries);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function add() {
    setError(null);
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    try {
      const res = await api.addToCustomWatchlist(getSessionId(), t, note.trim() || undefined);
      setEntries(res.entries);
      setTicker("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "add failed");
    } finally {
      setLoading(false);
    }
  }

  async function remove(t: string) {
    setError(null);
    try {
      const res = await api.removeFromCustomWatchlist(getSessionId(), t);
      setEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "remove failed");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <h3 className="mb-3 text-base font-medium">My watchlist</h3>
      <div className="mb-3 flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker (e.g. NVDA)"
          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm uppercase"
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
          onClick={add}
          disabled={loading || !ticker.trim()}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing tracked yet. Add a ticker above — entries persist across reloads in this browser.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.ticker} className="flex items-center justify-between rounded border border-border/50 px-2 py-1">
              <div>
                <span className="font-mono font-semibold">{e.ticker}</span>
                {e.note && <span className="ml-2 text-xs text-muted-foreground">{e.note}</span>}
              </div>
              <button
                type="button"
                onClick={() => remove(e.ticker)}
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

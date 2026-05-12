"use client";

/**
 * GEX tab — mirrors the gexester-vexster Discord feed and exposes the
 * skylit.ai auth health + re-auth button.
 *
 * Data sources (all under /v1/* on the Bellwether API):
 *   GET  /v1/gex/feed                     — Discord embeds posted by gexester
 *   GET  /v1/skylit/status                — latest auth health row + rollup
 *   POST /v1/skylit/reauth/request        — queue a re-auth (UI button)
 *   GET  /v1/skylit/reauth/recent         — show last N requests + states
 *
 * Auto-refresh: feed every 30s, status + reauth list every 15s. Manual
 * refresh button is also present for the impatient.
 */

import * as React from "react";
import { baseUrl, authHeaders } from "@/lib/api";

// ---------- types matching cfp_api/routes/gex.py ----------

type FeedSource = "brief" | "monitor" | "scanner" | "decision" | "structure" | "other";

interface FeedField { name: string; value: string; inline: boolean; }
interface FeedItem {
  id: number;
  ts: string;
  source: FeedSource;
  title: string | null;
  description: string | null;
  fields: FeedField[];
  color: number | null;
  footer: string | null;
  tickers: string[];
}

type Health = "green" | "yellow" | "red" | "unknown";

interface SkylitStatus {
  posted_at: string | null;
  method: string | null;
  jwt_ttl_seconds: number | null;
  cookie_rotated_at: string | null;
  persist_ok: boolean | null;
  persist_error: string | null;
  sse_state: string | null;
  note: string | null;
  health: Health;
  health_reason: string;
}

interface ReauthItem {
  id: number;
  requested_at: string;
  requested_by: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  claimed_at: string | null;
  completed_at: string | null;
  result: string | null;
}

// ---------- fetch helpers ----------

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ---------- presentational helpers ----------

const HEALTH_BADGE: Record<Health, { dot: string; label: string; text: string }> = {
  green: { dot: "bg-emerald-500", label: "Healthy", text: "text-emerald-600 dark:text-emerald-400" },
  yellow: { dot: "bg-amber-500", label: "Stale", text: "text-amber-600 dark:text-amber-400" },
  red: { dot: "bg-red-500", label: "Broken", text: "text-red-600 dark:text-red-400" },
  unknown: { dot: "bg-slate-400", label: "Unknown", text: "text-slate-500" },
};

const SOURCE_LABEL: Record<FeedSource, string> = {
  brief: "Brief",
  monitor: "Monitor",
  scanner: "Scanner",
  decision: "Decision",
  structure: "Structure",
  other: "Other",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "in the future";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function colorBar(color: number | null): string {
  // Discord stores 0xRRGGBB as an integer. Map to a CSS hex; null = neutral.
  if (color === null) return "#6b7280";
  return "#" + color.toString(16).padStart(6, "0");
}

// ---------- subcomponents ----------

function StatusCard({
  status, recent, onReauth, reauthDisabled,
}: {
  status: SkylitStatus | null;
  recent: ReauthItem[];
  onReauth: () => Promise<void>;
  reauthDisabled: boolean;
}) {
  const badge = HEALTH_BADGE[status?.health ?? "unknown"];
  // Pending or in_progress request = something is in flight; surface so the
  // operator knows their button press registered without staring at the log.
  const inFlight = recent.find(r => r.status === "pending" || r.status === "in_progress");

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`inline-block h-3 w-3 rounded-full ${badge.dot}`} />
        <h2 className="text-sm font-semibold">
          skylit.ai auth{" "}
          <span className={badge.text}>{badge.label}</span>
        </h2>
        <button
          type="button"
          onClick={onReauth}
          disabled={reauthDisabled}
          className="ml-auto rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          Re-auth skylit
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{status?.health_reason ?? "loading..."}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Method</dt>
          <dd className="font-mono">{status?.method ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">JWT TTL</dt>
          <dd className="font-mono">
            {status?.jwt_ttl_seconds != null ? `${status.jwt_ttl_seconds}s` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cookie rotated</dt>
          <dd className="font-mono">{relativeTime(status?.cookie_rotated_at ?? null)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last heartbeat</dt>
          <dd className="font-mono">{relativeTime(status?.posted_at ?? null)}</dd>
        </div>
      </dl>
      {status?.persist_ok === false && (
        <p className="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          <strong>Persist failed:</strong> {status.persist_error || "unknown error"} — rotated cookie is in memory only; next restart will use the stale value.
        </p>
      )}
      {inFlight && (
        <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          Re-auth request #{inFlight.id} {inFlight.status === "pending" ? "queued — waiting for the local skylit-watch daemon to claim it" : "in progress — complete Discord OAuth in the browser window on your laptop"}.
        </p>
      )}
      {recent.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Recent re-auth requests ({recent.length})</summary>
          <ul className="mt-1 space-y-1">
            {recent.slice(0, 5).map(r => (
              <li key={r.id} className="font-mono">
                #{r.id} · {r.status} · {relativeTime(r.requested_at)}
                {r.result && <span className="text-muted-foreground"> — {r.result.slice(0, 80)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex">
        {/* Discord-style left color bar */}
        <div className="w-1.5 shrink-0" style={{ background: colorBar(item.color) }} />
        <div className="flex-1 p-4">
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {item.title && <h3 className="text-sm font-semibold">{item.title}</h3>}
            <span className="text-xs text-muted-foreground" title={item.ts}>{relativeTime(item.ts)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{SOURCE_LABEL[item.source]}</span>
            {item.tickers.map(t => (
              <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-mono text-primary">{t}</span>
            ))}
          </header>
          {item.description && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{item.description}</p>
          )}
          {item.fields.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {item.fields.map((f, i) => (
                <div key={i} className={f.inline ? "" : "sm:col-span-2"}>
                  {f.name && f.name !== "​" && (
                    <div className="text-xs font-semibold text-foreground/80">{f.name}</div>
                  )}
                  <div className="whitespace-pre-wrap text-xs text-foreground/90">{f.value}</div>
                </div>
              ))}
            </div>
          )}
          {item.footer && (
            <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{item.footer}</p>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------- main page ----------

const SOURCE_FILTERS: { value: FeedSource | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "brief", label: "Brief" },
  { value: "monitor", label: "Monitor" },
  { value: "scanner", label: "Scanner" },
  { value: "decision", label: "Decision" },
];

export default function GexPage() {
  const [feed, setFeed] = React.useState<FeedItem[]>([]);
  const [status, setStatus] = React.useState<SkylitStatus | null>(null);
  const [recent, setRecent] = React.useState<ReauthItem[]>([]);
  const [feedError, setFeedError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FeedSource | "all">("all");
  const [tickerFilter, setTickerFilter] = React.useState<string>("");
  const [reauthBusy, setReauthBusy] = React.useState(false);

  const loadFeed = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("source", filter);
      if (tickerFilter) params.set("ticker", tickerFilter);
      const data = await fetchJson<{ items: FeedItem[]; n: number }>(`/v1/gex/feed?${params}`);
      setFeed(data.items);
      setFeedError(null);
    } catch (e: unknown) {
      setFeedError(e instanceof Error ? e.message : "feed load failed");
    }
  }, [filter, tickerFilter]);

  const loadStatus = React.useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        fetchJson<SkylitStatus>("/v1/skylit/status"),
        fetchJson<ReauthItem[]>("/v1/skylit/reauth/recent?limit=10"),
      ]);
      setStatus(s);
      setRecent(r);
    } catch {
      // Status fetch failure is non-fatal; the badge falls back to "unknown".
      // Don't surface the error — the feed pane already handles the API-down case.
    }
  }, []);

  const onReauth = React.useCallback(async () => {
    setReauthBusy(true);
    try {
      await fetchJson<ReauthItem>("/v1/skylit/reauth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by: "ui_button" }),
      });
      // Refresh immediately so the operator sees their request appear.
      await loadStatus();
    } catch (e) {
      alert(`Failed to queue re-auth: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setReauthBusy(false);
    }
  }, [loadStatus]);

  // Initial load + auto-refresh. Two separate intervals so a slow feed query
  // doesn't delay status updates (and vice versa).
  React.useEffect(() => {
    loadFeed();
    const t = setInterval(loadFeed, 30_000);
    return () => clearInterval(t);
  }, [loadFeed]);

  React.useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 15_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <StatusCard
        status={status}
        recent={recent}
        onReauth={onReauth}
        reauthDisabled={reauthBusy}
      />

      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Source</span>
          {SOURCE_FILTERS.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setFilter(s.value)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                filter === s.value
                  ? "bg-primary text-white"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-3 text-xs font-medium text-muted-foreground">Ticker</span>
          <input
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="SPY"
            className="h-7 w-20 rounded-full border bg-background px-2 text-xs font-mono outline-none focus:border-primary/60"
          />
          <button
            type="button"
            onClick={() => loadFeed()}
            className="ml-auto rounded-full bg-muted px-3 py-1 text-xs hover:bg-muted/70"
          >
            Refresh
          </button>
        </div>
      </div>

      {feedError && (
        <div className="rounded-md bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          Feed load failed: {feedError}
        </div>
      )}

      {feed.length === 0 && !feedError && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {status?.health === "red" ? (
            <>skylit auth is broken — fix it before market open.</>
          ) : status?.health === "yellow" ? (
            <>
              The gex service hasn&apos;t reported in a while. Check the Railway
              service logs.
            </>
          ) : (
            <>
              Morning briefs auto-fire at <span className="font-mono">09:31 ET</span>{" "}
              on NYSE trading days. Intraday updates post here when something
              material changes for SPY / QQQ / SPXW — king node flip, regime
              cross, floor or ceiling break, structural divergence. Nothing
              has fired today yet; sit tight.
            </>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {feed.map(item => (
          <li key={item.id}>
            <FeedCard item={item} />
          </li>
        ))}
      </ul>
    </main>
  );
}

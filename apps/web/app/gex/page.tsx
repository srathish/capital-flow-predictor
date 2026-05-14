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

// Group items by NYSE trading day (ET calendar date of item.ts). Cards from
// catch-up firings + the brief + on-time monitors all land under the same
// day. Returns groups in newest-first order. Each new trading day naturally
// starts a fresh section above; older sessions collapse behind a toggle so
// the feed doesn't accumulate as an endless wall.
const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ET_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function etTradingDay(iso: string): string {
  // Returns ISO YYYY-MM-DD in ET. Intl's en-US format is MM/DD/YYYY → reorder.
  const parts = ET_FORMATTER.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function etTradingDayLabel(day: string): string {
  // Render a YYYY-MM-DD as "Wed, May 14". Today gets the "Today" label.
  const today = etTradingDay(new Date().toISOString());
  if (day === today) return "Today";
  // Yesterday detection — subtract one ET-day from today.
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (day === etTradingDay(yesterdayDate.toISOString())) return "Yesterday";
  // Parse YYYY-MM-DD as ET noon to avoid TZ ambiguity at midnight boundaries.
  return ET_LABEL_FORMATTER.format(new Date(`${day}T12:00:00-04:00`));
}

function groupFeedByDay(items: FeedItem[]): { day: string; label: string; items: FeedItem[] }[] {
  const byDay = new Map<string, FeedItem[]>();
  for (const it of items) {
    const day = etTradingDay(it.ts);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(it);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))  // newest day first
    .map(([day, items]) => ({ day, label: etTradingDayLabel(day), items }));
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
        <a
          href="/gex/accuracy"
          className="ml-auto rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Plan accuracy →
        </a>
        <button
          type="button"
          onClick={onReauth}
          disabled={reauthDisabled}
          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
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

function FeedDaySection({
  label, items, defaultOpen,
}: {
  label: string; items: FeedItem[]; defaultOpen: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer select-none items-baseline gap-2 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <span className="transition-transform group-open:rotate-90">▸</span>
        <span className="font-semibold">{label}</span>
        <span className="text-[10px] normal-case tracking-normal">
          ({items.length} {items.length === 1 ? "entry" : "entries"})
        </span>
      </summary>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <FeedCard item={item} />
          </li>
        ))}
      </ul>
    </details>
  );
}

// Next 09:31 ET brief, computed live. Returns the Date object so consumers
// can format it however they want. Skips weekends — Sat → Mon, Sun → Mon.
// Holidays are NOT honored (no NYSE calendar locally); the banner just
// shows "waiting for next brief" without claiming an exact day.
function nextBrief931Et(now: Date = new Date()): Date {
  // Construct "today 09:31 America/New_York" in absolute UTC terms by going
  // through Intl. Easier than manual DST math.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const etDate = `${get("year")}-${get("month")}-${get("day")}`;
  // Build the candidate as ET 09:31 today. Naive parse with the ET offset
  // would mishandle DST around the transition. Use the same Intl machinery
  // to project: take today's ET date, find what UTC instant maps to 09:31 ET.
  const candidate = new Date(`${etDate}T09:31:00-04:00`);
  // Verify the candidate actually IS 09:31 ET — adjust for DST if not.
  const checkFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const checkParts = checkFmt.formatToParts(candidate);
  const checkHour = parseInt(checkParts.find((p) => p.type === "hour")?.value || "0", 10);
  let target = candidate;
  if (checkHour !== 9) {
    // Off by one — DST in effect, retry with -05:00
    target = new Date(`${etDate}T09:31:00-05:00`);
  }
  // If 09:31 ET has already passed today, advance to next weekday.
  if (target.getTime() <= now.getTime()) {
    target = new Date(target.getTime());
    do {
      target.setUTCDate(target.getUTCDate() + 1);
    } while (target.getUTCDay() === 0 || target.getUTCDay() === 6);
  } else {
    // 09:31 ET today is in the future — but today might still be a weekend.
    while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
  }
  return target;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "any moment now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function BriefCountdown() {
  // Tick every 15s — the brief itself only fires once per trading day, so
  // sub-second precision isn't useful and would needlessly re-render.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const target = nextBrief931Et(now);
  const ms = target.getTime() - now.getTime();
  // Friendly day label for the target — "today", "tomorrow", or weekday.
  const todayEt = etTradingDay(now.toISOString());
  const targetEt = etTradingDay(target.toISOString());
  const dayWord =
    targetEt === todayEt
      ? "today"
      : (() => {
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          return targetEt === etTradingDay(tomorrow.toISOString())
            ? "tomorrow"
            : new Intl.DateTimeFormat("en-US", {
                timeZone: "America/New_York",
                weekday: "long",
              }).format(target);
        })();
  const targetTimeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          Waiting for the {dayWord} morning brief
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          fires at <span className="text-foreground">{targetTimeLabel} ET</span>
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        gexester pushes the day's GEX-structured plan{" "}
        <span className="font-mono text-foreground">in {formatCountdown(ms)}</span>.
        The card will appear here automatically — no refresh needed.
      </p>
    </div>
  );
}

function GroupedFeed({ items }: { items: FeedItem[] }) {
  const groups = React.useMemo(() => groupFeedByDay(items), [items]);
  // Always anchor on the *real* ET trading day, not just whatever's newest in
  // the feed. Before the 09:31 brief fires, the freshest entries will be
  // yesterday's — without this we'd auto-expand yesterday as if it were today.
  const todayKey = etTradingDay(new Date().toISOString());
  const todayGroup = groups.find((g) => g.day === todayKey);
  const older = groups.filter((g) => g.day !== todayKey);
  const olderTotal = older.reduce((n, g) => n + g.items.length, 0);
  const todayIsEmpty = !todayGroup || todayGroup.items.length === 0;

  return (
    <div className="space-y-3">
      {todayIsEmpty ? (
        <BriefCountdown />
      ) : (
        <FeedDaySection label="Today" items={todayGroup!.items} defaultOpen />
      )}
      {older.length > 0 && (
        <details className="rounded-xl border bg-card/40 p-3">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            ▸ Previous sessions ({older.length} day{older.length === 1 ? "" : "s"},{" "}
            {olderTotal} {olderTotal === 1 ? "entry" : "entries"})
          </summary>
          <div className="mt-3 space-y-4">
            {older.map((g) => (
              <FeedDaySection
                key={g.day}
                label={g.label}
                items={g.items}
                defaultOpen={false}
              />
            ))}
          </div>
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

      {/* Auth/service-health errors get a banner above the feed so the
          countdown doesn't lie about a brief that won't actually fire. The
          empty-feed case itself is handled inside GroupedFeed via the
          BriefCountdown component. */}
      {!feedError && status?.health === "red" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          skylit auth is broken — the brief won&apos;t fire until you re-auth.
          Click <strong>Re-auth skylit</strong> above before market open.
        </div>
      )}
      {!feedError && status?.health === "yellow" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          The gex service hasn&apos;t reported in a while. The brief may be
          delayed — check the Railway service logs.
        </div>
      )}

      <GroupedFeed items={feed} />
    </main>
  );
}

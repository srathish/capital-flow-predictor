"use client";

/**
 * GEX accuracy tab — Level 1 plan-outcome scorecard.
 *
 * Reads /v1/gex/scorecard, which aggregates gex_plan_outcomes (populated by
 * the nightly `cfp-jobs score-gex-plans` job). Shows hit rate, mean realized
 * vs predicted R:R, and a recent-plays table cross-checking each brief /
 * monitor CALL/PUT against actual SPY/QQQ/SPXW intraday tape.
 */

import * as React from "react";
import Link from "next/link";
import { baseUrl, authHeaders } from "@/lib/api";

interface Bucket {
  label: string;
  n_total: number;
  n_resolved: number;
  n_pending: number;
  n_target: number;
  n_stop: number;
  n_expired: number;
  n_never_entered: number;
  hit_rate: number | null;
  mean_realized_rr: number | null;
  mean_predicted_rr: number | null;
  rr_ratio: number | null;
}

interface Play {
  feed_id: number;
  posted_at: string;
  trading_day: string | null;
  ticker: string;
  source: string;
  side: string;
  break_level: number;
  target: number;
  stop: number;
  predicted_rr: number | null;
  entered_at: string | null;
  exited_at: string | null;
  exit_reason: string;
  realized_rr: number | null;
  day_high: number | null;
  day_low: number | null;
  day_close: number | null;
}

interface Scorecard {
  since: string;
  overall: Bucket;
  by_ticker: Bucket[];
  by_source: Bucket[];
  by_side: Bucket[];
  recent: Play[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

function fmtPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function fmtRr(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

function fmtPrice(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const EXIT_TINT: Record<string, string> = {
  target: "text-emerald-600 dark:text-emerald-400",
  stop: "text-red-600 dark:text-red-400",
  expired: "text-amber-600 dark:text-amber-400",
  pending: "text-slate-400",
};

function BucketTable({ title, buckets }: { title: string; buckets: Bucket[] }) {
  if (!buckets.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Group</th>
              <th className="py-1 pr-3 text-right">N</th>
              <th className="py-1 pr-3 text-right">Hit</th>
              <th className="py-1 pr-3 text-right">Pending</th>
              <th className="py-1 pr-3 text-right">Hit rate</th>
              <th className="py-1 pr-3 text-right">Pred R:R</th>
              <th className="py-1 pr-3 text-right">Real R:R</th>
              <th className="py-1 pr-3 text-right">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label} className="border-t border-border/40">
                <td className="py-1.5 pr-3 font-medium">{b.label || "—"}</td>
                <td className="py-1.5 pr-3 text-right">{b.n_total}</td>
                <td className="py-1.5 pr-3 text-right text-emerald-600 dark:text-emerald-400">{b.n_target}</td>
                <td className="py-1.5 pr-3 text-right text-slate-400">{b.n_pending}</td>
                <td className="py-1.5 pr-3 text-right">{fmtPct(b.hit_rate)}</td>
                <td className="py-1.5 pr-3 text-right">{fmtRr(b.mean_predicted_rr)}</td>
                <td className="py-1.5 pr-3 text-right">{fmtRr(b.mean_realized_rr)}</td>
                <td className="py-1.5 pr-3 text-right">{fmtRr(b.rr_ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AccuracyPage() {
  const [days, setDays] = React.useState<number>(30);
  const [data, setData] = React.useState<Scorecard | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchJson<Scorecard>(`/v1/gex/scorecard?days=${days}&limit_recent=80`)
      .then((d) => {
        if (alive) {
          setData(d);
          setErr(null);
        }
      })
      .catch((e: Error) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [days]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/gex" className="hover:underline">← GEX feed</Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan accuracy</h1>
          <p className="text-sm text-muted-foreground">
            Did the brief and monitor CALLS / PUTS actually play out? Each plan is
            replayed against SPY / QQQ / SPXW intraday tape: did spot cross the break
            level, then did target hit before stop?
          </p>
        </div>
        <select
          className="h-9 rounded-full border border-border bg-card px-3 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          {err}
        </div>
      )}
      {loading && !data && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Plans seen" value={String(data.overall.n_total)} />
            <Stat
              label="Hit rate"
              value={fmtPct(data.overall.hit_rate)}
              sub={`${data.overall.n_target} target · ${data.overall.n_stop} stop · ${data.overall.n_expired} expired`}
            />
            <Stat
              label="Mean realized R:R"
              value={fmtRr(data.overall.mean_realized_rr)}
              sub={`predicted avg ${fmtRr(data.overall.mean_predicted_rr)}`}
            />
            <Stat
              label="Never entered"
              value={String(data.overall.n_never_entered)}
              sub="break level not crossed"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <BucketTable title="By ticker" buckets={data.by_ticker} />
            <BucketTable title="By source" buckets={data.by_source} />
            <BucketTable title="By side" buckets={data.by_side} />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent plays
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Posted</th>
                    <th className="py-1 pr-3">Ticker</th>
                    <th className="py-1 pr-3">Src</th>
                    <th className="py-1 pr-3">Side</th>
                    <th className="py-1 pr-3 text-right">Break</th>
                    <th className="py-1 pr-3 text-right">Target</th>
                    <th className="py-1 pr-3 text-right">Stop</th>
                    <th className="py-1 pr-3 text-right">Day H/L</th>
                    <th className="py-1 pr-3">Outcome</th>
                    <th className="py-1 pr-3 text-right">R:R</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((p) => {
                    const tint = EXIT_TINT[p.exit_reason] ?? "";
                    const posted = new Date(p.posted_at);
                    return (
                      <tr key={`${p.feed_id}-${p.ticker}-${p.side}`} className="border-t border-border/40">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                          {posted.toLocaleDateString()} {posted.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-1.5 pr-3 font-medium">{p.ticker}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{p.source}</td>
                        <td className={`py-1.5 pr-3 font-medium ${p.side === "CALLS" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{p.side}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtPrice(p.break_level)}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtPrice(p.target)}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtPrice(p.stop)}</td>
                        <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground">
                          {fmtPrice(p.day_high)} / {fmtPrice(p.day_low)}
                        </td>
                        <td className={`py-1.5 pr-3 font-medium ${tint}`}>{p.exit_reason}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtRr(p.realized_rr)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.recent.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No plans scored yet. Run <code className="rounded bg-muted px-1">cfp-jobs score-gex-plans</code> after a brief / monitor posts.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

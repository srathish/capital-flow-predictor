"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FlowMover } from "@/lib/types";

// Market-wide top gainers / losers / most-active from UW's /market/movers.
// Compact 3-column panel that lives above the unusual feed — gives the user
// a "what's moving right now" launchpad alongside the anomaly feed.

const REFETCH_MS = 60_000;

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(2)}%`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function MoversColumn({ title, rows, accent }: { title: string; rows: FlowMover[]; accent: string }) {
  return (
    <div className="rounded border border-border/50 p-2">
      <div className={`mb-1 text-xs font-medium uppercase tracking-wide ${accent}`}>{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">no data</div>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.ticker} className="border-t border-border/40 first:border-0">
                <td className="py-1 font-mono">{r.ticker}</td>
                <td className="py-1 text-right text-muted-foreground">{fmtPrice(r.price)}</td>
                <td className={`py-1 text-right font-mono ${accent}`}>{fmtPct(r.change_percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function FlowMoversPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["flow-movers"],
    queryFn: () => api.flowMovers(10),
    refetchInterval: REFETCH_MS,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded border border-border/50 p-3 text-xs text-muted-foreground">
        Loading market movers…
      </div>
    );
  }

  // If everything's empty (no ingest has run yet), suppress the panel rather
  // than show three blank columns. The flow tab stays useful without it.
  const total =
    data.top_gainers.length + data.top_losers.length + data.most_active.length;
  if (total === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <MoversColumn title="Top gainers" rows={data.top_gainers} accent="text-emerald-300" />
      <MoversColumn title="Top losers" rows={data.top_losers} accent="text-rose-300" />
      <MoversColumn title="Most active" rows={data.most_active} accent="text-amber-300" />
    </div>
  );
}

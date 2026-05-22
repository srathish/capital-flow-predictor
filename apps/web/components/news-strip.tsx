"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const REFETCH_MS = 60_000;

function formatRelative(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function sentimentTone(s: number | null): string {
  if (s == null) return "text-muted-foreground";
  if (s >= 0.3) return "text-emerald-400";
  if (s <= -0.3) return "text-rose-400";
  return "text-muted-foreground";
}

// Breaking-news strip powered by uw_news_global. Auto-hides when empty.
// Collapsible — defaults to top 5 visible, click "show more" to expand.
// Each row links out to the source URL; ticker chips open the Dossier.
export function NewsStrip({ openDossier }: { openDossier?: (t: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["news-global"],
    queryFn: () => api.newsGlobal({ lookbackMinutes: 180, limit: 50 }),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
  });
  // On /flow we only want flow-relevant news — headlines tagged with at
  // least one ticker. Untagged macro/political chatter (Fed speeches, House
  // investigations, etc.) belongs on /reddit Catalysts, not here.
  const items = useMemo(
    () => (data?.items ?? []).filter((n) => (n.tickers?.length ?? 0) > 0),
    [data],
  );
  const visible = useMemo(() => (expanded ? items : items.slice(0, 5)), [items, expanded]);
  if (items.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-medium uppercase tracking-wider text-foreground/80">
          📰 Breaking news <span className="text-muted-foreground">· last 3h</span>
        </span>
        <span className="text-[10px] text-muted-foreground">{items.length} headlines</span>
      </div>
      <ul className="space-y-1.5 text-xs">
        {visible.map((n) => (
          <li
            key={n.article_id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/30 pb-1 last:border-0"
          >
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatRelative(n.published_at)}
            </span>
            {n.tickers.slice(0, 4).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => openDossier?.(t)}
                className="rounded-full bg-primary/15 px-1.5 py-0 text-[10px] font-semibold text-primary hover:bg-primary/25"
              >
                {t}
              </button>
            ))}
            {n.url ? (
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("flex-1 text-foreground/90 hover:text-primary", sentimentTone(n.sentiment))}
              >
                {n.headline ?? "(no headline)"}
              </a>
            ) : (
              <span className={cn("flex-1", sentimentTone(n.sentiment))}>
                {n.headline ?? "(no headline)"}
              </span>
            )}
            {n.source && (
              <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                {n.source}
              </span>
            )}
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "show less" : `show ${items.length - 5} more`}
        </button>
      )}
    </div>
  );
}

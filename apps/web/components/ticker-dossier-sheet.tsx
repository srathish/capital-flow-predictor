"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Sheet } from "@/components/ui/sheet";
import { FlowAggregateBody } from "@/components/flow-aggregate-panel";
import { Skeleton } from "@/components/ui/skeleton";

// Slide-over Dossier opened from the Pulse tape (or anywhere else a ticker
// surfaces). Reuses the FlowAggregateBody renderer so the UI matches what
// /lab and the standalone aggregate panel already show. Auto-fetches when
// `ticker` changes; the parent controls open/close.

export interface TickerDossierSheetProps {
  ticker: string | null;
  open: boolean;
  onClose: () => void;
}

export function TickerDossierSheet({ ticker, open, onClose }: TickerDossierSheetProps) {
  const sym = (ticker ?? "").trim().toUpperCase();
  const enabled = open && sym.length > 0;

  const aggQuery = useQuery({
    queryKey: ["dossier-aggregate", sym],
    queryFn: () => api.flowAggregate(sym),
    enabled,
    staleTime: 60_000,
  });

  const playsQuery = useQuery({
    queryKey: ["dossier-plays", sym],
    queryFn: () => api.flowSuggestPlays(sym, 3).catch(() => null),
    enabled,
    staleTime: 60_000,
  });

  const data = aggQuery.data;
  const suggest = playsQuery.data ?? null;
  const verdict = data?.verdict;
  const verdictTone =
    verdict === "bullish"
      ? "text-green-300"
      : verdict === "bearish"
        ? "text-rose-300"
        : "text-muted-foreground";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-lg">{sym || "—"}</span>
          {data && (
            <span className={`text-xs uppercase tracking-wide ${verdictTone}`}>
              {data.verdict}
            </span>
          )}
          {data && (
            <span className="font-mono text-xs text-muted-foreground">
              {data.bullish_score >= 0 ? "+" : ""}
              {data.bullish_score.toFixed(2)}
            </span>
          )}
        </span>
      }
      subtitle={data ? data.coverage_summary : "Loading aggregate flow data…"}
    >
      {aggQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {aggQuery.isError && (
        <p className="text-sm text-rose-400">
          Failed to load dossier for {sym}:{" "}
          {(aggQuery.error as Error)?.message ?? "unknown error"}
        </p>
      )}
      {data && <FlowAggregateBody data={data} suggest={suggest} />}
    </Sheet>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { HoldingsSort } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Column = {
  key: HoldingsSort;
  label: string;
  format: (v: number | null | undefined) => string;
  /** Color value by sign (returns) */
  signed?: boolean;
  align?: "left" | "right";
};

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
// Weight comes from UW pre-multiplied by 100 (so 14.73 means 14.73%, not 1473%).
// Don't run it through fmtPct or it double-scales.
const fmtWeight = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toFixed(2)}%`;
const fmtRatio = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toFixed(2);

const COLUMNS: Column[] = [
  { key: "ticker", label: "Ticker", format: (v) => String(v ?? "—"), align: "left" },
  { key: "weight", label: "Weight", format: fmtWeight, align: "right" },
  { key: "return_1d", label: "1D", format: fmtPct, signed: true, align: "right" },
  { key: "return_5d", label: "5D", format: fmtPct, signed: true, align: "right" },
  { key: "return_20d", label: "20D", format: fmtPct, signed: true, align: "right" },
  { key: "return_60d", label: "60D", format: fmtPct, signed: true, align: "right" },
  { key: "pct_off_52w_high", label: "Off 52W H", format: fmtPct, signed: true, align: "right" },
  { key: "volume_z", label: "Vol vs 30D", format: fmtPct, signed: true, align: "right" },
  { key: "call_put_ratio", label: "Call/Put", format: fmtRatio, align: "right" },
  { key: "bullish_pct", label: "Bullish $", format: fmtPct, align: "right" },
];

export function SectorHoldingsView({ etf }: { etf: string }) {
  const upper = etf.toUpperCase();
  const [sort, setSort] = useState<HoldingsSort>("weight");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const { data, isLoading, error } = useQuery({
    queryKey: ["etf-holdings", upper, sort, direction],
    queryFn: () => api.etfHoldings(upper, sort, direction),
    retry: false,
  });

  function toggleSort(key: HoldingsSort) {
    if (key === sort) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDirection(key === "ticker" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No holdings ingested for <span className="font-mono">{upper}</span>. Run{" "}
          <code className="rounded bg-muted px-1">cfp-jobs flow-holdings --etfs {upper}</code> on the backend.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{upper}</h1>
          <p className="text-sm text-muted-foreground">
            {data.n_holdings} holdings
            {data.last_updated && <> · refreshed {formatDate(data.last_updated)}</>}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          ← Sectors
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  {COLUMNS.map((c) => {
                    const active = c.key === sort;
                    return (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "cursor-pointer select-none px-3 py-2",
                          c.align === "right" ? "text-right" : "text-left",
                          active ? "text-foreground" : "hover:text-foreground"
                        )}
                      >
                        {c.label}
                        {active && <span className="ml-1">{direction === "desc" ? "↓" : "↑"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.ticker} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                    {COLUMNS.map((c) => {
                      const value = (h as unknown as Record<string, number | string | null>)[c.key];
                      const numericValue = typeof value === "number" ? value : null;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 py-2",
                            c.align === "right" ? "text-right" : "text-left",
                            c.key === "ticker" ? "font-medium" : "num"
                          )}
                        >
                          {c.key === "ticker" ? (
                            <Link
                              href={`/agents/${encodeURIComponent(String(value))}`}
                              className="hover:text-primary"
                            >
                              {String(value)}
                              {h.short_name && (
                                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                                  {h.short_name}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <span
                              className={cn(
                                c.signed && numericValue !== null && numericValue > 0 && "text-signal-bullish",
                                c.signed && numericValue !== null && numericValue < 0 && "text-signal-bearish"
                              )}
                            >
                              {c.format(numericValue)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

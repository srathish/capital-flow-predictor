"use client";

import { cn } from "@/lib/utils";

export const TIME_RANGES = ["1W", "1M", "3M", "6M", "1Y", "ALL"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const RANGE_TO_DAYS: Record<TimeRange, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  ALL: 720,
};

/** Robinhood-style time-period selector: muted gray inactive, solid green pill active. */
export function TimeRangeTabs({
  value,
  onChange,
  className,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 text-xs", className)}>
      {TIME_RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={cn(
              "rounded-full px-3 py-1 font-semibold transition-colors",
              active
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

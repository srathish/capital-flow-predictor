import { cn } from "@/lib/utils";

/** Robinhood-style change pill: ▲ +$X.XX (+Y.YY%) in solid green / red. */
export function TrendPill({
  value,
  pct,
  size = "md",
  className,
}: {
  value?: number | null;
  pct?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const main = pct ?? value ?? 0;
  const positive = main > 0;
  const negative = main < 0;
  const arrow = positive ? "▲" : negative ? "▼" : "■";
  const sizeClass = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  }[size];

  const v =
    value === null || value === undefined
      ? null
      : `${value >= 0 ? "+" : ""}$${Math.abs(value).toFixed(2)}`;
  const p =
    pct === null || pct === undefined
      ? null
      : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular-nums",
        positive && "bg-signal-bullish text-white",
        negative && "bg-signal-bearish text-white",
        !positive && !negative && "bg-muted text-muted-foreground",
        sizeClass,
        className
      )}
    >
      <span>{arrow}</span>
      {v && <span>{v}</span>}
      {p && (v ? <span>({p})</span> : <span>{p}</span>)}
    </span>
  );
}

/** Inline (no pill background) version for places where a pill is too heavy.
 *  Just colored text + arrow. */
export function TrendInline({
  value,
  pct,
  className,
}: {
  value?: number | null;
  pct?: number | null;
  className?: string;
}) {
  const main = pct ?? value ?? 0;
  const positive = main > 0;
  const negative = main < 0;
  const arrow = positive ? "▲" : negative ? "▼" : "■";

  const v =
    value === null || value === undefined
      ? null
      : `${value >= 0 ? "+" : ""}$${Math.abs(value).toFixed(2)}`;
  const p =
    pct === null || pct === undefined
      ? null
      : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold tabular-nums",
        positive && "text-signal-bullish",
        negative && "text-signal-bearish",
        !positive && !negative && "text-muted-foreground",
        className
      )}
    >
      <span>{arrow}</span>
      {v && <span>{v}</span>}
      {p && (v ? <span>({p})</span> : <span>{p}</span>)}
    </span>
  );
}

import { cn } from "@/lib/utils";

export function ConfidenceBar({
  value,
  signal,
  className,
}: {
  value: number;
  signal: "bullish" | "bearish" | "neutral";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    signal === "bullish"
      ? "bg-signal-bullish"
      : signal === "bearish"
      ? "bg-signal-bearish"
      : "bg-signal-neutral";

  return (
    <div className={cn("h-1.5 w-full rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

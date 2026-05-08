import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-tight",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        outline: "border border-border text-foreground",
        bullish: "bg-signal-bullish text-white",
        bearish: "bg-signal-bearish text-white",
        neutral: "bg-muted text-muted-foreground",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export type SignalBadgeKind = "bullish" | "bearish" | "neutral";

export function SignalBadge({
  signal,
  className,
}: {
  signal: SignalBadgeKind | "long" | "short" | "avoid";
  className?: string;
}) {
  // Watchlist signals map to the same color buckets as agent signals.
  const variantMap: Record<string, "bullish" | "bearish" | "neutral"> = {
    bullish: "bullish",
    bearish: "bearish",
    neutral: "neutral",
    long: "bullish",
    short: "bearish",
    avoid: "neutral",
  };
  return (
    <Badge variant={variantMap[signal] ?? "muted"} className={className}>
      {signal}
    </Badge>
  );
}

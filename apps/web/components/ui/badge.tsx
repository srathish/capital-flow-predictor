import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        outline: "border-border text-foreground",
        bullish: "border-transparent bg-signal-bullish/15 text-signal-bullish",
        bearish: "border-transparent bg-signal-bearish/15 text-signal-bearish",
        neutral: "border-transparent bg-signal-neutral/15 text-signal-neutral",
        muted: "border-transparent bg-muted text-muted-foreground",
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

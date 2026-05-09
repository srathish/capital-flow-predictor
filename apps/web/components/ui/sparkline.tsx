/** Tiny inline sparkline. Pure SVG — no chart library overhead. Color is
 *  derived from first vs last value (green if up, red if down). */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: (number | null | undefined)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const cleaned = values
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
    .filter((v): v is number => v !== null);
  if (cleaned.length < 2) {
    return <svg width={width} height={height} className={className} />;
  }

  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  const span = max - min || 1;

  const stride = width / (cleaned.length - 1);
  const points = cleaned.map((v, i) => {
    const x = i * stride;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const up = cleaned[cleaned.length - 1] >= cleaned[0];
  const stroke = up ? "hsl(var(--signal-bullish))" : "hsl(var(--signal-bearish))";

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.join(" ")}
      />
    </svg>
  );
}

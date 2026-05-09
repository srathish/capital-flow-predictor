"use client";

import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarkerBar,
  type SeriesMarkerBarPosition,
  type SeriesMarkerShape,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { ChartDataResponse, ChartMarkerType } from "@/lib/types";

const MARKER_STYLES: Record<
  ChartMarkerType,
  { color: string; shape: SeriesMarkerShape; position: SeriesMarkerBarPosition; abbr: string }
> = {
  flow_call: { color: "#00C805", shape: "arrowUp", position: "belowBar", abbr: "C" },
  flow_put: { color: "#FF5000", shape: "arrowDown", position: "aboveBar", abbr: "P" },
  insider_buy: { color: "#22d3ee", shape: "circle", position: "belowBar", abbr: "B" },
  insider_sell: { color: "#fb923c", shape: "circle", position: "aboveBar", abbr: "S" },
  earnings: { color: "#a78bfa", shape: "square", position: "aboveBar", abbr: "E" },
};

function toUnix(ts: string): Time {
  // lightweight-charts expects whole-second UTC timestamps for time axis.
  return Math.floor(new Date(ts).getTime() / 1000) as Time;
}

function ma(values: { value: number; time: Time }[], window: number) {
  if (values.length < window) return [];
  const out: { time: Time; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i].value;
    if (i >= window) sum -= values[i - window].value;
    if (i >= window - 1) {
      out.push({ time: values[i].time, value: sum / window });
    }
  }
  return out;
}

export function PriceChart({ data, height = 360 }: { data: ChartDataResponse; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#9c9ca5",
        fontFamily: "var(--font-jb-mono), ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "#222226" },
      timeScale: { borderColor: "#222226", timeVisible: false, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const candle: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: "#00C805",
      downColor: "#FF5000",
      wickUpColor: "#00C805",
      wickDownColor: "#FF5000",
      borderVisible: false,
    });
    const ma50: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma200: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volume: ISeriesApi<"Histogram"> = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(156,156,165,0.4)",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const sortedBars = [...data.bars].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );

    const candleData = sortedBars
      .filter((b) => b.open !== null && b.high !== null && b.low !== null && b.close !== null)
      .map((b) => ({
        time: toUnix(b.ts),
        open: b.open as number,
        high: b.high as number,
        low: b.low as number,
        close: b.close as number,
      }));

    const closesForMa = sortedBars
      .filter((b) => b.close !== null)
      .map((b) => ({ time: toUnix(b.ts), value: b.close as number }));

    const volData = sortedBars
      .filter((b) => b.volume !== null)
      .map((b) => ({
        time: toUnix(b.ts),
        value: b.volume as number,
        color:
          b.close !== null && b.open !== null && b.close >= b.open
            ? "rgba(0,200,5,0.35)"
            : "rgba(255,80,0,0.35)",
      }));

    candle.setData(candleData);
    ma50.setData(ma(closesForMa, 50));
    ma200.setData(ma(closesForMa, 200));
    volume.setData(volData);

    // Markers — flow + insider + earnings as above/below-bar arrows.
    // (v5: use createSeriesMarkers; series.setMarkers is gone.)
    const markers: SeriesMarkerBar<Time>[] = data.markers.map((m) => {
      const style = MARKER_STYLES[m.type];
      return {
        time: toUnix(m.ts),
        position: style.position,
        color: style.color,
        shape: style.shape,
        text: style.abbr,
      };
    });
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(candle, markers);

    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);
    onResize();

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full overflow-hidden rounded-2xl border border-border bg-card" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#60a5fa]" /> MA50</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#a78bfa]" /> MA200</span>
        <span className="flex items-center gap-1"><span className="text-[#00C805]">▲</span> Call sweep ($&gt;1M)</span>
        <span className="flex items-center gap-1"><span className="text-[#FF5000]">▼</span> Put sweep</span>
        <span className="flex items-center gap-1"><span className="text-[#22d3ee]">●</span> Insider buy</span>
        <span className="flex items-center gap-1"><span className="text-[#fb923c]">●</span> Insider sell</span>
        <span className="flex items-center gap-1"><span className="text-[#a78bfa]">■</span> Earnings</span>
      </div>
    </div>
  );
}

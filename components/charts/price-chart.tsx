"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@/lib/api/contracts";

function readVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function PriceChart({
  candles,
  height = 320,
  showVolume = true,
}: {
  candles: Candle[];
  height?: number;
  showVolume?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const profit = readVar("--profit", "#2ed47a");
    const loss = readVar("--loss", "#f2555a");
    const text = readVar("--muted-foreground", "#8b929e");
    const grid = readVar("--grid", "rgba(255,255,255,0.05)");
    const border = readVar("--border", "rgba(255,255,255,0.08)");

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: text,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      rightPriceScale: {
        borderColor: border,
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.26 : 0.08 },
      },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: border, width: 1, style: 2, labelBackgroundColor: "#1a1f26" },
        horzLine: { color: border, width: 1, style: 2, labelBackgroundColor: "#1a1f26" },
      },
      handleScale: { axisPressedMouseMove: false },
    });

    console.log("[v0] chart created", container.clientWidth, height, candles.length);

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: profit,
      downColor: loss,
      borderUpColor: profit,
      borderDownColor: loss,
      wickUpColor: profit,
      wickDownColor: loss,
      priceLineVisible: false,
    });

    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeries.setData(
        candles.map((candle) => ({
          time: candle.time as UTCTimestamp,
          value: candle.volume,
          color:
            candle.close >= candle.open
              ? "color-mix(in oklab, var(--profit) 35%, transparent)"
              : "color-mix(in oklab, var(--loss) 35%, transparent)",
        })),
      );
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;
    (window as unknown as { __chart?: IChartApi }).__chart = chart;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, height, showVolume, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={`Price chart with ${candles.length} candles`}
    />
  );
}

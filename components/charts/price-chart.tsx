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
  type ISeriesApi,
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

// The chart's color parser only understands hex/rgb/hsl, so CSS color
// functions such as color-mix() must be resolved to an alpha hex first.
function withAlpha(color: string, alpha: number) {
  const hex = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const suffix = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${suffix}`;
  }
  return hex;
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
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const colorsRef = React.useRef({ profit: "#2ed47a", loss: "#f2555a" });
  const candlesRef = React.useRef(candles);
  const { resolvedTheme } = useTheme();

  const applyData = React.useCallback((rows: Candle[]) => {
    candleSeriesRef.current?.setData(
      rows.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    const { profit, loss } = colorsRef.current;
    volumeSeriesRef.current?.setData(
      rows.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: withAlpha(
          candle.close >= candle.open ? profit : loss,
          0.35,
        ),
      })),
    );

    chartRef.current?.timeScale().fitContent();
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const profit = readVar("--profit", "#2ed47a");
    const loss = readVar("--loss", "#f2555a");
    const text = readVar("--muted-foreground", "#8b929e");
    const grid = readVar("--grid", "rgba(255,255,255,0.05)");
    const border = readVar("--border", "rgba(255,255,255,0.08)");

    colorsRef.current = { profit, loss };

    const chart = createChart(container, {
      // autoSize keeps the canvas bitmap in step with the container, which a
      // manual width-only ResizeObserver does not.
      autoSize: true,
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

    chartRef.current = chart;

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: profit,
      downColor: loss,
      borderUpColor: profit,
      borderDownColor: loss,
      wickUpColor: profit,
      wickDownColor: loss,
      priceLineVisible: false,
    });

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
      volumeSeriesRef.current = volumeSeries;
    }

    applyData(candlesRef.current);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [applyData, showVolume, resolvedTheme]);

  React.useEffect(() => {
    candlesRef.current = candles;
    applyData(candles);
  }, [applyData, candles]);

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

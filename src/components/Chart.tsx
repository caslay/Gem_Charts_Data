'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi } from 'lightweight-charts';
import { Candle } from '@/hooks/useMarketData';

export function generateVolumetricMarkers(candles: Candle[]) {
  const markers: SeriesMarker<any>[] = [];

  // Iterate through candles (need at least 3 to check a swing)
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 2];
    const mid = candles[i - 1];  // The swing candle we are evaluating
    const curr = candles[i];     // The confirming candle

    // 1. Structural Swing Check
    const isSwingLow = mid.l < prev.l && mid.l < curr.l;
    const isSwingHigh = mid.h > prev.h && mid.h > curr.h;
    if (!isSwingLow && !isSwingHigh) continue;

    // 2. Directional Shift Check
    const isMidBullish = mid.c > mid.o;
    const isMidBearish = mid.c < mid.o;
    const isPrevBullish = prev.c > prev.o;
    const isPrevBearish = prev.c < prev.o;

    const isValidBullishShift = isSwingLow && isMidBullish && isPrevBearish;
    const isValidBearishShift = isSwingHigh && isMidBearish && isPrevBullish;

    if (!isValidBullishShift && !isValidBearishShift) continue;

    // 3. Volumetric Calculations
    const bodyRatioMid = (mid.h - mid.l) !== 0 ? Math.abs(mid.c - mid.o) / (mid.h - mid.l) : 0;
    const bodyRatioPrev = (prev.h - prev.l) !== 0 ? Math.abs(prev.c - prev.o) / (prev.h - prev.l) : 0;

    const dirVolMid = mid.v * bodyRatioMid;
    const dirVolPrev = prev.v * bodyRatioPrev;

    const isRawVolIncrease = mid.v > prev.v;
    const isDirVolIncrease = dirVolMid > dirVolPrev;

    // 4. Generate Markers
    // Lightweight charts time format handling (adjust if yours is string/Date)
    const markerTime = mid.t.toString().length > 10 ? Math.floor(mid.t / 1000) : mid.t;

    if (isDirVolIncrease) {
      // SPECIAL SIGNAL (White) - Institutional Sponsorship
      markers.push({
        time: markerTime as any,
        position: isValidBullishShift ? 'belowBar' : 'aboveBar',
        color: '#ffffff', // White
        shape: isValidBullishShift ? 'arrowUp' : 'arrowDown',
        text: '', // 'Special',
      });
    } else if (isRawVolIncrease) {
      // NORMAL SIGNAL - SMT Trap / Sweep
      markers.push({
        time: markerTime as any,
        position: isValidBullishShift ? 'belowBar' : 'aboveBar',
        color: isValidBullishShift ? '#00bcd4' : '#ff9800', // Cyan for Lows, Orange for Highs
        shape: 'circle',
        text: '', //'Vol',
      });
    }
  }

  return markers;
}

interface ChartProps {
  data: Candle[];
  colors?: {
    backgroundColor?: string;
    textColor?: string;
    upColor?: string;
    downColor?: string;
  };
}

export default function Chart({ data, colors }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const {
      backgroundColor = '#000000', // Deep black for premium look
      textColor = '#9CA3AF',
      upColor = '#22d3ee', // Cyan accent
      downColor = '#c084fc', // Purple accent
    } = colors || {};

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
      localization: {
        timeFormatter: (timestamp: number) => {
          return new Date(timestamp * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'UTC',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString('en-EG', {
            timeZone: 'UTC',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      crosshair: {
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 3,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 3,
        },
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
    seriesRef.current = candlestickSeries;
    seriesMarkersRef.current = createSeriesMarkers(candlestickSeries);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesMarkersRef.current = null;
    };
  }, [colors]);

  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      // lightweight-charts expects time in seconds for Unix timestamps
      const formattedData = data.map((d) => ({
        time: (Math.floor(d.t / 1000)) as any,
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
      }));

      // Data must be sorted in ascending order for lightweight-charts
      formattedData.sort((a, b) => a.time - b.time);

      seriesRef.current.setData(formattedData);

      // Apply the generated volumetric markers based on original data (which is in original order / mapped appropriately)
      // Since generateVolumetricMarkers relies on the structure, we'll pass original data but we must ensure we map markers properly.
      // Wait, 'data' is original candles. Let's make sure 'data' is also sorted ascending or our prev/mid/curr logic works correctly.
      // Usually 'data' from API is oldest to newest, so i=2.. works.
      const sortedDataForMarkers = [...data].sort((a, b) => a.t - b.t);
      seriesMarkersRef.current?.setMarkers(generateVolumetricMarkers(sortedDataForMarkers));

      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}

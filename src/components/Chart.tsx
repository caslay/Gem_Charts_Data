'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { Candle } from '@/hooks/useMarketData';

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
    };
  }, [colors]);

  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      // lightweight-charts expects time in seconds, and displays in the local browser's timezone.
      // To force it to display UTC+3 for all users, we calculate a fake timestamp:
      // fakeTime = originalTime + localTimezoneOffset + (3 hours)
      const formattedData = data.map((d) => {
        const date = new Date(d.t);
        // getTimezoneOffset() returns minutes, positive if behind UTC, negative if ahead.
        const localOffsetMs = date.getTimezoneOffset() * 60 * 1000;
        const utcPlus3OffsetMs = 3 * 60 * 60 * 1000; // +3 hours in ms
        const fakeTimeMs = d.t + localOffsetMs + utcPlus3OffsetMs;
        
        return {
          time: (Math.floor(fakeTimeMs / 1000)) as any,
          open: d.o,
          high: d.h,
          low: d.l,
          close: d.c,
        };
      });

      // Data must be sorted in ascending order for lightweight-charts
      formattedData.sort((a, b) => a.time - b.time);

      seriesRef.current.setData(formattedData);
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}

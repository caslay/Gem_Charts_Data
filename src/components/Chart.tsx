'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi } from 'lightweight-charts';
import { Candle } from '@/hooks/useMarketData';
import { generateVolumetricMarkers } from '@/utils/generateChartMarkers';

interface ChartProps {
  data: Candle[];
  activeFvgs?: any[];
  localDealingRange?: any;
  colors?: {
    backgroundColor?: string;
    textColor?: string;
    upColor?: string;
    downColor?: string;
  };
}

export default function Chart({ data, activeFvgs, localDealingRange, colors }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const {
      backgroundColor = '#0e0e0f', // Deep black for premium look
      textColor = '#958da3',
      upColor = '#50ffaf', // Cyan accent
      downColor = '#ffb4ab', // Purple accent
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
        vertLines: { color: 'rgba(74, 68, 87, 0.5)' },
        horzLines: { color: 'rgba(74, 68, 87, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(74, 68, 87, 0.5)',
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
        borderColor: 'rgba(74, 68, 87, 0.5)',
      },
      crosshair: {
        vertLine: {
          color: 'rgba(74, 68, 87, 0.5)',
          width: 1,
          style: 3,
        },
        horzLine: {
          color: 'rgba(74, 68, 87, 0.5)',
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

      // Apply the generated volumetric markers based on original data
      const sortedDataForMarkers = [...data].sort((a, b) => a.t - b.t);
      const markers = generateVolumetricMarkers(sortedDataForMarkers);
      seriesMarkersRef.current?.setMarkers(markers);

      if (isInitialLoad.current) {
        chartRef.current?.timeScale().fitContent();
        isInitialLoad.current = false;
      }
    }
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}

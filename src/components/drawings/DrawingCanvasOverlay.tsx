'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@/hooks/useMarketData';
import type {
  UserDrawing,
  DrawingPoint,
  DrawingToolMode,
  DrawingType,
  DrawingStyle,
  HandleDragTarget,
  PixelPoint,
} from '@/lib/drawings/types';
import {
  pointToPixel,
  pixelToPoint,
  priceToPixel,
  timeToPixel,
  pixelToPrice,
  pixelToTime,
} from '@/lib/drawings/coordinates';
import DrawingContextBadge from './DrawingContextBadge';

interface DrawingCanvasOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  candles: Candle[];
  drawings: UserDrawing[];
  selectedDrawingId: string | null;
  activeTool: DrawingToolMode;
  isGlobalVisible: boolean;
  toolStyles: Record<DrawingType, DrawingStyle>;
  onAddDrawing: (drawing: UserDrawing) => void;
  onUpdateDrawing: (id: string, updates: Partial<UserDrawing>) => void;
  onSelectDrawing: (id: string | null) => void;
  onDeleteDrawing: (id: string) => void;
  onDuplicateDrawing: (id: string) => void;
  onToggleLock: (id: string) => void;
  onUpdateStyle: (updates: Partial<DrawingStyle>) => void;
  symbol: string;
  interval: string;
}

export default function DrawingCanvasOverlay({
  chart,
  series,
  candles,
  drawings,
  selectedDrawingId,
  activeTool,
  isGlobalVisible,
  toolStyles,
  onAddDrawing,
  onUpdateDrawing,
  onSelectDrawing,
  onDeleteDrawing,
  onDuplicateDrawing,
  onToggleLock,
  onUpdateStyle,
  symbol,
  interval,
}: DrawingCanvasOverlayProps) {
  const containerRef = useRef<SVGSVGElement | null>(null);

  // ── Drawing Creation State ───────────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [draftPoints, setDraftPoints] = useState<DrawingPoint[]>([]);
  const draftPointsRef = useRef<DrawingPoint[]>([]);
  draftPointsRef.current = draftPoints;

  // ── Handle / Body Dragging State ──────────────────────────────────────────
  const [activeDrag, setActiveDrag] = useState<HandleDragTarget | null>(null);
  const activeDragRef = useRef<HandleDragTarget | null>(null);
  activeDragRef.current = activeDrag;

  const lastMovePixelRef = useRef<PixelPoint | null>(null);

  // ── Helper: Map Dash Pattern to SVG strokeDasharray ───────────────────────
  const getStrokeDashArray = (style: string, width: number) => {
    if (style === 'dashed') return `${width * 4} ${width * 2}`;
    if (style === 'dotted') return `${width} ${width * 2}`;
    return 'none';
  };

  // ── 1. Creation Pointer Down ─────────────────────────────────────────────
  const handleCreationPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (!chart || !series || activeTool === 'CURSOR') return;
    if (e.button !== 0) return; // Left-click only

    const rect = e.currentTarget.getBoundingClientRect();
    const pixel = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pt = pixelToPoint(pixel, chart, series, candles);
    if (!pt) return;

    e.preventDefault();
    e.stopPropagation();

    // Disable chart panning
    chart.applyOptions({ handleScroll: false, handleScale: false });
    e.currentTarget.setPointerCapture(e.pointerId);

    setIsCreating(true);
    setDraftPoints([pt, pt]);
    lastMovePixelRef.current = pixel;
  };

  // ── 2. Creation Pointer Move ─────────────────────────────────────────────
  const handleCreationPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!isCreating || !chart || !series || activeTool === 'CURSOR') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pixel = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const pt = pixelToPoint(pixel, chart, series, candles);
    if (!pt) return;

    if (activeTool === 'LINE' || activeTool === 'RECTANGLE') {
      setDraftPoints((prev) => (prev.length > 0 ? [prev[0], pt] : [pt, pt]));
    } else if (activeTool === 'FREEHAND') {
      // Distance thresholding (minimum 4px between sampled freehand points)
      const last = lastMovePixelRef.current;
      if (!last || Math.hypot(pixel.x - last.x, pixel.y - last.y) >= 4) {
        lastMovePixelRef.current = pixel;
        setDraftPoints((prev) => [...prev, pt]);
      }
    }
  };

  // ── 3. Creation Pointer Up ───────────────────────────────────────────────
  const handleCreationPointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    if (!isCreating || !chart || !series || activeTool === 'CURSOR') return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const points = draftPointsRef.current;
    if (points.length >= 2) {
      const p1 = points[0];
      const p2 = points[points.length - 1];

      // Validate minimum shape dimensions
      const isDistinct = activeTool === 'FREEHAND'
        ? points.length >= 3
        : Math.abs(p1.price - p2.price) > 0 || Math.abs(p1.time - p2.time) > 0;

      if (isDistinct) {
        const style = toolStyles[activeTool as DrawingType];
        const newDrawing: UserDrawing = {
          id: `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: activeTool as DrawingType,
          points: [...points],
          style: { ...style },
          symbol,
          interval,
          locked: false,
          visible: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        onAddDrawing(newDrawing);
      }
    }

    setIsCreating(false);
    setDraftPoints([]);
    lastMovePixelRef.current = null;

    // Restore chart panning
    chart.applyOptions({ handleScroll: true, handleScale: true });
  };

  // ── 4. Handle Drag Start ──────────────────────────────────────────────────
  const handleStartDrag = (
    e: React.PointerEvent,
    drawing: UserDrawing,
    handleType: HandleDragTarget['handleType'],
    handleIndex: number
  ) => {
    if (!chart || !series || drawing.locked || activeTool !== 'CURSOR') return;
    if (e.button !== 0) return;

    const svg = containerRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const pixel = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pt = pixelToPoint(pixel, chart, series, candles);
    if (!pt) return;

    e.preventDefault();
    e.stopPropagation();

    // Select drawing
    onSelectDrawing(drawing.id);

    // Disable chart panning
    chart.applyOptions({ handleScroll: false, handleScale: false });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    const dragTarget: HandleDragTarget = {
      drawingId: drawing.id,
      handleIndex,
      handleType,
      initialPoints: JSON.parse(JSON.stringify(drawing.points)),
      startPointerPrice: pt.price,
      startPointerTime: pt.time,
    };

    setActiveDrag(dragTarget);
  };

  // ── 5. Handle Drag Move ───────────────────────────────────────────────────
  const handleDragMove = (e: React.PointerEvent) => {
    const drag = activeDragRef.current;
    if (!drag || !chart || !series) return;

    const svg = containerRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const currentPixel = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const currentPt = pixelToPoint(currentPixel, chart, series, candles);
    if (!currentPt) return;

    const drawing = drawings.find((d) => d.id === drag.drawingId);
    if (!drawing) return;

    const deltaPrice = currentPt.price - drag.startPointerPrice;
    const deltaTime = currentPt.time - drag.startPointerTime;

    let nextPoints = [...drag.initialPoints];

    if (drag.handleType === 'BODY') {
      // Translate entire shape across time and price
      nextPoints = drag.initialPoints.map((p) => ({
        price: Math.max(0.01, p.price + deltaPrice),
        time: p.time + deltaTime,
      }));
    } else if (drawing.type === 'LINE') {
      // Move individual endpoint
      if (drag.handleIndex === 0) {
        nextPoints[0] = { price: currentPt.price, time: currentPt.time };
      } else if (drag.handleIndex === 1) {
        nextPoints[1] = { price: currentPt.price, time: currentPt.time };
      }
    } else if (drawing.type === 'RECTANGLE') {
      // Corner resizing: [Corner1, Corner2]
      const p1 = drag.initialPoints[0];
      const p2 = drag.initialPoints[1];
      const minTime = Math.min(p1.time, p2.time);
      const maxTime = Math.max(p1.time, p2.time);
      const minPrice = Math.min(p1.price, p2.price);
      const maxPrice = Math.max(p1.price, p2.price);

      if (drag.handleType === 'CORNER_TL') {
        nextPoints = [{ time: currentPt.time, price: currentPt.price }, { time: maxTime, price: minPrice }];
      } else if (drag.handleType === 'CORNER_TR') {
        nextPoints = [{ time: minTime, price: minPrice }, { time: currentPt.time, price: currentPt.price }];
      } else if (drag.handleType === 'CORNER_BL') {
        nextPoints = [{ time: currentPt.time, price: currentPt.price }, { time: maxTime, price: maxPrice }];
      } else if (drag.handleType === 'CORNER_BR') {
        nextPoints = [{ time: minTime, price: maxPrice }, { time: currentPt.time, price: currentPt.price }];
      }
    } else if (drawing.type === 'FREEHAND' && drag.handleType === 'SCALE_CORNER') {
      // Scale freehand bounding box relative to opposing corner
      // Compute bounding box of initial points
      const prices = drag.initialPoints.map((p) => p.price);
      const times = drag.initialPoints.map((p) => p.time);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const minT = Math.min(...times);
      const maxT = Math.max(...times);

      const priceRange = maxP - minP || 1;
      const timeRange = maxT - minT || 1;

      // Scale all points smoothly
      nextPoints = drag.initialPoints.map((p) => {
        const u = (p.time - minT) / timeRange;
        const v = (p.price - minP) / priceRange;
        return {
          time: minT + u * (timeRange + deltaTime),
          price: minP + v * (priceRange + deltaPrice),
        };
      });
    }

    onUpdateDrawing(drawing.id, { points: nextPoints });
  };

  // ── 6. Handle Drag End ─────────────────────────────────────────────────────
  const handleDragEnd = (e: React.PointerEvent) => {
    if (!activeDragRef.current) return;

    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}

    setActiveDrag(null);

    // Restore chart panning
    if (chart) {
      chart.applyOptions({ handleScroll: true, handleScale: true });
    }
  };

  // ── Context Badge Anchor Positioning ──────────────────────────────────────
  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId) || null;
  let badgePosition: PixelPoint | null = null;
  if (selectedDrawing && isGlobalVisible) {
    const pixelCoords = selectedDrawing.points
      .map((p) => pointToPixel(p, chart, series, candles))
      .filter((p): p is PixelPoint => p !== null);

    if (pixelCoords.length > 0) {
      const minX = Math.min(...pixelCoords.map((p) => p.x));
      const minY = Math.min(...pixelCoords.map((p) => p.y));
      badgePosition = { x: minX, y: minY };
    }
  }

  if (!isGlobalVisible) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      <svg
        ref={containerRef}
        className="w-full h-full absolute inset-0 select-none"
        onPointerMove={activeDrag ? handleDragMove : undefined}
        onPointerUp={activeDrag ? handleDragEnd : undefined}
      >
        {/* Full-screen Creation Plane when tool mode is active */}
        {activeTool !== 'CURSOR' && (
          <rect
            className="pointer-events-auto cursor-crosshair"
            width="100%"
            height="100%"
            fill="transparent"
            onPointerDown={handleCreationPointerDown}
            onPointerMove={handleCreationPointerMove}
            onPointerUp={handleCreationPointerUp}
          />
        )}

        {/* ── Render Committed Drawings ───────────────────────────────────────── */}
        {drawings.map((drawing) => {
          if (drawing.visible === false) return null;
          const isSelected = drawing.id === selectedDrawingId;
          const pixels = drawing.points
            .map((p) => pointToPixel(p, chart, series, candles))
            .filter((p): p is PixelPoint => p !== null);

          if (pixels.length < 2 && drawing.type !== 'FREEHAND') return null;

          const { strokeColor, fillColor, lineWidth, lineStyle, opacity } = drawing.style;
          const dashArray = getStrokeDashArray(lineStyle, lineWidth);

          return (
            <g
              key={drawing.id}
              className={`transition-opacity duration-100 ${drawing.locked ? 'opacity-70' : 'opacity-100'}`}
            >
              {/* LINE SHAPE */}
              {drawing.type === 'LINE' && pixels.length >= 2 && (
                <>
                  {/* Invisible wide hit-box line for easy clicking/dragging */}
                  <line
                    x1={pixels[0].x}
                    y1={pixels[0].y}
                    x2={pixels[1].x}
                    y2={pixels[1].y}
                    stroke="transparent"
                    strokeWidth={Math.max(14, lineWidth + 10)}
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => handleStartDrag(e, drawing, 'BODY', 0)}
                  />
                  {/* Visible Line */}
                  <line
                    x1={pixels[0].x}
                    y1={pixels[0].y}
                    x2={pixels[1].x}
                    y2={pixels[1].y}
                    stroke={strokeColor}
                    strokeWidth={lineWidth}
                    strokeDasharray={dashArray}
                    strokeLinecap="round"
                    style={{ opacity }}
                  />
                  {/* Selected Handles */}
                  {isSelected && (
                    <>
                      <circle
                        cx={pixels[0].x}
                        cy={pixels[0].y}
                        r={5}
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth={2}
                        className="pointer-events-auto cursor-move shadow-md"
                        onPointerDown={(e) => handleStartDrag(e, drawing, 'POINT', 0)}
                      />
                      <circle
                        cx={pixels[1].x}
                        cy={pixels[1].y}
                        r={5}
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth={2}
                        className="pointer-events-auto cursor-move shadow-md"
                        onPointerDown={(e) => handleStartDrag(e, drawing, 'POINT', 1)}
                      />
                    </>
                  )}
                </>
              )}

              {/* RECTANGLE SHAPE */}
              {drawing.type === 'RECTANGLE' && pixels.length >= 2 && (
                <>
                  {(() => {
                    const left = Math.min(pixels[0].x, pixels[1].x);
                    const top = Math.min(pixels[0].y, pixels[1].y);
                    const width = Math.abs(pixels[1].x - pixels[0].x);
                    const height = Math.abs(pixels[1].y - pixels[0].y);

                    return (
                      <>
                        {/* Rectangle Body Fill & Border */}
                        <rect
                          x={left}
                          y={top}
                          width={Math.max(2, width)}
                          height={Math.max(2, height)}
                          fill={fillColor || strokeColor}
                          fillOpacity={opacity}
                          stroke={strokeColor}
                          strokeWidth={lineWidth}
                          strokeDasharray={dashArray}
                          rx={2}
                          className="pointer-events-auto cursor-move"
                          onPointerDown={(e) => handleStartDrag(e, drawing, 'BODY', 0)}
                        />
                        {/* Selected Corner Transformation Handles */}
                        {isSelected && (
                          <>
                            {/* Top-Left */}
                            <circle
                              cx={left}
                              cy={top}
                              r={5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nwse-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'CORNER_TL', 0)}
                            />
                            {/* Top-Right */}
                            <circle
                              cx={left + width}
                              cy={top}
                              r={5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nesw-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'CORNER_TR', 0)}
                            />
                            {/* Bottom-Left */}
                            <circle
                              cx={left}
                              cy={top + height}
                              r={5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nesw-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'CORNER_BL', 0)}
                            />
                            {/* Bottom-Right */}
                            <circle
                              cx={left + width}
                              cy={top + height}
                              r={5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nwse-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'CORNER_BR', 0)}
                            />
                          </>
                        )}
                      </>
                    );
                  })()}
                </>
              )}

              {/* FREEHAND SHAPE */}
              {drawing.type === 'FREEHAND' && pixels.length >= 2 && (
                <>
                  {(() => {
                    const pathData = pixels.reduce((acc, pt, idx) => {
                      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                    }, '');

                    const minX = Math.min(...pixels.map((p) => p.x));
                    const maxX = Math.max(...pixels.map((p) => p.x));
                    const minY = Math.min(...pixels.map((p) => p.y));
                    const maxY = Math.max(...pixels.map((p) => p.y));

                    return (
                      <>
                        {/* Wide hit-box stroke */}
                        <path
                          d={pathData}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(14, lineWidth + 10)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="pointer-events-auto cursor-move"
                          onPointerDown={(e) => handleStartDrag(e, drawing, 'BODY', 0)}
                        />
                        {/* Visible Freehand Stroke */}
                        <path
                          d={pathData}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={lineWidth}
                          strokeDasharray={dashArray}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ opacity }}
                        />
                        {/* Bounding box when selected */}
                        {isSelected && (
                          <>
                            <rect
                              x={minX - 4}
                              y={minY - 4}
                              width={maxX - minX + 8}
                              height={maxY - minY + 8}
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth={1}
                              strokeDasharray="3 3"
                              className="pointer-events-none opacity-60"
                            />
                            <circle
                              cx={minX - 4}
                              cy={minY - 4}
                              r={4.5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nwse-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'SCALE_CORNER', 0)}
                            />
                            <circle
                              cx={maxX + 4}
                              cy={maxY + 4}
                              r={4.5}
                              fill="#ffffff"
                              stroke={strokeColor}
                              strokeWidth={2}
                              className="pointer-events-auto cursor-nwse-resize shadow-md"
                              onPointerDown={(e) => handleStartDrag(e, drawing, 'SCALE_CORNER', 1)}
                            />
                          </>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </g>
          );
        })}

        {/* ── Render Draft Drawing in Progress ───────────────────────────────── */}
        {isCreating && draftPoints.length >= 2 && (
          <g className="opacity-90">
            {(() => {
              const draftPixels = draftPoints
                .map((p) => pointToPixel(p, chart, series, candles))
                .filter((p): p is PixelPoint => p !== null);

              if (draftPixels.length < 2) return null;

              const style = toolStyles[activeTool as DrawingType] || {
                strokeColor: '#38bdf8',
                lineWidth: 2,
                lineStyle: 'solid',
                opacity: 1,
              };
              const dashArray = getStrokeDashArray(style.lineStyle, style.lineWidth);

              if (activeTool === 'LINE') {
                return (
                  <line
                    x1={draftPixels[0].x}
                    y1={draftPixels[0].y}
                    x2={draftPixels[1].x}
                    y2={draftPixels[1].y}
                    stroke={style.strokeColor}
                    strokeWidth={style.lineWidth}
                    strokeDasharray={dashArray}
                    strokeLinecap="round"
                  />
                );
              }

              if (activeTool === 'RECTANGLE') {
                const left = Math.min(draftPixels[0].x, draftPixels[1].x);
                const top = Math.min(draftPixels[0].y, draftPixels[1].y);
                const width = Math.abs(draftPixels[1].x - draftPixels[0].x);
                const height = Math.abs(draftPixels[1].y - draftPixels[0].y);

                return (
                  <rect
                    x={left}
                    y={top}
                    width={Math.max(2, width)}
                    height={Math.max(2, height)}
                    fill={style.fillColor || style.strokeColor}
                    fillOpacity={style.opacity || 0.2}
                    stroke={style.strokeColor}
                    strokeWidth={style.lineWidth}
                    strokeDasharray={dashArray}
                    rx={2}
                  />
                );
              }

              if (activeTool === 'FREEHAND') {
                const pathData = draftPixels.reduce((acc, pt, idx) => {
                  return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                }, '');

                return (
                  <path
                    d={pathData}
                    fill="none"
                    stroke={style.strokeColor}
                    strokeWidth={style.lineWidth}
                    strokeDasharray={dashArray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              }

              return null;
            })()}
          </g>
        )}
      </svg>

      {/* ── Render Context Customization Badge for Selected Drawing ──────────── */}
      {selectedDrawing && badgePosition && activeTool === 'CURSOR' && (
        <DrawingContextBadge
          drawing={selectedDrawing}
          position={badgePosition}
          onUpdateStyle={onUpdateStyle}
          onDelete={() => onDeleteDrawing(selectedDrawing.id)}
          onDuplicate={() => onDuplicateDrawing(selectedDrawing.id)}
          onToggleLock={() => onToggleLock(selectedDrawing.id)}
          onClose={() => onSelectDrawing(null)}
        />
      )}
    </div>
  );
}

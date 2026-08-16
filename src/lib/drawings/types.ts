export type DrawingType = 'LINE' | 'RECTANGLE' | 'FREEHAND';
export type DrawingToolMode = 'CURSOR' | DrawingType;
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingPoint {
  price: number;
  time: number; // UTC timestamp in milliseconds (matching candle t)
}

export interface DrawingStyle {
  strokeColor: string;
  fillColor?: string; // Hex or rgba color for closed shapes like RECTANGLE
  opacity: number; // 0.05 to 1.0
  lineWidth: number; // 1 to 8
  lineStyle: LineStyle;
}

export interface UserDrawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[]; // LINE: [p1, p2], RECTANGLE: [corner1, corner2], FREEHAND: [p1, p2, ...pn]
  style: DrawingStyle;
  symbol: string; // e.g. 'ETHUSDC'
  interval: string; // e.g. '5m', '15m', or 'ALL'
  locked?: boolean;
  visible?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface HandleDragTarget {
  drawingId: string;
  handleIndex: number; // Index into points array, or specific corner identifier
  handleType: 'POINT' | 'BODY' | 'CORNER_TL' | 'CORNER_TR' | 'CORNER_BL' | 'CORNER_BR' | 'SCALE_CORNER';
  initialPoints: DrawingPoint[];
  startPointerPrice: number;
  startPointerTime: number;
}

export const DEFAULT_DRAWING_STYLES: Record<DrawingType, DrawingStyle> = {
  LINE: {
    strokeColor: '#38bdf8', // Sky blue
    opacity: 1,
    lineWidth: 2,
    lineStyle: 'solid',
  },
  RECTANGLE: {
    strokeColor: '#a855f7', // Purple accent
    fillColor: '#a855f7',
    opacity: 0.2,
    lineWidth: 1.5,
    lineStyle: 'solid',
  },
  FREEHAND: {
    strokeColor: '#f59e0b', // Amber
    opacity: 1,
    lineWidth: 2.5,
    lineStyle: 'solid',
  },
};

export const COLOR_PALETTE_PRESETS = [
  { name: 'Sky Cyan', hex: '#38bdf8' },
  { name: 'Purple Accent', hex: '#a855f7' },
  { name: 'Emerald Bullish', hex: '#50ffaf' },
  { name: 'Rose Bearish', hex: '#ffb4ab' },
  { name: 'Amber Glow', hex: '#f59e0b' },
  { name: 'Crimson Red', hex: '#ef4444' },
  { name: 'Indigo Deep', hex: '#6366f1' },
  { name: 'Muted Slate', hex: '#94a3b8' },
  { name: 'Pure White', hex: '#ffffff' },
];

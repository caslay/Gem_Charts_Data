'use client';

import React, { useState } from 'react';
import {
  Trash2,
  Copy,
  Lock,
  Unlock,
  Palette,
  Minus,
  Sliders,
  X,
} from 'lucide-react';
import type { UserDrawing, DrawingStyle, LineStyle } from '@/lib/drawings/types';
import { COLOR_PALETTE_PRESETS } from '@/lib/drawings/types';

interface DrawingContextBadgeProps {
  drawing: UserDrawing;
  position: { x: number; y: number };
  onUpdateStyle: (updates: Partial<DrawingStyle>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onClose: () => void;
}

export default function DrawingContextBadge({
  drawing,
  position,
  onUpdateStyle,
  onDelete,
  onDuplicate,
  onToggleLock,
  onClose,
}: DrawingContextBadgeProps) {
  const [activeTab, setActiveTab] = useState<'NONE' | 'STROKE_COLOR' | 'FILL_COLOR' | 'WIDTH' | 'STYLE'>('NONE');

  const { strokeColor, fillColor, lineWidth, lineStyle, opacity } = drawing.style;

  // Position badge nicely above or below the shape, clamped within container
  const badgeTop = Math.max(12, Math.min(position.y - 48, window.innerHeight - 100));
  const badgeLeft = Math.max(12, Math.min(position.x, window.innerWidth - 360));

  return (
    <div
      className="absolute z-40 flex flex-col pointer-events-auto select-none font-mono text-[11px]"
      style={{ top: `${badgeTop}px`, left: `${badgeLeft}px` }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Main Action Bar Pill */}
      <div className="flex items-center gap-1 bg-[#141416]/95 border border-[#4a4457]/70 backdrop-blur-xl px-2 py-1 rounded-lg shadow-2xl">
        {/* Stroke Color Button */}
        <button
          onClick={() => setActiveTab(activeTab === 'STROKE_COLOR' ? 'NONE' : 'STROKE_COLOR')}
          className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
            activeTab === 'STROKE_COLOR' ? 'bg-white/15 text-white' : 'text-white/80'
          }`}
          title="Line / Stroke Color"
        >
          <span
            className="w-3.5 h-3.5 rounded-full border border-white/30 shadow-sm"
            style={{ backgroundColor: strokeColor }}
          />
          <span className="text-[10px] uppercase font-bold tracking-wider">Line</span>
        </button>

        {/* Fill Color Button (Only for Rectangle) */}
        {drawing.type === 'RECTANGLE' && (
          <button
            onClick={() => setActiveTab(activeTab === 'FILL_COLOR' ? 'NONE' : 'FILL_COLOR')}
            className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
              activeTab === 'FILL_COLOR' ? 'bg-white/15 text-white' : 'text-white/80'
            }`}
            title="Fill Color & Opacity"
          >
            <span
              className="w-3.5 h-3.5 rounded border border-white/30 shadow-sm"
              style={{ backgroundColor: fillColor || strokeColor, opacity }}
            />
            <span className="text-[10px] uppercase font-bold tracking-wider">Fill</span>
          </button>
        )}

        <div className="w-[1px] h-4 bg-[#4a4457]/50 my-auto" />

        {/* Line Thickness */}
        <button
          onClick={() => setActiveTab(activeTab === 'WIDTH' ? 'NONE' : 'WIDTH')}
          className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
            activeTab === 'WIDTH' ? 'bg-white/15 text-white' : 'text-white/80'
          }`}
          title="Line Width"
        >
          <Minus className="w-3.5 h-3.5" style={{ strokeWidth: lineWidth * 1.5 }} />
          <span className="text-[10px] font-bold">{lineWidth}px</span>
        </button>

        {/* Line Style (Solid / Dashed / Dotted) */}
        <button
          onClick={() => setActiveTab(activeTab === 'STYLE' ? 'NONE' : 'STYLE')}
          className={`px-1.5 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer text-[10px] font-bold uppercase ${
            activeTab === 'STYLE' ? 'bg-white/15 text-white' : 'text-white/80'
          }`}
          title="Line Dash Style"
        >
          {lineStyle}
        </button>

        <div className="w-[1px] h-4 bg-[#4a4457]/50 my-auto" />

        {/* Duplicate */}
        <button
          onClick={onDuplicate}
          className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Duplicate Shape"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>

        {/* Lock / Unlock */}
        <button
          onClick={onToggleLock}
          className={`p-1 rounded transition-colors cursor-pointer ${
            drawing.locked
              ? 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/20'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
          title={drawing.locked ? 'Unlock Shape' : 'Lock Shape'}
        >
          {drawing.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="p-1 rounded text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          title="Delete Shape (Del / Backspace)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Close Selection */}
        <button
          onClick={onClose}
          className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer ml-0.5"
          title="Deselect (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Floating Sub-Popovers */}
      {activeTab === 'STROKE_COLOR' && (
        <div className="mt-1 p-2 bg-[#141416]/98 border border-[#4a4457]/80 rounded-lg shadow-2xl flex flex-col gap-2 min-w-[200px] animate-[fadeIn_0.1s_ease-out]">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
            Stroke Color Palette
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_PALETTE_PRESETS.map((p) => (
              <button
                key={p.hex}
                onClick={() => {
                  onUpdateStyle({ strokeColor: p.hex });
                  setActiveTab('NONE');
                }}
                className={`w-6 h-6 rounded-md border transition-transform hover:scale-110 cursor-pointer ${
                  strokeColor === p.hex ? 'border-white ring-2 ring-white/30 scale-105' : 'border-white/20'
                }`}
                style={{ backgroundColor: p.hex }}
                title={p.name}
              />
            ))}
          </div>
          {/* Custom Hex Input */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-[#4a4457]/40">
            <span className="text-[10px] text-white/40">HEX</span>
            <input
              type="text"
              value={strokeColor}
              onChange={(e) => onUpdateStyle({ strokeColor: e.target.value })}
              className="flex-1 bg-black/40 border border-[#4a4457]/60 rounded px-1.5 py-0.5 text-[10px] text-white font-mono uppercase"
            />
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => onUpdateStyle({ strokeColor: e.target.value })}
              className="w-5 h-5 rounded border border-white/20 cursor-pointer bg-transparent"
            />
          </div>
        </div>
      )}

      {activeTab === 'FILL_COLOR' && (
        <div className="mt-1 p-2 bg-[#141416]/98 border border-[#4a4457]/80 rounded-lg shadow-2xl flex flex-col gap-2 min-w-[210px] animate-[fadeIn_0.1s_ease-out]">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
            Fill Color & Opacity
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_PALETTE_PRESETS.map((p) => (
              <button
                key={p.hex}
                onClick={() => onUpdateStyle({ fillColor: p.hex })}
                className={`w-6 h-6 rounded-md border transition-transform hover:scale-110 cursor-pointer ${
                  fillColor === p.hex ? 'border-white ring-2 ring-white/30 scale-105' : 'border-white/20'
                }`}
                style={{ backgroundColor: p.hex }}
                title={p.name}
              />
            ))}
          </div>
          {/* Opacity Slider */}
          <div className="flex flex-col gap-1 pt-1 border-t border-[#4a4457]/40">
            <div className="flex justify-between text-[10px] text-white/60">
              <span>Opacity</span>
              <span>{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={(e) => onUpdateStyle({ opacity: parseFloat(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-accent"
            />
          </div>
        </div>
      )}

      {activeTab === 'WIDTH' && (
        <div className="mt-1 p-2 bg-[#141416]/98 border border-[#4a4457]/80 rounded-lg shadow-2xl flex flex-col gap-1.5 min-w-[130px] animate-[fadeIn_0.1s_ease-out]">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
            Line Width
          </span>
          {[1, 2, 3, 4, 6].map((w) => (
            <button
              key={w}
              onClick={() => {
                onUpdateStyle({ lineWidth: w });
                setActiveTab('NONE');
              }}
              className={`flex items-center justify-between px-2 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                lineWidth === w ? 'bg-accent/20 text-accent font-black' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-8 bg-current rounded-full"
                  style={{ height: `${w}px` }}
                />
                <span>{w}px</span>
              </div>
              {lineWidth === w && <span className="text-[9px]">✓</span>}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'STYLE' && (
        <div className="mt-1 p-2 bg-[#141416]/98 border border-[#4a4457]/80 rounded-lg shadow-2xl flex flex-col gap-1 min-w-[130px] animate-[fadeIn_0.1s_ease-out]">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
            Pattern Style
          </span>
          {(['solid', 'dashed', 'dotted'] as LineStyle[]).map((st) => (
            <button
              key={st}
              onClick={() => {
                onUpdateStyle({ lineStyle: st });
                setActiveTab('NONE');
              }}
              className={`flex items-center justify-between px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                lineStyle === st ? 'bg-accent/20 text-accent font-black' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{st}</span>
              {lineStyle === st && <span className="text-[9px]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

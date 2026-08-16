'use client';

import React, { useState } from 'react';
import {
  MousePointer,
  TrendingUp,
  Square,
  PenTool,
  Palette,
  Eye,
  EyeOff,
  Undo2,
  Redo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { DrawingToolMode, DrawingType } from '@/lib/drawings/types';
import { COLOR_PALETTE_PRESETS } from '@/lib/drawings/types';

interface DrawingToolbarProps {
  activeTool: DrawingToolMode;
  onSelectTool: (tool: DrawingToolMode) => void;
  activeColor: string;
  onChangeColor: (hex: string) => void;
  isGlobalVisible: boolean;
  onToggleVisibility: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
  drawingCount: number;
}

export default function DrawingToolbar({
  activeTool,
  onSelectTool,
  activeColor,
  onChangeColor,
  isGlobalVisible,
  onToggleVisibility,
  onUndo,
  onRedo,
  onClearAll,
  drawingCount,
}: DrawingToolbarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const tools: { id: DrawingToolMode; label: string; icon: any; hotkey: string }[] = [
    { id: 'CURSOR', label: 'Select / Move', icon: MousePointer, hotkey: 'V' },
    { id: 'LINE', label: 'Trendline', icon: TrendingUp, hotkey: 'L' },
    { id: 'RECTANGLE', label: 'Rectangle Box', icon: Square, hotkey: 'R' },
    { id: 'FREEHAND', label: 'Brush / Freehand', icon: PenTool, hotkey: 'B' },
  ];

  return (
    <div
      className="absolute top-16 left-3 z-30 flex items-start gap-1 select-none pointer-events-auto font-mono text-[11px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Main Glassmorphic Dock */}
      <div className="flex flex-col items-center bg-[#0e0e0f]/90 border border-[#4a4457]/40 backdrop-blur-xl p-1 rounded-xl shadow-2xl transition-all duration-200">
        {/* Toggle Collapse */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer mb-0.5"
          title={isCollapsed ? 'Expand Drawing Toolbar' : 'Collapse Toolbar'}
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {!isCollapsed && (
          <>
            {/* Primary Drawing Tool Buttons */}
            <div className="flex flex-col gap-1 w-full">
              {tools.map((tool) => {
                const Icon = tool.icon;
                const isActive = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    onClick={() => onSelectTool(tool.id)}
                    className={`relative p-2 rounded-lg flex items-center justify-center transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-accent text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                    title={`${tool.label} (${tool.hotkey})`}
                  >
                    <Icon className="w-4 h-4" />
                    {/* Tooltip on hover */}
                    <div className="absolute left-full ml-2 px-2 py-1 bg-[#141416] border border-[#4a4457]/80 rounded text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl z-50 flex items-center gap-1.5 font-bold">
                      <span>{tool.label}</span>
                      <kbd className="px-1 py-0.2 bg-white/10 border border-white/20 rounded text-[9px] text-white/80">
                        {tool.hotkey}
                      </kbd>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="w-5 h-[1px] bg-[#4a4457]/40 my-1.5" />

            {/* Quick Color Palette Button */}
            <div className="relative">
              <button
                onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                className="p-1.5 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer group"
                title="Active Drawing Color"
              >
                <div
                  className="w-4 h-4 rounded-full border border-white/40 shadow-sm"
                  style={{ backgroundColor: activeColor }}
                />
              </button>

              {/* Color Picker Dropdown */}
              {isColorPickerOpen && (
                <div className="absolute left-full top-0 ml-2 p-2 bg-[#141416]/98 border border-[#4a4457]/80 rounded-xl shadow-2xl z-50 flex flex-col gap-2 min-w-[170px] animate-[fadeIn_0.1s_ease-out]">
                  <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">
                    Palette Preset
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {COLOR_PALETTE_PRESETS.map((p) => (
                      <button
                        key={p.hex}
                        onClick={() => {
                          onChangeColor(p.hex);
                          setIsColorPickerOpen(false);
                        }}
                        className={`w-5 h-5 rounded-md border transition-transform hover:scale-110 cursor-pointer ${
                          activeColor === p.hex ? 'border-white ring-2 ring-white/40' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: p.hex }}
                        title={p.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="w-5 h-[1px] bg-[#4a4457]/40 my-1.5" />

            {/* Undo / Redo */}
            <div className="flex flex-col gap-1">
              <button
                onClick={onUndo}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer group"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onRedo}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer group"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-5 h-[1px] bg-[#4a4457]/40 my-1.5" />

            {/* Visibility Toggle */}
            <button
              onClick={onToggleVisibility}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isGlobalVisible
                  ? 'text-white/60 hover:text-white hover:bg-white/10'
                  : 'text-amber-400/80 bg-amber-400/10 hover:bg-amber-400/20'
              }`}
              title={isGlobalVisible ? 'Hide All Drawings' : 'Show All Drawings'}
            >
              {isGlobalVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>

            {/* Clear All Drawings */}
            <div className="relative">
              <button
                onClick={() => setIsClearConfirmOpen(!isClearConfirmOpen)}
                className="p-1.5 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Clear All Drawings"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {isClearConfirmOpen && (
                <div className="absolute left-full top-0 ml-2 p-2.5 bg-[#141416]/98 border border-red-500/50 rounded-xl shadow-2xl z-50 flex flex-col gap-2 min-w-[180px] animate-[fadeIn_0.1s_ease-out]">
                  <span className="text-[10px] text-red-300 font-bold">
                    Clear all {drawingCount} drawings?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onClearAll();
                        setIsClearConfirmOpen(false);
                      }}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded px-2 py-1 text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setIsClearConfirmOpen(false)}
                      className="flex-1 bg-white/10 hover:bg-white/15 text-white/80 rounded px-2 py-1 text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
      className="absolute top-4 left-2.5 z-30 flex items-start gap-1 select-none pointer-events-auto font-mono text-[11px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Main Glassmorphic Dock */}
      <div className="flex flex-col items-center bg-white/95 dark:bg-slate-950/90 border border-slate-200/90 dark:border-slate-800/80 backdrop-blur-xl p-1 rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:shadow-2xl transition-all duration-200">
        {/* Toggle Collapse */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800/60 rounded transition-colors cursor-pointer mb-0.5"
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
                        ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(79,70,229,0.35)] dark:bg-cyan-500 dark:text-slate-950 dark:shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {/* Tooltip on hover */}
                    <div
                      role="tooltip"
                      className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 items-center gap-1.5 font-bold font-mono"
                    >
                      <span className="text-white">{tool.label}</span>
                      <kbd className="px-1.5 py-0.5 bg-white/20 dark:bg-white/15 border border-white/25 rounded text-[9px] text-white font-mono font-bold leading-none">
                        {tool.hotkey}
                      </kbd>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-1.5" />

            {/* Quick Color Palette Button */}
            <div className="relative">
              <button
                onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                className="relative p-1.5 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60 transition-colors cursor-pointer group"
              >
                <div
                  className="w-4 h-4 rounded-full border-2 border-white dark:border-slate-800 shadow-sm ring-1 ring-slate-300 dark:ring-slate-700"
                  style={{ backgroundColor: activeColor }}
                />
                {/* Tooltip */}
                <div
                  role="tooltip"
                  className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 font-bold font-mono"
                >
                  Color Palette
                </div>
              </button>

              {/* Color Picker Dropdown */}
              {isColorPickerOpen && (
                <div className="absolute left-full top-0 ml-2 p-2.5 bg-white/98 dark:bg-slate-950/98 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 flex flex-col gap-2 min-w-[170px] backdrop-blur-xl animate-[fadeIn_0.1s_ease-out]">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
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
                          activeColor === p.hex
                            ? 'border-slate-900 dark:border-white ring-2 ring-indigo-500/40 dark:ring-cyan-500/40'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                        style={{ backgroundColor: p.hex }}
                        title={p.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-1.5" />

            {/* Undo / Redo */}
            <div className="flex flex-col gap-1">
              <button
                onClick={onUndo}
                className="relative p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60 transition-colors cursor-pointer group"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <div
                  role="tooltip"
                  className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 items-center gap-1.5 font-bold font-mono"
                >
                  <span>Undo</span>
                  <kbd className="px-1.5 py-0.5 bg-white/20 dark:bg-white/15 border border-white/25 rounded text-[9px] text-white font-mono font-bold leading-none">
                    Ctrl+Z
                  </kbd>
                </div>
              </button>
              <button
                onClick={onRedo}
                className="relative p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60 transition-colors cursor-pointer group"
              >
                <Redo2 className="w-3.5 h-3.5" />
                <div
                  role="tooltip"
                  className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 items-center gap-1.5 font-bold font-mono"
                >
                  <span>Redo</span>
                  <kbd className="px-1.5 py-0.5 bg-white/20 dark:bg-white/15 border border-white/25 rounded text-[9px] text-white font-mono font-bold leading-none">
                    Ctrl+Y
                  </kbd>
                </div>
              </button>
            </div>

            <div className="w-5 h-[1px] bg-slate-200 dark:bg-slate-800 my-1.5" />

            {/* Visibility Toggle */}
            <div className="relative">
              <button
                onClick={onToggleVisibility}
                className={`relative p-1.5 rounded-lg transition-colors cursor-pointer group ${
                  isGlobalVisible
                    ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
                    : 'text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 dark:text-amber-400'
                }`}
              >
                {isGlobalVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <div
                  role="tooltip"
                  className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 font-bold font-mono"
                >
                  {isGlobalVisible ? 'Hide Drawings' : 'Show Drawings'}
                </div>
              </button>
            </div>

            {/* Clear All Drawings */}
            <div className="relative">
              <button
                onClick={() => setIsClearConfirmOpen(!isClearConfirmOpen)}
                className="relative p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400/80 dark:hover:text-rose-300 dark:hover:bg-rose-500/10 transition-colors cursor-pointer group"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <div
                  role="tooltip"
                  className="hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex custom-tooltip absolute left-full ml-2.5 px-2.5 py-1 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/90 dark:border-slate-800/90 rounded-md text-[10px] text-white whitespace-nowrap pointer-events-none shadow-xl z-50 font-bold font-mono"
                >
                  Clear All
                </div>
              </button>

              {isClearConfirmOpen && (
                <div className="absolute left-full top-0 ml-2 p-2.5 bg-white/98 dark:bg-slate-950/98 border border-rose-500/30 rounded-xl shadow-2xl z-50 flex flex-col gap-2 min-w-[180px] backdrop-blur-xl animate-[fadeIn_0.1s_ease-out]">
                  <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">
                    Clear all {drawingCount} drawings?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onClearAll();
                        setIsClearConfirmOpen(false);
                      }}
                      className="flex-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 border border-rose-500/40 rounded px-2 py-1 text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setIsClearConfirmOpen(false)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded px-2 py-1 text-[10px] font-bold cursor-pointer transition-colors"
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

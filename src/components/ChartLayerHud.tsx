'use client';

import React, { useEffect, useState } from 'react';
import { registry } from '@/lib/chartLayers/registry';
import { useLayerStore } from '@/lib/chartLayers/store';
import * as Icons from 'lucide-react';

export default function ChartLayerHud() {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { visibility, toggleVisibility } = useLayerStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const layers = registry.getAll();

  return (
    <div className="absolute top-4 right-20 z-20 flex items-center gap-2">
      {/* Floating Glass Capsule HUD Container */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all duration-300 bg-card/85 backdrop-blur-md border-card-border shadow-2xl ${
          isOpen ? 'max-w-[1200px] opacity-100' : 'max-w-[42px] overflow-hidden'
        }`}
      >
        {/* Toggle Collapse Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`p-1.5 rounded hover:bg-card-border/20 transition-colors text-muted hover:text-foreground cursor-pointer ${
            isOpen ? 'rotate-90' : 'rotate-0'
          } duration-300`}
          title="Layer Configuration"
        >
          <Icons.Layers size={14} />
        </button>

        {isOpen && (
          <div className="flex items-center gap-2 pl-2 border-l border-card-border animate-[fadeIn_0.2s_ease-out] whitespace-nowrap">
            {layers.map((layer) => {
              const isVisible = visibility[layer.id] !== false;
              // Dynamically resolve icon from Lucide
              const IconComponent = (Icons as any)[layer.icon] || Icons.HelpCircle;
              const isStructure = layer.id === 'structure';
              const label = layer.shortName || layer.name.split(' ')[0].toUpperCase();

              return (
                <div key={layer.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleVisibility(layer.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold tracking-wider transition-all duration-200 cursor-pointer ${
                      isVisible
                        ? 'bg-accent/15 border border-accent/40 text-accent shadow-[0_0_8px_rgba(168,85,247,0.15)]'
                        : 'bg-card-border/10 border border-card-border/30 text-muted hover:bg-card-border/20 hover:text-foreground'
                    }`}
                    title={`${layer.name}: ${layer.description}`}
                  >
                    <IconComponent size={10} />
                    <span>{label}</span>
                  </button>

                  {isStructure && isVisible && (
                    <div className="flex items-center gap-1 px-1 py-0.5 rounded bg-card-border/10 border border-card-border/20 animate-[fadeIn_0.15s_ease-out]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_major');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_major !== false
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.15)]'
                          : 'text-muted hover:text-foreground bg-transparent border border-transparent'
                          }`}
                        title="Toggle Major Swings (Level 2 Multi-Scale)"
                      >
                        MAJ
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_inner');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_inner !== false
                          ? 'bg-accent/20 border border-accent/40 text-accent shadow-[0_0_6px_rgba(168,85,247,0.15)]'
                          : 'text-muted hover:text-foreground bg-transparent border border-transparent'
                          }`}
                        title="Toggle Inner Swings (Level 1 Multi-Scale)"
                      >
                        INN
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_int');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_int !== false
                          ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.15)]'
                          : 'text-muted hover:text-foreground bg-transparent border border-transparent'
                          }`}
                        title="Toggle Internal Horizontal Levels (Level 2 Swings inside Dealing Range)"
                      >
                        INT
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_istr');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_istr !== false
                          ? 'bg-rose-500/20 border border-rose-500/40 text-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.15)]'
                          : 'text-muted hover:text-foreground bg-transparent border border-transparent'
                          }`}
                        title="Toggle Internal Structure (iSTR)"
                      >
                        iSTR
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

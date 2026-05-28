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
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all duration-300 bg-[#0e0e0f]/85 backdrop-blur-md border-[#4a4457]/30 shadow-2xl ${isOpen ? 'max-w-[700px] opacity-100' : 'max-w-[42px] overflow-hidden'
          }`}
      >
        {/* Toggle Collapse Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors text-white/70 hover:text-white cursor-pointer ${isOpen ? 'rotate-90' : 'rotate-0'
            } duration-300`}
          title="Layer Configuration"
        >
          <Icons.Layers size={14} />
        </button>

        {isOpen && (
          <div className="flex items-center gap-2.5 pl-2 border-l border-[#4a4457]/30 animate-[fadeIn_0.2s_ease-out] whitespace-nowrap">
            {layers.map((layer) => {
              const isVisible = visibility[layer.id] !== false;
              // Dynamically resolve icon from Lucide
              const IconComponent = (Icons as any)[layer.icon] || Icons.HelpCircle;
              const isStructure = layer.id === 'structure';

              return (
                <div key={layer.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleVisibility(layer.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold tracking-wider transition-all duration-200 cursor-pointer ${isVisible
                      ? 'bg-[#a855f7]/15 border border-[#a855f7]/40 text-[#d1bcff] shadow-[0_0_8px_rgba(168,85,247,0.15)]'
                      : 'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60'
                      }`}
                    title={`${layer.name}: ${layer.description}`}
                  >
                    <IconComponent size={10} />
                    <span>{layer.name.split(' ')[0].toUpperCase()}</span>
                  </button>

                  {isStructure && isVisible && (
                    <div className="flex items-center gap-1 px-1 py-0.5 rounded bg-white/5 border border-white/10 animate-[fadeIn_0.15s_ease-out]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_major');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_major !== false
                          ? 'bg-[#50ffaf]/20 border border-[#50ffaf]/40 text-[#50ffaf] shadow-[0_0_6px_rgba(80,255,175,0.15)]'
                          : 'text-white/30 hover:text-white/60 bg-transparent border border-transparent'
                          }`}
                        title="Toggle Major Swings (5-Bar Fractals)"
                      >
                        MAJ
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_inner');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_inner !== false
                          ? 'bg-[#a855f7]/20 border border-[#a855f7]/40 text-[#d1bcff] shadow-[0_0_6px_rgba(168,85,247,0.15)]'
                          : 'text-white/30 hover:text-white/60 bg-transparent border border-transparent'
                          }`}
                        title="Toggle Inner Swings (3-Bar Fractals)"
                      >
                        INN
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVisibility('structure_zigzag');
                        }}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all cursor-pointer ${visibility.structure_zigzag !== false
                          ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.15)]'
                          : 'text-white/30 hover:text-white/60 bg-transparent border border-transparent'
                          }`}
                        title="Toggle Zig-Zag Paths"
                      >
                        ZIG
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

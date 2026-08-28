'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Clock } from 'lucide-react';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h';

interface TimeframeSwitcherProps {
  selectedInterval: Timeframe;
  onChange: (interval: Timeframe) => void;
}

export default function TimeframeSwitcher({ selectedInterval, onChange }: TimeframeSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const timeframes: Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'];

  // Handle clicking outside of dropdown to close it safely
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`px-3 sm:px-3.5 py-1 sm:py-1.5 font-mono text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all duration-200 cursor-pointer flex items-center gap-1.5 sm:gap-2 rounded-full border shadow-sm ${
            isOpen
              ? 'bg-card border-cyan-500/80 dark:border-cyan-500 text-cyan-600 dark:text-white shadow-[0_0_12px_rgba(6,182,212,0.2)]'
              : 'bg-card border-card-border hover:border-accent text-foreground hover:bg-card/80'
          }`}
          id="timeframe-menu-button"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_6px_#22d3ee] shrink-0 animate-pulse" />
          <span>TF: {selectedInterval.toUpperCase()}</span>
          <ChevronDown
            size={12}
            className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyan-500 dark:text-cyan-400' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-36 origin-top-right rounded-lg bg-card/98 border border-card-border shadow-2xl backdrop-blur-xl focus:outline-none animate-in fade-in slide-in-from-top-1 duration-150 overflow-hidden"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="timeframe-menu-button"
        >
          <div className="py-1" role="none">
            {timeframes.map((tf) => {
              const isActive = selectedInterval === tf;
              return (
                <button
                  key={tf}
                  onClick={() => {
                    onChange(tf);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-2 font-mono text-[10px] tracking-wider uppercase cursor-pointer transition-all duration-150 flex items-center justify-between ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 font-black shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                      : 'text-muted hover:text-foreground hover:bg-card-border/20'
                  }`}
                  role="menuitem"
                >
                  <span>{tf.toUpperCase()} Stream</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-950 shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

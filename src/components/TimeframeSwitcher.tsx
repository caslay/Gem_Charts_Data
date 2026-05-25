'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h';

interface TimeframeSwitcherProps {
  selectedInterval: Timeframe;
  onChange: (interval: Timeframe) => void;
}

export default function TimeframeSwitcher({ selectedInterval, onChange }: TimeframeSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h'];

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
          className="bg-card/75 backdrop-blur-md border border-card-border hover:border-accent/60 text-foreground px-4 py-2 font-mono text-[11px] font-black uppercase tracking-widest transition-all duration-200 cursor-pointer flex items-center gap-2 shadow-lg rounded-md"
          id="timeframe-menu-button"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <span>Timeframe: {selectedInterval.toUpperCase()}</span>
          <ChevronDown
            size={12}
            className={`text-slate-500 dark:text-zinc-400 transition-transform duration-250 ${isOpen ? 'rotate-180 text-accent' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-32 origin-top-right rounded-md bg-card/95 backdrop-blur-xl border border-card-border shadow-2xl focus:outline-none animate-in fade-in slide-in-from-top-1 duration-150"
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
                  className={`w-full text-left px-4 py-2.5 font-mono text-[10px] font-black tracking-widest uppercase cursor-pointer transition-all duration-150 first:rounded-t-md last:rounded-b-md ${isActive
                    ? 'bg-accent/10 text-accent border-l-2 border-accent'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-foreground hover:bg-accent/5 border-l-2 border-transparent'
                    }`}
                  role="menuitem"
                >
                  {tf.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

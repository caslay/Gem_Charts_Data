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
          className="bg-zinc-900/80 backdrop-blur-md border border-[#4a4457] hover:border-[#a855f7]/60 text-[#e5e2e3] px-4 py-2 font-mono text-[11px] font-black uppercase tracking-widest transition-all duration-200 cursor-pointer flex items-center gap-2 shadow-lg shadow-black/30"
          id="timeframe-menu-button"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <span>Timeframe: {selectedInterval.toUpperCase()}</span>
          <ChevronDown
            size={12}
            className={`text-[#958da3] transition-transform duration-250 ${isOpen ? 'rotate-180 text-[#a855f7]' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-32 origin-top-right rounded-none bg-zinc-950/90 backdrop-blur-xl border border-[#a855f7]/40 shadow-2xl focus:outline-none animate-in fade-in slide-in-from-top-1 duration-150"
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
                  className={`w-full text-left px-4 py-2.5 font-mono text-[10px] font-black tracking-widest uppercase cursor-pointer transition-all duration-150 ${isActive
                    ? 'bg-[#a855f7]/10 text-[#d1bcff] border-l-2 border-[#a855f7]'
                    : 'text-[#958da3] hover:text-[#e5e2e3] hover:bg-white/5 border-l-2 border-transparent'
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

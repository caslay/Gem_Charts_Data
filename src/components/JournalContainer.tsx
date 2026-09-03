"use client";

import React, { useState } from "react";
import { LiveBinanceJournal } from "./LiveBinanceJournal";
import { JournalTable, type TradeRecord } from "./JournalTable";
import { Zap, BookOpen } from "lucide-react";

interface JournalContainerProps {
  initialTrades: TradeRecord[];
  initialAccount?: {
    current_balance: string | number;
    initial_capital: string | number;
    max_risk_limit_pct: string | number;
  };
}

export function JournalContainer({ initialTrades, initialAccount }: JournalContainerProps) {
  const [activeView, setActiveView] = useState<"live" | "paper">("live");

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Top View Mode Switcher */}
      <div className="flex items-center gap-2 p-1.5 rounded-xl border border-card-border bg-card-bg/60 w-fit">
        <button
          onClick={() => setActiveView("live")}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeView === "live"
              ? "bg-accent text-black shadow-md shadow-accent/20"
              : "text-muted hover:text-foreground hover:bg-card-bg"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Live Exchange & PM2 Daemon</span>
        </button>

        <button
          onClick={() => setActiveView("paper")}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeView === "paper"
              ? "bg-accent text-black shadow-md shadow-accent/20"
              : "text-muted hover:text-foreground hover:bg-card-bg"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Paper Journal & Historical Archive</span>
        </button>
      </div>

      {/* Render Selected View */}
      {activeView === "live" ? (
        <LiveBinanceJournal />
      ) : (
        <JournalTable initialTrades={initialTrades} initialAccount={initialAccount} />
      )}
    </div>
  );
}

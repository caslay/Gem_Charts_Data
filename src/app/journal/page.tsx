import { auth } from "@/auth";
import { JournalContainer } from "@/components/JournalContainer";
import { type TradeRecord } from "@/components/JournalTable";
import Link from "next/link";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex h-[calc(100vh-64px)] w-full items-center justify-center bg-background selection:bg-accent/30 font-sans p-6 transition-colors duration-300">
        <div className="max-w-md w-full glass-panel p-8 flex flex-col items-center text-center border-rose-500/20">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mb-6">
            <Lock className="w-8 h-8 text-rose-500" />
          </div>
          <h2 className="text-lg font-bold text-title uppercase tracking-wider mb-2">
            Unauthorized Access
          </h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            The Flow-State Vault is locked. This terminal page requires an active institutional session to view paper trade history.
          </p>
          <Link
            href="/login?callbackUrl=/journal"
            className="w-full bg-accent hover:bg-accent/80 text-black py-2.5 px-4 font-black text-xs uppercase tracking-widest transition-all text-center rounded-lg shadow-md shadow-accent/10 cursor-pointer"
          >
            Authenticate Terminal
          </Link>
        </div>
      </div>
    );
  }

  const initialTrades: TradeRecord[] = [];
  const initialAccount = {
    current_balance: "10000.0000",
    initial_capital: "10000.0000",
    max_risk_limit_pct: "3.00"
  };

  return (
    <main className="min-h-[calc(100vh-64px)] w-full bg-background selection:bg-accent/30 font-sans p-4 md:p-8 overflow-y-auto relative transition-colors duration-300">
      {/* Background blur effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-card-border pb-6 mb-6 gap-4">
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-bold text-title uppercase tracking-[0.15em]">
              Institutional Trading Journal
            </h1>
            <p className="text-xs text-muted uppercase tracking-widest mt-1.5 font-semibold">
              Live Exchange Fills, PM2 Pipeline & Execution Audit
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
               href="/"
               className="bg-card hover:bg-card/85 border border-card-border hover:border-accent text-muted hover:text-accent px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-all rounded-lg shadow-md cursor-pointer"
            >
              [ Return to Terminal ]
            </Link>
          </div>
        </div>
 
        {/* Dynamic Dual-Mode Container (Live Binance Journal + Legacy Paper Archive) */}
        <JournalContainer initialTrades={initialTrades} initialAccount={initialAccount} />
      </div>
    </main>
  );
}

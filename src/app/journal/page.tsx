import { auth } from "@/auth";
import { sql } from "@vercel/postgres";
import { JournalTable } from "@/components/JournalTable";
import Link from "next/link";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex h-[calc(100vh-64px)] w-full items-center justify-center bg-[#0e0e0f] selection:bg-[#d1bcff]/30 font-sans p-6">
        <div className="max-w-md w-full border border-red-500/30 bg-[#1c1b1c]/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mb-6">
            <Lock className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-black text-[#e5e2e3] uppercase tracking-wider mb-2">
            Unauthorized Access
          </h2>
          <p className="text-sm text-[#958da3] mb-6 leading-relaxed">
            The Flow-State Vault is locked. This terminal page requires an active institutional session to view paper trade history.
          </p>
          <Link
            href="/login"
            className="w-full bg-[#d1bcff] hover:bg-[#d1bcff]/80 text-black py-2.5 px-4 font-black text-xs uppercase tracking-widest transition-all text-center rounded-none shadow-md shadow-[#d1bcff]/10"
          >
            Authenticate Terminal
          </Link>
        </div>
      </div>
    );
  }

  // Fetch logged trades server-side (initial data seed)
  let initialTrades = [];
  try {
    // Self-healing query check
    const { rows } = await sql`
      SELECT * FROM paper_trades
      ORDER BY created_at DESC
    `;
    initialTrades = rows;
  } catch (err) {
    console.warn("[JOURNAL PAGE] Initial DB fetch failed (table might not exist yet):", err);
    // Dynamic table initialization will happen on the first active trade POST, or we can let it fail gracefully here
  }

  return (
    <main className="min-h-[calc(100vh-64px)] w-full bg-[#0e0e0f] selection:bg-[#d1bcff]/30 font-sans p-4 md:p-8 overflow-y-auto relative">
      {/* Background blur effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#d1bcff]/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[#4a4457]/50 pb-6 mb-6 gap-4">
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-black text-[#e5e2e3] uppercase tracking-[0.2em]">
              Automated Trading Journal
            </h1>
            <p className="text-xs text-[#958da3] uppercase tracking-widest mt-1">
              Active Paper Positions & Execution Audit Logs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="bg-[#1c1b1c] border border-[#4a4457] hover:border-[#50ffaf] text-[#958da3] hover:text-[#50ffaf] px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest transition-all rounded-none shadow-md"
            >
              [ Return to Terminal ]
            </Link>
          </div>
        </div>

        {/* Dynamic Interactive CRUD Table Component */}
        <JournalTable initialTrades={initialTrades} />
      </div>
    </main>
  );
}

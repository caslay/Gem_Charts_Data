"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, LineChart, Calculator, Loader2, X } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function NavigationHeader() {
  const pathname = usePathname();
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    setAiAnalysis(null);

    try {
      const dataRes = await fetch('/api/market-data');
      if (!dataRes.ok) throw new Error('Failed to fetch data');
      const data = await dataRes.json();

      const response = await fetch('/api/quant-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      if (response.ok) {
        setAiAnalysis(result.analysis);
      } else {
        setAiAnalysis(`**Error:** ${result.error || 'Failed to fetch analysis.'}`);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis('**Error:** Connection failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const navLinks = [
    {
      name: "Live Dashboard",
      href: "/",
      icon: <Activity className="w-4 h-4" />,
    },
    {
      name: "Backtest Engine",
      href: "/backtest",
      icon: <LineChart className="w-4 h-4" />,
    },
    {
      name: "Compounding Matrix",
      href: "/compounding",
      icon: <Calculator className="w-4 h-4" />,
    },
  ];

  return (
    <header className="bg-[#141415] border-b border-gray-800 sticky top-0 z-50 shadow-md">
      <div className="max-w-12xl mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0 font-bold text-lg tracking-tight mr-8 text-white flex items-center gap-2">
              <div className="w-6 h-6 bg-emerald-500 rounded flex items-center justify-center">
                <span className="text-black text-xs font-black">FS</span>
              </div>
              Flow-State
            </div>
            <nav className="flex space-x-1 sm:space-x-4">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                      }`}
                  >
                    {link.icon}
                    {link.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4 relative">
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-cyan-400 animate-pulse font-medium text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Synthesizing Order Flow...</span>
              </div>
            )}
            {/*
            <button
              onClick={handleAIAnalysis}
              disabled={isAnalyzing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white font-bold text-sm tracking-wide shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🧠 Run AI Analysis
            </button>
            */}
            <button
              onClick={handleAIAnalysis}
              disabled={isAnalyzing}
              className="text-zinc-700 cursor-pointer hover:text-cyan-400 backdrop-blur-lg bg-gradient-to-tr from-transparent via-[rgba(121,121,121,0.16)] to-transparent rounded-md py-2 px-6 shadow hover:shadow-cyan-600 duration-700">
              Run AI Analysis
            </button>


            {aiAnalysis && (
              <div className="absolute top-full right-0 mt-4 w-[800px] max-w-[90vw] p-6 rounded-2xl bg-[#0a0a0a]/95 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(34,211,238,0.2)] max-h-[80vh] overflow-y-auto z-50">
                <div className="text-gray-300 text-sm leading-relaxed space-y-4 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:text-white [&>h2]:text-lg [&>h2]:font-bold [&>h2]:text-cyan-400 [&>h3]:text-base [&>h3]:font-bold [&>h3]:text-cyan-300 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:ml-5 [&>li]:mb-1 [&>strong]:text-white">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiAnalysis}</ReactMarkdown>
                </div>
                <button
                  onClick={() => setAiAnalysis(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                  title="Dismiss Analysis"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

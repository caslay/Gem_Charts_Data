"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LineChart, Calculator } from "lucide-react";

export function NavigationHeader() {
  const pathname = usePathname();

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
        <div className="flex items-center h-16">
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
      </div>
    </header>
  );
}

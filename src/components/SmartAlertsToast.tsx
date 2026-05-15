import React, { useEffect } from 'react';
import { X, AlertTriangle, BellOff, Activity, ShieldAlert } from 'lucide-react';
import type { SmartAlert } from '@/hooks/useLiveAlerts';

interface SmartAlertsToastProps {
  activeAlerts: SmartAlert[];
  dismissAlert: (id: string) => void;
}

export default function SmartAlertsToast({ activeAlerts, dismissAlert }: SmartAlertsToastProps) {
  if (!activeAlerts || activeAlerts.length === 0) return null;

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 pointer-events-none w-full max-w-md px-4">
      {activeAlerts.map(alert => (
        <ToastItem key={alert.id} alert={alert} dismissAlert={dismissAlert} />
      ))}
    </div>
  );
}

function ToastItem({ alert, dismissAlert }: { alert: SmartAlert, dismissAlert: (id: string) => void }) {
  // Auto-dismiss the toast after 6 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      dismissAlert(alert.id);
    }, 6000);
    return () => clearTimeout(timer);
  }, [alert.id, dismissAlert]);

  let baseStyle = "flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-lg pointer-events-auto transition-all duration-500 ease-out translate-y-0 opacity-100";
  let icon = null;

  // Visual mapping for Institutional Flow-State design
  switch (alert.type) {
    case 'PURGE':
      // 🚨 Liquidity Purge: Subtle red/crimson border or glow.
      baseStyle += " bg-[#1a0505]/80 border-red-500/30 text-red-100 shadow-[0_0_20px_rgba(220,38,38,0.15)]";
      icon = <Activity className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />;
      break;
    case 'DEAD_ZONE':
      // 🔕 DEAD_ZONE Mute: Muted gray/zinc tone.
      baseStyle += " bg-[#0a0a0a]/80 border-zinc-700/50 text-zinc-300 shadow-[0_0_15px_rgba(39,39,42,0.5)]";
      icon = <BellOff className="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" />;
      break;
    case 'RISK_OVERRIDE':
    case 'SMT_TRAP':
      // ⚠️ Risk Override / 📉 SMT Trap: Warning amber/yellow tone.
      baseStyle += " bg-[#1a1305]/80 border-amber-500/30 text-amber-100 shadow-[0_0_20px_rgba(217,119,6,0.15)]";
      icon = alert.type === 'SMT_TRAP' 
        ? <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" /> 
        : <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />;
      break;
  }

  return (
    <div className={baseStyle} role="alert">
      {icon}
      <div className="flex-1 text-sm font-medium tracking-wide leading-snug">
        {alert.message}
      </div>
      <button 
        onClick={() => dismissAlert(alert.id)}
        className="shrink-0 p-1.5 -mr-1.5 -mt-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
        aria-label="Dismiss alert"
      >
        <X className="w-4 h-4 opacity-70 hover:opacity-100" />
      </button>
    </div>
  );
}

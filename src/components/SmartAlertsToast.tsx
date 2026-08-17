import React, { useEffect } from 'react';
import {
  X,
  AlertTriangle,
  BellOff,
  Activity,
  ShieldAlert,
  Scale,
  Target,
  Waves,
  Clock,
  Crosshair,
  Zap,
  Layers,
  CheckCircle2
} from 'lucide-react';
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

  let baseStyle = "flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-lg pointer-events-auto transition-all duration-500 ease-out translate-y-0 opacity-100 font-mono";
  let icon = null;
  let badge = null;

  // Visual mapping for Institutional Flow-State & Strategy Architect design
  switch (alert.type) {
    case 'AUTO_ORDER_ROUTED':
      // ⚡ High-Priority Autonomous Execution
      baseStyle += " bg-[#02130e]/95 border-emerald-500/60 text-emerald-100 shadow-[0_0_30px_rgba(16,185,129,0.25)] border-l-4 border-l-cyan-400";
      icon = <Zap className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0 animate-pulse" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5 text-cyan-400" />
          <span>AUTONOMOUS EXECUTION</span>
        </span>
      );
      break;

    case 'STAGE_FILL':
      // 💰 Tranche Scale-Out / Harvest
      baseStyle += " bg-[#0f1205]/95 border-amber-500/50 text-amber-100 shadow-[0_0_25px_rgba(245,158,11,0.2)] border-l-4 border-l-emerald-400";
      icon = <Layers className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
          <span>TRANCHE SCALE (40/40/20)</span>
        </span>
      );
      break;

    case 'LIVE_OB_DETECTED':
      // 🏛️ Fresh Order Block Formed
      baseStyle += " bg-[#060f1c]/95 border-cyan-500/50 text-cyan-100 shadow-[0_0_25px_rgba(6,182,212,0.2)] border-l-4 border-l-cyan-400";
      icon = <Activity className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0 animate-pulse" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
          <Activity className="w-2.5 h-2.5 text-cyan-400" />
          <span>LIVE OB DETECTED</span>
        </span>
      );
      break;

    case 'IN_ZONE_CONFIRMATION_PENDING':
      // ⏳ In-Zone Price Test Awaiting Volumetric Confirmation
      baseStyle += " bg-[#0e1018]/95 border-amber-500/40 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.15)] border-l-4 border-l-amber-400";
      icon = <Crosshair className="w-5 h-5 text-amber-400 mt-0.5 shrink-0 animate-spin" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 text-amber-400" />
          <span>IN-ZONE CONFIRMATION PENDING</span>
        </span>
      );
      break;

    case 'STRATEGY_MATCHED':
      // 🎯 High-contrast brutalist Custom Strategy Match
      baseStyle += " bg-[#000000]/95 border-white/80 text-white shadow-[0_0_30px_rgba(255,255,255,0.15)] border-l-4 border-l-[#50ffaf]";
      icon = <Crosshair className="w-5 h-5 text-[#50ffaf] mt-0.5 shrink-0 animate-pulse" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-[#50ffaf] border border-[#50ffaf]/50 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
          <Crosshair className="w-2.5 h-2.5 text-[#50ffaf]" />
          <span>STRATEGY ARCHITECT</span>
        </span>
      );
      break;

    case 'PURGE':
      // 🚨 Liquidity Purge
      baseStyle += " bg-[#1a0505]/80 border-red-500/30 text-red-100 shadow-[0_0_20px_rgba(220,38,38,0.15)]";
      icon = <Activity className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-500/30 text-[9px] font-black uppercase tracking-wider">
          LIQUIDITY PURGE
        </span>
      );
      break;

    case 'DEAD_ZONE':
      // 🔕 DEAD_ZONE Mute
      baseStyle += " bg-[#0a0a0a]/80 border-zinc-700/50 text-zinc-300 shadow-[0_0_15px_rgba(39,39,42,0.5)]";
      icon = <BellOff className="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-700 text-[9px] font-black uppercase tracking-wider">
          DEAD ZONE
        </span>
      );
      break;

    case 'RISK_OVERRIDE':
    case 'SMT_TRAP':
      // ⚠️ Risk Override / 📉 SMT Trap
      baseStyle += " bg-[#1a1305]/80 border-amber-500/30 text-amber-100 shadow-[0_0_20px_rgba(217,119,6,0.15)]";
      icon = alert.type === 'SMT_TRAP'
        ? <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        : <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30 text-[9px] font-black uppercase tracking-wider">
          {alert.type === 'SMT_TRAP' ? 'SMT TRAP DIVERGENCE' : 'RISK OVERRIDE'}
        </span>
      );
      break;

    case 'PRICING_SHIFT':
      // ⚖️ Cyan/Purple shift
      const isPremium = alert.message.includes('PREMIUM');
      baseStyle += isPremium
        ? " bg-[#0f051a]/80 border-purple-500/30 text-purple-100 shadow-[0_0_20px_rgba(168,85,247,0.15)]"
        : " bg-[#05151a]/80 border-cyan-500/30 text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.15)]";
      icon = <Scale className={`w-5 h-5 mt-0.5 shrink-0 ${isPremium ? 'text-purple-500' : 'text-cyan-500'}`} />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30 text-[9px] font-black uppercase tracking-wider">
          PRICING SHIFT
        </span>
      );
      break;

    case 'OBJECTIVE_UPDATE':
      // 🎯 DOL Target Status
      const isExhausted = alert.message.includes('EXHAUSTED');
      baseStyle += isExhausted
        ? " bg-[#1a0505]/80 border-red-500/30 text-red-100 shadow-[0_0_20px_rgba(220,38,38,0.15)]"
        : " bg-[#0a1a05]/80 border-emerald-500/30 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.15)]";
      icon = <Target className={`w-5 h-5 mt-0.5 shrink-0 ${isExhausted ? 'text-red-500' : 'text-emerald-500'}`} />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-[9px] font-black uppercase tracking-wider">
          DOL OBJECTIVE
        </span>
      );
      break;

    case 'FLOW_STATE':
      // 🌊 Institutional Sponsorship
      baseStyle += " bg-[#051a0a]/80 border-green-500/30 text-green-100 shadow-[0_0_20px_rgba(34,197,94,0.15)]";
      icon = <Waves className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-green-950/80 text-green-300 border border-green-500/30 text-[9px] font-black uppercase tracking-wider">
          FLOW STATE
        </span>
      );
      break;

    case 'SESSION_TRANSITION':
      // 🕒 Neutral Zinc
      baseStyle += " bg-[#0a0a0a]/80 border-zinc-700/50 text-zinc-300 shadow-[0_0_15px_rgba(39,39,42,0.5)]";
      icon = <Clock className="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" />;
      badge = (
        <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-700 text-[9px] font-black uppercase tracking-wider">
          SESSION WINDOW
        </span>
      );
      break;
  }

  return (
    <div className={baseStyle} role="alert">
      {icon}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          {badge}
          <span className="text-[9px] text-zinc-500 font-mono shrink-0">
            {new Date(alert.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-xs font-medium tracking-wide leading-snug break-words">
          {alert.message}
        </div>
      </div>
      <button
        onClick={() => dismissAlert(alert.id)}
        className="shrink-0 p-1 -mr-1 -mt-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
        aria-label="Dismiss alert"
      >
        <X className="w-4 h-4 opacity-70 hover:opacity-100" />
      </button>
    </div>
  );
}

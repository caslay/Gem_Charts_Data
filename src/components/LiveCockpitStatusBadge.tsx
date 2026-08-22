'use client';

import React, { useState, useEffect } from 'react';
import { Shield, Zap, Sparkles, Activity, Sliders } from 'lucide-react';
import {
  ArmedExecutionStatus,
  getArmedExecutionStatus,
  FLOW_STATE_ARMED_STATE_CHANGED,
  SCANNER_PRESETS_CHANGED_EVENT,
} from '@/lib/quantEngine/scannerPresets';
import {
  STRATEGY_AUTO_EXEC_EVENT,
  StrategyAutoExecState,
} from '@/lib/quantEngine/strategyExecutionConfig';

const DEFAULT_SERVER_STATUS: ArmedExecutionStatus = {
  type: 'SWEEP_RECLAIM',
  id: 'factory_sr_golden_default',
  name: 'Golden Sweep & Reclaim',
  isAutoExecEnabled: true,
  symbol: 'ETHUSDC',
  timeframe: '15m',
  updatedAt: 0,
};

interface LiveCockpitStatusBadgeProps {
  onClick?: () => void;
  className?: string;
  variant?: 'compact' | 'full';
}

export default function LiveCockpitStatusBadge({
  onClick,
  className = '',
  variant = 'compact',
}: LiveCockpitStatusBadgeProps) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<ArmedExecutionStatus>(DEFAULT_SERVER_STATUS);

  useEffect(() => {
    setMounted(true);
    setStatus(getArmedExecutionStatus());
    const handleArmedStateChange = (e: Event) => {
      const customEvent = e as CustomEvent<ArmedExecutionStatus>;
      if (customEvent.detail) {
        setStatus(customEvent.detail);
      } else {
        setStatus(getArmedExecutionStatus());
      }
    };

    const handleAutoExecUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<StrategyAutoExecState>;
      setStatus((prev) => ({
        ...prev,
        isAutoExecEnabled:
          prev.type === 'SWEEP_RECLAIM'
            ? customEvent.detail?.isSweepReclaimAutoExecEnabled ?? prev.isAutoExecEnabled
            : prev.type === 'ORDER_BLOCK'
            ? customEvent.detail?.isOrderBlockAutoExecEnabled ?? prev.isAutoExecEnabled
            : true,
      }));
    };

    const handlePresetsChanged = () => {
      setStatus(getArmedExecutionStatus());
    };

    window.addEventListener(FLOW_STATE_ARMED_STATE_CHANGED, handleArmedStateChange);
    window.addEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
    window.addEventListener(SCANNER_PRESETS_CHANGED_EVENT, handlePresetsChanged);
    window.addEventListener('storage', handlePresetsChanged);

    return () => {
      window.removeEventListener(FLOW_STATE_ARMED_STATE_CHANGED, handleArmedStateChange);
      window.removeEventListener(STRATEGY_AUTO_EXEC_EVENT, handleAutoExecUpdate);
      window.removeEventListener(SCANNER_PRESETS_CHANGED_EVENT, handlePresetsChanged);
      window.removeEventListener('storage', handlePresetsChanged);
    };
  }, []);

  const activeStatus = mounted ? status : DEFAULT_SERVER_STATUS;
  const isArmed = activeStatus.isAutoExecEnabled;
  const isCustom = activeStatus.type === 'CUSTOM_STRATEGY';
  const isSR = activeStatus.type === 'SWEEP_RECLAIM';

  const cleanName = activeStatus.name
    .replace(' (Platform Default)', '')
    .replace(' Scalper', '')
    .replace(' Sniper', '');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[10px] font-bold uppercase transition-all duration-200 cursor-pointer flex items-center gap-2 rounded-full px-3 py-1.5 border shrink-0 group ${
        isArmed
          ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.25)] hover:border-emerald-400 hover:shadow-[0_0_16px_rgba(16,185,129,0.4)]'
          : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white shadow-sm'
      } ${className}`}
      title={`Live Strategy: ${activeStatus.name} (${isArmed ? 'ARMED & EXECUTING' : 'STANDBY MODE'})`}
    >
      {/* Animated Glowing Pip */}
      <span className="relative flex h-2 w-2">
        {isArmed && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            isArmed
              ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
              : 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
          }`}
        />
      </span>

      {/* Label & Active Target */}
      <div className="flex items-center gap-1.5">
        <span className={isArmed ? 'text-emerald-400 font-black' : 'text-amber-400 font-black'}>
          {isArmed ? 'ARMED:' : 'STANDBY:'}
        </span>
        <span className="truncate max-w-[130px] sm:max-w-[170px] text-white">
          {cleanName}
        </span>
      </div>

      {/* Strategy Category Pill */}
      {variant === 'full' && (
        <span
          className={`text-[8px] px-1.5 py-0.2 rounded font-black ${
            isSR
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/30'
              : isCustom
              ? 'bg-purple-950 text-purple-300 border border-purple-500/30'
              : 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
          }`}
        >
          {isSR ? 'S&R' : isCustom ? 'CUSTOM' : 'OB'}
        </span>
      )}

      <Sliders className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:rotate-45 transition-all text-slate-400" />
    </button>
  );
}

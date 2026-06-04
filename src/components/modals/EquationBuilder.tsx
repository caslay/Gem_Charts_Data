'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Zap, Lock, Save, Power, PowerOff, Loader2, ChevronRight, Copy, Download } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricKey =
  | 'FVG'
  | 'PRICE_IN_FVG'
  | 'DISPLACEMENT'
  | 'DISPLACEMENT_VALUE'
  | 'OI_TREND'
  | 'MSS'
  | 'SMT'
  | 'SMT_DIVERGENCE'
  | 'PRICE_VS_OPEN'
  | 'EQUILIBRIUM_STATUS'
  | 'TARGET_EXHAUSTION'
  | 'NEARBY_MAGNET'
  | 'AI_DAILY_BIAS'
  | 'MARKET_TREND'
  | 'LOCAL_PRICING'
  | 'MSS_CONFIRMED'
  | 'BOS'
  | 'PRICE_IN_OTE'
  | 'MARKET_VELOCITY'
  | 'STRUCTURE_TYPE'
  | 'LIQUIDATION_STATUS'
  | 'SMART_MONEY_SYNC'
  | 'BTC_RELATIVE_STRENGTH'
  | 'HTF_MAGNET_DIST'
  | 'HIGH_VOLUME_SESSION'
  | 'CURRENT_SESSION'
  | 'MACRO_BIAS'
  | 'PRICE_VS_POC';
export type OperatorKey = 'IS_TRUE' | 'IS_FALSE' | 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN';
export type TemporalMode = 'INSTANT' | 'ON_CLOSE';

export interface StrategyCondition {
  id: string;
  metric: MetricKey;
  operator: OperatorKey;
  value?: string;
  temporal: TemporalMode;
  timeframe?: 'ANY' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h';
  direction?: 'ANY' | 'BULLISH' | 'BEARISH';
  confirmation?: 'CONFIRMED' | 'UNCONFIRMED' | 'ANY';
  retracement?: 'OTE' | 'FIB_50' | 'FIB_60' | 'FIB_705' | 'FIB_79';
}

export interface CustomStrategy {
  id: string;
  name: string;
  conditions: any;
  is_active: boolean;
  target_environment?: 'LIVE_ONLY' | 'BACKTEST_ONLY' | 'BOTH';
}

// ─── Metric Definitions ──────────────────────────────────────────────────────

const METRICS: { key: MetricKey; label: string; type: 'boolean' | 'enum' | 'number'; options?: string[] }[] = [
  { key: 'FVG', label: 'Fair Value Gap', type: 'boolean' },
  { key: 'PRICE_IN_FVG', label: 'Price in FVG', type: 'boolean' },
  { key: 'DISPLACEMENT', label: 'Displacement', type: 'enum', options: ['ANY', 'ACTIVE_BULLISH', 'ACTIVE_BEARISH'] },
  { key: 'DISPLACEMENT_VALUE', label: 'Displacement Value', type: 'number' },
  { key: 'OI_TREND', label: 'OI Trend', type: 'enum', options: ['RISING', 'FALLING', 'FLAT'] },
  { key: 'MSS', label: 'Market Structure Shift', type: 'boolean' },
  { key: 'SMT', label: 'Smart Money Trap', type: 'boolean' },
  { key: 'SMT_DIVERGENCE', label: 'SMT Divergence (BTC/ETH)', type: 'boolean' },
  { key: 'PRICE_VS_OPEN', label: 'Price vs Open', type: 'enum', options: ['ABOVE', 'BELOW'] },
  { key: 'EQUILIBRIUM_STATUS', label: 'Equilibrium Status', type: 'enum', options: ['PREMIUM', 'DISCOUNT'] },
  { key: 'TARGET_EXHAUSTION', label: 'Target Exhaustion', type: 'enum', options: ['PENDING', 'EXHAUSTED', 'ASIAN_HIGH_SWEPT', 'ASIAN_LOW_SWEPT', 'LONDON_HIGH_SWEPT', 'LONDON_LOW_SWEPT'] },
  { key: 'NEARBY_MAGNET', label: 'Nearby Magnet', type: 'boolean' },
  { key: 'AI_DAILY_BIAS', label: 'AI Daily Bias', type: 'enum', options: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
  { key: 'MARKET_TREND', label: 'Market Structure Trend', type: 'enum', options: ['BULLISH', 'BEARISH', 'UNSET'] },
  { key: 'LOCAL_PRICING', label: 'Dealing Range Pricing', type: 'enum', options: ['PREMIUM', 'DISCOUNT'] },
  { key: 'MSS_CONFIRMED', label: 'MSS Shift Confirmed', type: 'boolean' },
  { key: 'BOS', label: 'Break of Structure (BOS)', type: 'boolean' },
  { key: 'PRICE_IN_OTE', label: 'Price Retracement (Fib)', type: 'boolean' },
  { key: 'MARKET_VELOCITY', label: 'Market Velocity (FVGs)', type: 'number' },
  { key: 'STRUCTURE_TYPE', label: 'Structural Wave Type', type: 'enum', options: ['MAJOR', 'INTERNAL'] },
  { key: 'LIQUIDATION_STATUS', label: 'Liquidation Status', type: 'enum', options: ['NORMAL', 'LIQUIDITY_SWEPT'] },
  { key: 'SMART_MONEY_SYNC', label: 'Smart Money Sync', type: 'boolean' },
  { key: 'BTC_RELATIVE_STRENGTH', label: 'BTC Relative Strength', type: 'enum', options: ['LEADER', 'LAGGARD'] },
  { key: 'HTF_MAGNET_DIST', label: 'Distance to Nearest HTF Magnet ($)', type: 'number' },
  { key: 'HIGH_VOLUME_SESSION', label: 'High-Volume Session Gate', type: 'boolean' },
  { key: 'CURRENT_SESSION', label: 'Current Session Timeframe', type: 'enum', options: ['ASIAN_RANGE', 'LONDON_AM_KILLZONE', 'NY_AM_KILLZONE', 'NY_PM_KILLZONE', 'DEAD_ZONE'] },
  { key: 'MACRO_BIAS', label: 'Macro Daily Bias', type: 'enum', options: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
  { key: 'PRICE_VS_POC', label: 'Price vs Swing POC', type: 'enum', options: ['ABOVE_POC', 'BELOW_POC', 'INSIDE_VALUE_AREA'] },
];

function getMetricDef(key: MetricKey) {
  return METRICS.find((m) => m.key === key) || METRICS[0];
}

function getOperatorsForMetric(key: MetricKey): { value: OperatorKey; label: string }[] {
  if (key === 'AI_DAILY_BIAS') {
    return [
      { value: 'EQUALS', label: '==' },
    ];
  }
  const def = getMetricDef(key);
  if (def.type === 'boolean') {
    return [
      { value: 'IS_TRUE', label: 'IS TRUE' },
      { value: 'IS_FALSE', label: 'IS FALSE' },
    ];
  }
  if (def.type === 'number') {
    return [
      { value: 'GREATER_THAN', label: '>' },
      { value: 'LESS_THAN', label: '<' },
      { value: 'EQUALS', label: '==' },
      { value: 'NOT_EQUALS', label: '!=' },
    ];
  }
  return [
    { value: 'EQUALS', label: '==' },
    { value: 'NOT_EQUALS', label: '!=' },
  ];
}

function generateId(): string {
  return `cond-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

function createEmptyCondition(): StrategyCondition {
  return {
    id: generateId(),
    metric: 'FVG',
    operator: 'IS_TRUE',
    temporal: 'INSTANT',
    timeframe: 'ANY',
    direction: 'ANY',
    confirmation: 'CONFIRMED',
    retracement: 'OTE',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EquationBuilder() {
  const [strategies, setStrategies] = useState<CustomStrategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Editor form state
  const [editName, setEditName] = useState('');
  const [editConditions, setEditConditions] = useState<StrategyCondition[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editTemporalMode, setEditTemporalMode] = useState<'INSTANT' | 'ON_CLOSE'>('INSTANT');
  const [editSlLogic, setEditSlLogic] = useState('Structural Swing');
  const [editTpLogic, setEditTpLogic] = useState('Nearest Order Book Magnet');
  const [editDirection, setEditDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [editRiskPercent, setEditRiskPercent] = useState('1.0');
  const [editStatisticalSensitivity, setEditStatisticalSensitivity] = useState<'STRICT' | 'RELAXED' | 'OFF'>('STRICT');
  const [editTargetEnvironment, setEditTargetEnvironment] = useState<'LIVE_ONLY' | 'BACKTEST_ONLY' | 'BOTH'>('BOTH');
  const [editMomentumOverride, setEditMomentumOverride] = useState<boolean>(false);
  const [editTargetTimeframe, setEditTargetTimeframe] = useState<'ANY' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h'>('ANY');

  // ── Fetch strategies from API on mount ────────────────────────────────────
  const fetchStrategies = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/strategies');
      if (res.ok) {
        const data = await res.json();
        setStrategies(data.strategies || []);
      }
    } catch (err) {
      console.error('[EquationBuilder] Failed to fetch strategies:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  // ── Load selected strategy into editor ────────────────────────────────────
  useEffect(() => {
    if (selectedId) {
      const strategy = strategies.find((s) => s.id === selectedId);
      if (strategy) {
        setEditName(strategy.name);
        
        // Extract conditions with backward compatibility support and auto-migration
        const parsedConditions = Array.isArray(strategy.conditions)
          ? strategy.conditions
          : (strategy.conditions?.conditions || []);

        setEditConditions(
          parsedConditions.map((c: any) => {
            const condId = c.id || generateId();
            if (c.metric === 'MSS_CONFIRMED') {
              return {
                ...c,
                id: condId,
                metric: 'MSS',
                operator: c.operator || 'IS_TRUE',
                direction: c.direction || 'ANY',
                confirmation: 'CONFIRMED',
                retracement: 'OTE'
              };
            }
            return {
              ...c,
              id: condId,
              direction: c.direction || 'ANY',
              confirmation: c.confirmation || 'CONFIRMED',
              retracement: c.retracement || 'OTE'
            };
          })
        );
        setEditActive(strategy.is_active);
        setEditTargetEnvironment(strategy.target_environment || 'BOTH');

        // Load strategy-level settings
        const isObj = !Array.isArray(strategy.conditions);
        setEditTemporalMode(isObj ? (strategy.conditions.temporal_mode || 'INSTANT') : 'INSTANT');
        setEditSlLogic(isObj ? (strategy.conditions.sl_logic || 'Structural Swing') : 'Structural Swing');
        setEditTpLogic(isObj ? (strategy.conditions.tp_logic || 'Nearest Order Book Magnet') : 'Nearest Order Book Magnet');
        setEditDirection(isObj ? (strategy.conditions.direction || 'LONG') : 'LONG');
        setEditRiskPercent(isObj ? String(strategy.conditions.risk_percent ?? '1.0') : '1.0');
        setEditStatisticalSensitivity(isObj ? (strategy.conditions.statistical_sensitivity || 'STRICT') : 'STRICT');
        setEditMomentumOverride(isObj ? !!strategy.conditions.momentum_override : false);
        setEditTargetTimeframe(isObj ? (strategy.conditions.target_timeframe || 'ANY') : 'ANY');
        return;
      }
    }
    // No selection — clear
    setEditName('');
    setEditConditions([]);
    setEditActive(true);
    setEditTemporalMode('INSTANT');
    setEditSlLogic('Structural Swing');
    setEditTpLogic('Nearest Order Book Magnet');
    setEditDirection('LONG');
    setEditRiskPercent('1.0');
    setEditStatisticalSensitivity('STRICT');
    setEditTargetEnvironment('BOTH');
    setEditMomentumOverride(false);
    setEditTargetTimeframe('ANY');
  }, [selectedId, strategies]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateNew = () => {
    const newId = `new-${Date.now()}`;
    const newStrategy: CustomStrategy = {
      id: newId,
      name: 'New Strategy',
      conditions: {
        conditions: [createEmptyCondition()],
        temporal_mode: 'INSTANT',
        sl_logic: 'Structural Swing',
        tp_logic: 'Nearest Order Book Magnet',
        direction: 'LONG',
        risk_percent: 1.0,
        statistical_sensitivity: 'STRICT',
        momentum_override: false,
        target_timeframe: 'ANY',
      },
      is_active: true,
      target_environment: 'BOTH',
    };
    setStrategies((prev) => [newStrategy, ...prev]);
    setSelectedId(newId);
  };

  const handleSave = async () => {
    if (!selectedId || !editName.trim()) return;

    setIsSaving(true);
    try {
      const isNew = selectedId.startsWith('new-');
      
      // Save settings and conditions inside the custom strategies payload
      const conditionsPayload = {
        conditions: editConditions.map(({ id, ...rest }) => rest),
        temporal_mode: editTemporalMode,
        sl_logic: editSlLogic,
        tp_logic: editTpLogic,
        direction: editDirection,
        risk_percent: parseFloat(editRiskPercent) || 1.0,
        statistical_sensitivity: editStatisticalSensitivity,
        momentum_override: editMomentumOverride,
        target_timeframe: editTargetTimeframe,
      };

      const payload = {
        ...(isNew ? {} : { id: selectedId }),
        name: editName.trim(),
        conditions: conditionsPayload,
        is_active: editActive,
        target_environment: editTargetEnvironment,
      };

      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        
        const savedStrategy: CustomStrategy = {
          id: isNew && data.id ? data.id : selectedId,
          name: editName.trim(),
          conditions: conditionsPayload,
          is_active: editActive,
          target_environment: editTargetEnvironment,
        };

        if (isNew && data.id) {
          setStrategies((prev) =>
            prev.map((s) => (s.id === selectedId ? savedStrategy : s))
          );
          setSelectedId(data.id);
        } else {
          setStrategies((prev) =>
            prev.map((s) => (s.id === selectedId ? savedStrategy : s))
          );
        }
      }
    } catch (err) {
      console.error('[EquationBuilder] Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    const isNew = selectedId.startsWith('new-');
    if (!isNew) {
      try {
        await fetch('/api/strategies', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedId }),
        });
      } catch (err) {
        console.error('[EquationBuilder] Delete error:', err);
      }
    }

    setStrategies((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const handleToggleActive = async (strategyId: string) => {
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy || strategyId.startsWith('new-')) return;

    const newActive = !strategy.is_active;
    setStrategies((prev) =>
      prev.map((s) => (s.id === strategyId ? { ...s, is_active: newActive } : s))
    );

    try {
      await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: strategyId,
          name: strategy.name,
          conditions: strategy.conditions,
          is_active: newActive,
        }),
      });
    } catch (err) {
      console.error('[EquationBuilder] Toggle error:', err);
    }
  };

  // ── Condition Row Handlers ────────────────────────────────────────────────

  const addCondition = () => {
    setEditConditions((prev) => [...prev, createEmptyCondition()]);
  };

  const removeCondition = (condId: string) => {
    setEditConditions((prev) => prev.filter((c) => c.id !== condId));
  };

  const updateCondition = (condId: string, field: keyof StrategyCondition, value: string) => {
    setEditConditions((prev) =>
      prev.map((c) => {
        if (c.id !== condId) return c;
        const updated = { ...c, [field]: value };

        // Auto-correct operator/value when metric type changes
        if (field === 'metric') {
          const def = getMetricDef(value as MetricKey);
          if (def.type === 'boolean') {
            updated.operator = 'IS_TRUE';
            delete updated.value;
            updated.direction = 'ANY';
            updated.confirmation = 'CONFIRMED';
            updated.retracement = 'OTE';
          } else if (def.type === 'number') {
            updated.operator = 'GREATER_THAN';
            updated.value = '0.0';
            delete updated.direction;
            delete updated.confirmation;
            delete updated.retracement;
          } else {
            updated.operator = 'EQUALS';
            updated.value = def.options?.[0] || '';
            delete updated.direction;
            delete updated.confirmation;
            delete updated.retracement;
          }
        }

        return updated;
      })
    );
  };

  const toggleTemporal = (condId: string) => {
    setEditConditions((prev) =>
      prev.map((c) =>
        c.id === condId
          ? { ...c, temporal: c.temporal === 'INSTANT' ? 'ON_CLOSE' : 'INSTANT' }
          : c
      )
    );
  };

  const [copyFeedback, setCopyFeedback] = useState('Copy JSON');

  const getStrategyJsonString = () => {
    const conditionsPayload = {
      conditions: editConditions.map(({ id, ...rest }) => rest),
      temporal_mode: editTemporalMode,
      sl_logic: editSlLogic,
      tp_logic: editTpLogic,
      direction: editDirection,
      risk_percent: parseFloat(editRiskPercent) || 1.0,
      statistical_sensitivity: editStatisticalSensitivity,
      momentum_override: editMomentumOverride,
      target_timeframe: editTargetTimeframe,
    };

    return JSON.stringify(
      {
        name: editName.trim() || 'Custom Strategy',
        conditions: conditionsPayload,
      },
      null,
      2
    );
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(getStrategyJsonString());
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback('Copy JSON'), 2000);
    } catch (err) {
      console.error('Failed to copy JSON:', err);
    }
  };

  const handleDownloadJson = () => {
    const jsonStr = getStrategyJsonString();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editName.trim().replace(/\s+/g, '_') || 'custom_strategy'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 font-sans">
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
        <span className="ml-2.5 text-[10px] text-muted font-bold uppercase tracking-widest">
          Loading Strategies...
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-0 h-full min-h-[420px] font-sans">
      {/* ── Left: Strategy List ─────────────────────────────────────────── */}
      <div className="w-[180px] shrink-0 border-r border-card-border flex flex-col bg-card/30">
        <div className="p-2 border-b border-card-border/50">
          <button
            onClick={handleCreateNew}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-accent/10 border border-accent/30 hover:bg-accent/20 text-accent text-[9px] font-bold uppercase tracking-widest transition-all cursor-pointer rounded-lg"
          >
            <Plus size={10} />
            New Strategy
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">
          {strategies.length === 0 && (
            <div className="p-3 text-[9px] text-muted text-center font-mono uppercase">
              No strategies configured
            </div>
          )}
          {strategies.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all border-b border-card-border/30 group ${
                selectedId === s.id
                  ? 'bg-accent/10 border-l-2 border-l-accent'
                  : 'hover:bg-card-hover/10 border-l-2 border-l-transparent'
              }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleActive(s.id);
                }}
                className="shrink-0 p-0.5"
                title={s.is_active ? 'Deactivate' : 'Activate'}
              >
                {s.is_active ? (
                  <Power size={10} className="text-emerald-500" />
                ) : (
                  <PowerOff size={10} className="text-muted" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <span
                  className={`block text-[10px] font-bold truncate ${
                    s.is_active ? 'text-title font-semibold' : 'text-muted'
                  }`}
                >
                  {s.name}
                </span>
                <div className="flex items-center flex-wrap gap-1 mt-0.5 select-none">
                  <span className="text-[7.5px] text-muted/80 font-mono">
                    {(Array.isArray(s.conditions) ? s.conditions : (s.conditions?.conditions || [])).length} cond
                  </span>
                  {s.target_environment === 'BACKTEST_ONLY' && (
                    <span className="text-[6.5px] font-black bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1 rounded uppercase">
                      BT Only
                    </span>
                  )}
                  {s.target_environment === 'LIVE_ONLY' && (
                    <span className="text-[6.5px] font-black bg-purple-500/10 text-purple-500 border border-purple-500/20 px-1 rounded uppercase">
                      Live Only
                    </span>
                  )}
                  {s.target_environment === 'BOTH' && (
                    <span className="text-[6.5px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20 px-1 rounded uppercase">
                      Both
                    </span>
                  )}
                </div>
              </div>
              {selectedId === s.id && (
                <ChevronRight size={10} className="text-accent shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Editor Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/20">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center font-sans">
              <div className="text-muted text-[10px] font-bold uppercase tracking-widest mb-1.5">
                Select or create a strategy
              </div>
              <div className="text-muted/60 text-[9px] uppercase tracking-wide">
                Build conditional equations with temporal logic
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Strategy Name */}
            <div className="px-4 pt-3.5 pb-2.5 border-b border-card-border/50 flex flex-col gap-2">
              <div>
                <label className="block text-[8px] text-muted uppercase font-bold tracking-widest mb-1">
                  Strategy Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-background/50 border border-card-border focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-title rounded-lg transition-all shadow-sm"
                  placeholder="e.g. OI Reversal + FVG Confirm"
                />
              </div>

              {/* Quick Checkbox: Backtest Only */}
              <div className="flex items-center gap-2 mt-0.5 select-none">
                <input
                  id="chk-backtest-only"
                  type="checkbox"
                  checked={editTargetEnvironment === 'BACKTEST_ONLY'}
                  onChange={(e) => setEditTargetEnvironment(e.target.checked ? 'BACKTEST_ONLY' : 'BOTH')}
                  className="w-3.5 h-3.5 rounded border-card-border bg-background/50 text-accent focus:ring-accent accent-accent cursor-pointer"
                />
                <label htmlFor="chk-backtest-only" className="text-[9px] font-bold text-slate-400 hover:text-foreground cursor-pointer transition-colors uppercase tracking-wider flex items-center gap-1">
                  I want to test this strategy in Backtest only <span className="text-[7.5px] text-muted font-normal lowercase tracking-normal">(Mutes this strategy from executing on the Live HUD)</span>
                </label>
              </div>
            </div>

            {/* Conditions */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent px-4 py-3.5 space-y-2">
              <div className="glass-panel bg-accent/5 border border-accent/20 p-3 text-[10px] font-sans text-muted leading-relaxed mb-3 rounded-xl">
                <span className="text-accent font-bold uppercase tracking-wider block mb-1">⚡ Sniper Mitigation Protocol:</span>
                Use FVG <span className="font-mono text-[9px] bg-background/40 px-1 py-0.5 rounded border border-card-border/50 font-bold">[CLOSE]</span> to confirm structure. Use <span className="font-mono text-[9px] bg-background/40 px-1 py-0.5 rounded border border-card-border/50 font-bold">PRICE_IN_FVG [TICK]</span> for zero-latency mitigation entries.
              </div>

              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] text-muted uppercase font-bold tracking-widest">
                  Logic Rows
                </span>
                <span className="text-[8px] text-muted/60 font-mono">
                  ALL conditions must be TRUE
                </span>
              </div>

              {editConditions.map((cond, idx) => {
                const metricDef = getMetricDef(cond.metric);
                const operators = getOperatorsForMetric(cond.metric);

                return (
                  <div
                    key={cond.id}
                    className="flex items-center gap-2 glass-panel bg-card/45 border border-card-border/80 p-2.5 rounded-xl group transition-all"
                  >
                    {/* Row number */}
                    <span className="text-[8px] text-muted/60 font-mono w-4 shrink-0 text-center">
                      {idx + 1}
                    </span>

                    {/* Metric */}
                    <select
                      value={cond.metric}
                      onChange={(e) => updateCondition(cond.id, 'metric', e.target.value)}
                      className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-3 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer flex-1 min-w-0 transition-all shadow-sm"
                    >
                      {METRICS.filter((m) => m.key !== 'MSS_CONFIRMED').map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>

                    {/* Operator */}
                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(cond.id, 'operator', e.target.value)}
                      className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-mono text-foreground rounded-lg cursor-pointer w-[86px] shrink-0 transition-all shadow-sm"
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    {/* Timeframe selector (FVG / PRICE_IN_FVG / SMT_DIVERGENCE) */}
                    {(cond.metric === 'FVG' || cond.metric === 'PRICE_IN_FVG' || cond.metric === 'SMT_DIVERGENCE') && (
                      <select
                        value={cond.timeframe || 'ANY'}
                        onChange={(e) => updateCondition(cond.id, 'timeframe', e.target.value)}
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer w-[78px] shrink-0 transition-all shadow-sm"
                      >
                        <option value="ANY">ANY TF</option>
                        <option value="1m">1m</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                        <option value="30m">30m</option>
                        <option value="1h">1h</option>
                        <option value="4h">4h</option>
                      </select>
                    )}

                    {/* Direction selector (FVG / PRICE_IN_FVG / SMT_DIVERGENCE / MSS / BOS) */}
                    {(cond.metric === 'FVG' || cond.metric === 'PRICE_IN_FVG' || cond.metric === 'SMT_DIVERGENCE' || cond.metric === 'MSS' || cond.metric === 'BOS') && (
                      <select
                        value={cond.direction || 'ANY'}
                        onChange={(e) => updateCondition(cond.id, 'direction', e.target.value)}
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer w-[96px] shrink-0 transition-all shadow-sm"
                      >
                        <option value="ANY">ANY DIR</option>
                        <option value="BULLISH">BULLISH</option>
                        <option value="BEARISH">BEARISH</option>
                      </select>
                    )}

                    {/* Confirmation selector (MSS only) */}
                    {cond.metric === 'MSS' && (
                      <select
                        value={cond.confirmation || 'CONFIRMED'}
                        onChange={(e) => updateCondition(cond.id, 'confirmation', e.target.value)}
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer w-[116px] shrink-0 transition-all shadow-sm"
                      >
                        <option value="CONFIRMED">CONFIRMED</option>
                        <option value="UNCONFIRMED">UNCONFIRMED</option>
                        <option value="ANY">ANY STATUS</option>
                      </select>
                    )}

                    {/* Retracement selector (PRICE_IN_OTE only) */}
                    {cond.metric === 'PRICE_IN_OTE' && (
                      <select
                        value={cond.retracement || 'OTE'}
                        onChange={(e) => updateCondition(cond.id, 'retracement', e.target.value)}
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer w-[146px] shrink-0 transition-all shadow-sm"
                      >
                        <option value="OTE">OTE Zone (62%-79%)</option>
                        <option value="FIB_50">At least 50% (Equil)</option>
                        <option value="FIB_60">At least 60%</option>
                        <option value="FIB_705">At least 70.5% (Mid)</option>
                        <option value="FIB_79">At least 79% (Deep)</option>
                      </select>
                    )}

                    {/* Value (only for enum metrics) */}
                    {metricDef.type === 'enum' && metricDef.options && (
                      <select
                        value={cond.value || metricDef.options[0]}
                        onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2 py-2 text-xs font-sans text-foreground rounded-lg cursor-pointer w-[86px] shrink-0 transition-all shadow-sm"
                      >
                        {metricDef.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {cond.metric === 'DISPLACEMENT'
                              ? opt === 'ANY'
                                ? 'Any'
                                : opt === 'ACTIVE_BULLISH'
                                ? 'Bullish'
                                : 'Bearish'
                              : opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Value (only for number metrics) */}
                    {metricDef.type === 'number' && (
                      <input
                        type="text"
                        value={cond.value || ''}
                        onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                        placeholder="0.0"
                        className="bg-background/60 border border-card-border/60 focus:border-accent focus:outline-none px-2.5 py-2 text-xs font-mono text-foreground rounded-lg w-[86px] shrink-0 transition-all shadow-sm"
                      />
                    )}

                    {/* Temporal Toggle */}
                    <button
                      onClick={() => toggleTemporal(cond.id)}
                      title={cond.temporal === 'INSTANT' ? 'Evaluates on every tick' : 'Evaluates only on candle close'}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider border rounded-lg transition-all cursor-pointer shadow-sm ${
                        cond.temporal === 'INSTANT'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 dark:text-amber-400 hover:bg-amber-500/20'
                          : 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                      }`}
                    >
                      {cond.temporal === 'INSTANT' ? (
                        <>
                          <Zap size={9} />
                          <span>TICK</span>
                        </>
                      ) : (
                        <>
                          <Lock size={9} />
                          <span>CLOSE</span>
                        </>
                      )}
                    </button>

                    {/* Delete row */}
                    <button
                      onClick={() => removeCondition(cond.id)}
                      className="shrink-0 p-1.5 text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer rounded-lg opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              })}

              {/* Add Condition button */}
              <button
                onClick={addCondition}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-card-border hover:border-accent text-muted hover:text-accent text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer mb-4 rounded-xl bg-card/20 hover:bg-accent/5"
              >
                <Plus size={10} />
                Add Condition
              </button>

              {/* Strategy Settings Section */}
              <div className="border-t border-card-border/50 pt-4 mt-2">
                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-muted block mb-3 font-sans">
                  Strategy Settings & Trade Execution Parameters
                </span>

                <div className="grid grid-cols-2 gap-4 glass-panel bg-card/40 border border-card-border/80 p-4.5 rounded-2xl shadow-lg">
                   {/* Target Environment */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Target Environment
                    </label>
                    <select
                      value={editTargetEnvironment}
                      onChange={(e) => setEditTargetEnvironment(e.target.value as any)}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="BOTH">BOTH (Live & Backtest)</option>
                      <option value="LIVE_ONLY">LIVE ONLY</option>
                      <option value="BACKTEST_ONLY">BACKTEST ONLY</option>
                    </select>
                  </div>

                  {/* Target Timeframe */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Target Timeframe Lock
                    </label>
                    <select
                      value={editTargetTimeframe}
                      onChange={(e) => setEditTargetTimeframe(e.target.value as any)}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="ANY">ANY (All Timeframes)</option>
                      <option value="1m">1m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="30m">30m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                    </select>
                  </div>

                  {/* Trade Direction */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Trade Direction
                    </label>
                    <select
                      value={editDirection}
                      onChange={(e) => setEditDirection(e.target.value as 'LONG' | 'SHORT')}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="LONG">LONG (Buy Setup)</option>
                      <option value="SHORT">SHORT (Sell Setup)</option>
                    </select>
                  </div>

                  {/* Temporal Mode */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Temporal Mode
                    </label>
                    <select
                      value={editTemporalMode}
                      onChange={(e) => setEditTemporalMode(e.target.value as 'INSTANT' | 'ON_CLOSE')}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="INSTANT">⚡ INSTANT (Mid-candle)</option>
                      <option value="ON_CLOSE">⏳ ON_CLOSE (Candle Confirmation)</option>
                    </select>
                  </div>

                  {/* Stop Loss Logic */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Stop Loss Logic
                    </label>
                    <select
                      value={editSlLogic}
                      onChange={(e) => setEditSlLogic(e.target.value)}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="Structural Swing">Structural Swing (Hard Invalidation)</option>
                      <option value="Last Candle High/Low">Last Candle High/Low</option>
                      <option value="Manual Pips">Manual Pips ($10.00 Offset)</option>
                    </select>
                  </div>

                  {/* Take Profit Logic */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Take Profit Logic
                    </label>
                    <select
                      value={editTpLogic}
                      onChange={(e) => setEditTpLogic(e.target.value)}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="Nearest Order Book Magnet">Nearest Order Book Magnet</option>
                      <option value="PDH/PDL Target">PDH/PDL Target</option>
                      <option value="Manual Pips">Manual Pips (2x Risk RR)</option>
                    </select>
                  </div>

                  {/* Risk per Trade (%) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      Risk per Trade (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100.0"
                      value={editRiskPercent}
                      onChange={(e) => setEditRiskPercent(e.target.value)}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-mono text-foreground rounded-lg w-full transition-all shadow-sm"
                      placeholder="1.0"
                    />
                  </div>
                  
                  {/* Statistical Sensitivity (OLS Gate) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted">
                      OLS Statistical Sensitivity
                    </label>
                    <select
                      value={editStatisticalSensitivity}
                      onChange={(e) => setEditStatisticalSensitivity(e.target.value as 'STRICT' | 'RELAXED' | 'OFF')}
                      className="bg-background/60 border border-card-border/80 hover:border-accent/40 focus:border-accent focus:outline-none px-3.5 py-2.5 text-xs font-sans text-foreground rounded-lg cursor-pointer w-full transition-all shadow-sm"
                    >
                      <option value="STRICT">STRICT (t &ge; 1.96, p &lt; 0.05)</option>
                      <option value="RELAXED">RELAXED (t &ge; 1.65, p &lt; 0.15)</option>
                      <option value="OFF">OFF (Bypass OLS Validation)</option>
                    </select>
                  </div>

                  {/* Momentum Override */}
                  <div className="flex items-center justify-between col-span-2 border-t border-card-border/30 pt-3 mt-1">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] font-black uppercase tracking-wider text-title flex items-center gap-1.5">
                        <Zap size={10} className="text-amber-500 animate-pulse" />
                        Momentum Override (Runaway Market Protection)
                      </label>
                      <span className="text-[7.5px] text-muted leading-relaxed">
                        Bypasses the 50% Equilibrium retracement gate during high-velocity moves (expansion multiplier &gt; 4.0x with unmitigated FVGs).
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={editMomentumOverride}
                      onChange={(e) => setEditMomentumOverride(e.target.checked)}
                      className="w-4 h-4 rounded border-card-border bg-background/50 text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-3.5 border-t border-card-border/50 flex items-center justify-between">
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-rose-500/30 hover:border-rose-500 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 hover:text-rose-400 font-bold transition-all uppercase text-[10px] rounded-lg cursor-pointer shadow-sm shadow-black/5"
              >
                <Trash2 size={10} />
                Delete
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyJson}
                  disabled={!editName.trim() || editConditions.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-700 hover:border-slate-500 rounded bg-slate-900 text-[10px] font-bold uppercase transition disabled:opacity-40 disabled:hover:border-slate-700 cursor-pointer text-slate-300"
                >
                  <Copy size={10} />
                  <span>{copyFeedback}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  disabled={!editName.trim() || editConditions.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-700 hover:border-slate-500 rounded bg-slate-900 text-[10px] font-bold uppercase transition disabled:opacity-40 disabled:hover:border-slate-700 cursor-pointer text-slate-300"
                >
                  <Download size={10} />
                  <span>Download JSON</span>
                </button>
              </div>

              <button
                onClick={handleSave}
                disabled={isSaving || !editName.trim() || editConditions.length === 0}
                className="flex items-center gap-2 px-4.5 py-2.5 bg-accent border border-accent hover:opacity-90 text-black font-black transition-all uppercase text-[10px] rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-accent/10"
              >
                {isSaving ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Save size={10} />
                )}
                {isSaving ? 'Saving...' : 'Save Strategy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

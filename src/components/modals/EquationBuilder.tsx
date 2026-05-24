'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Zap, Lock, Save, Power, PowerOff, Loader2, ChevronRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricKey =
  | 'FVG'
  | 'PRICE_IN_FVG'
  | 'DISPLACEMENT'
  | 'DISPLACEMENT_VALUE'
  | 'OI_TREND'
  | 'MSS'
  | 'SMT'
  | 'PRICE_VS_OPEN'
  | 'EQUILIBRIUM_STATUS'
  | 'TARGET_EXHAUSTION'
  | 'NEARBY_MAGNET';
export type OperatorKey = 'IS_TRUE' | 'IS_FALSE' | 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN';
export type TemporalMode = 'INSTANT' | 'ON_CLOSE';

export interface StrategyCondition {
  id: string;
  metric: MetricKey;
  operator: OperatorKey;
  value?: string;
  temporal: TemporalMode;
  timeframe?: 'ANY' | '5m' | '15m';
  direction?: 'ANY' | 'BULLISH' | 'BEARISH';
}

export interface CustomStrategy {
  id: string;
  name: string;
  conditions: any;
  is_active: boolean;
}

// ─── Metric Definitions ──────────────────────────────────────────────────────

const METRICS: { key: MetricKey; label: string; type: 'boolean' | 'enum' | 'number'; options?: string[] }[] = [
  { key: 'FVG', label: 'Fair Value Gap', type: 'boolean' },
  { key: 'PRICE_IN_FVG', label: 'Price in FVG', type: 'boolean' },
  { key: 'DISPLACEMENT', label: 'Displacement', type: 'boolean' },
  { key: 'DISPLACEMENT_VALUE', label: 'Displacement Value', type: 'number' },
  { key: 'OI_TREND', label: 'OI Trend', type: 'enum', options: ['RISING', 'FALLING', 'FLAT'] },
  { key: 'MSS', label: 'Market Structure Shift', type: 'boolean' },
  { key: 'SMT', label: 'Smart Money Trap', type: 'boolean' },
  { key: 'PRICE_VS_OPEN', label: 'Price vs Open', type: 'enum', options: ['ABOVE', 'BELOW'] },
  { key: 'EQUILIBRIUM_STATUS', label: 'Equilibrium Status', type: 'enum', options: ['PREMIUM', 'DISCOUNT'] },
  { key: 'TARGET_EXHAUSTION', label: 'Target Exhaustion', type: 'enum', options: ['PENDING', 'EXHAUSTED', 'ASIAN_HIGH_SWEPT', 'ASIAN_LOW_SWEPT', 'LONDON_HIGH_SWEPT', 'LONDON_LOW_SWEPT'] },
  { key: 'NEARBY_MAGNET', label: 'Nearby Magnet', type: 'boolean' },
];

function getMetricDef(key: MetricKey) {
  return METRICS.find((m) => m.key === key) || METRICS[0];
}

function getOperatorsForMetric(key: MetricKey): { value: OperatorKey; label: string }[] {
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
        
        // Extract conditions with backward compatibility support
        const parsedConditions = Array.isArray(strategy.conditions)
          ? strategy.conditions
          : (strategy.conditions?.conditions || []);

        setEditConditions(
          parsedConditions.map((c: any) => ({ ...c, id: c.id || generateId() }))
        );
        setEditActive(strategy.is_active);

        // Load strategy-level settings
        const isObj = !Array.isArray(strategy.conditions);
        setEditTemporalMode(isObj ? (strategy.conditions.temporal_mode || 'INSTANT') : 'INSTANT');
        setEditSlLogic(isObj ? (strategy.conditions.sl_logic || 'Structural Swing') : 'Structural Swing');
        setEditTpLogic(isObj ? (strategy.conditions.tp_logic || 'Nearest Order Book Magnet') : 'Nearest Order Book Magnet');
        setEditDirection(isObj ? (strategy.conditions.direction || 'LONG') : 'LONG');
        setEditRiskPercent(isObj ? String(strategy.conditions.risk_percent ?? '1.0') : '1.0');
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
      },
      is_active: true,
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
      };

      const payload = {
        ...(isNew ? {} : { id: selectedId }),
        name: editName.trim(),
        conditions: conditionsPayload,
        is_active: editActive,
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
          } else if (def.type === 'number') {
            updated.operator = 'GREATER_THAN';
            updated.value = '0.0';
          } else {
            updated.operator = 'EQUALS';
            updated.value = def.options?.[0] || '';
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 text-[#d1bcff] animate-spin" />
        <span className="ml-2 text-[10px] text-[#958da3] font-mono uppercase tracking-widest">
          Loading Strategies...
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-0 h-full min-h-[420px]">
      {/* ── Left: Strategy List ─────────────────────────────────────────── */}
      <div className="w-[180px] shrink-0 border-r border-[#4a4457]/50 flex flex-col">
        <div className="p-2 border-b border-[#4a4457]/30">
          <button
            onClick={handleCreateNew}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-[#50ffaf]/10 border border-[#50ffaf]/30 hover:bg-[#50ffaf]/20 text-[#50ffaf] text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
          >
            <Plus size={10} />
            New Strategy
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent">
          {strategies.length === 0 && (
            <div className="p-3 text-[9px] text-[#958da3] text-center font-mono uppercase">
              No strategies configured
            </div>
          )}
          {strategies.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all border-b border-[#4a4457]/20 group ${
                selectedId === s.id
                  ? 'bg-[#50ffaf]/10 border-l-2 border-l-[#50ffaf]'
                  : 'hover:bg-white/3 border-l-2 border-l-transparent'
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
                  <Power size={10} className="text-[#50ffaf]" />
                ) : (
                  <PowerOff size={10} className="text-[#958da3]" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <span
                  className={`block text-[10px] font-bold truncate ${
                    s.is_active ? 'text-[#e5e2e3]' : 'text-[#958da3]'
                  }`}
                >
                  {s.name}
                </span>
                <span className="block text-[8px] text-[#958da3] font-mono">
                  {(Array.isArray(s.conditions) ? s.conditions : (s.conditions?.conditions || [])).length} condition{(Array.isArray(s.conditions) ? s.conditions : (s.conditions?.conditions || [])).length !== 1 ? 's' : ''}
                </span>
              </div>
              {selectedId === s.id && (
                <ChevronRight size={10} className="text-[#50ffaf] shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Editor Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-[#958da3] text-[10px] font-mono uppercase tracking-widest mb-2">
                Select or create a strategy
              </div>
              <div className="text-[#4a4457] text-[9px] font-mono">
                Build conditional equations with temporal logic
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Strategy Name */}
            <div className="px-4 pt-3 pb-2 border-b border-[#4a4457]/30">
              <label className="block text-[8px] text-[#958da3] uppercase font-bold tracking-widest mb-1">
                Strategy Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-[#141416] border border-[#4a4457] focus:border-[#50ffaf] focus:outline-none px-3 py-1.5 text-xs font-mono text-white rounded-none transition-colors"
                placeholder="e.g. OI Reversal + FVG Confirm"
              />
            </div>

            {/* Conditions */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4a4457] scrollbar-track-transparent px-4 py-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] text-[#958da3] uppercase font-bold tracking-widest">
                  Logic Rows
                </span>
                <span className="text-[8px] text-[#4a4457] font-mono">
                  ALL conditions must be TRUE
                </span>
              </div>

              {editConditions.map((cond, idx) => {
                const metricDef = getMetricDef(cond.metric);
                const operators = getOperatorsForMetric(cond.metric);

                return (
                  <div
                    key={cond.id}
                    className="flex items-center gap-1.5 bg-[#141416]/80 border border-[#4a4457]/50 p-2 rounded-none group"
                  >
                    {/* Row number */}
                    <span className="text-[8px] text-[#4a4457] font-mono w-4 shrink-0 text-center">
                      {idx + 1}
                    </span>

                    {/* Metric */}
                    <select
                      value={cond.metric}
                      onChange={(e) => updateCondition(cond.id, 'metric', e.target.value)}
                      className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none cursor-pointer flex-1 min-w-0"
                    >
                      {METRICS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>

                    {/* Operator */}
                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(cond.id, 'operator', e.target.value)}
                      className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none cursor-pointer w-[72px] shrink-0"
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    {/* Timeframe selector (FVG / PRICE_IN_FVG only) */}
                    {(cond.metric === 'FVG' || cond.metric === 'PRICE_IN_FVG') && (
                      <select
                        value={cond.timeframe || 'ANY'}
                        onChange={(e) => updateCondition(cond.id, 'timeframe', e.target.value)}
                        className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none cursor-pointer w-[70px] shrink-0"
                      >
                        <option value="ANY">ANY TF</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                      </select>
                    )}

                    {/* Direction selector (FVG / PRICE_IN_FVG only) */}
                    {(cond.metric === 'FVG' || cond.metric === 'PRICE_IN_FVG') && (
                      <select
                        value={cond.direction || 'ANY'}
                        onChange={(e) => updateCondition(cond.id, 'direction', e.target.value)}
                        className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none cursor-pointer w-[86px] shrink-0"
                      >
                        <option value="ANY">ANY DIR</option>
                        <option value="BULLISH">BULLISH</option>
                        <option value="BEARISH">BEARISH</option>
                      </select>
                    )}

                    {/* Value (only for enum metrics) */}
                    {metricDef.type === 'enum' && metricDef.options && (
                      <select
                        value={cond.value || metricDef.options[0]}
                        onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                        className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none cursor-pointer w-[76px] shrink-0"
                      >
                        {metricDef.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
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
                        className="bg-[#0e0e0f] border border-[#4a4457] focus:border-[#d1bcff] focus:outline-none px-2 py-1 text-[10px] font-mono text-white rounded-none w-[76px] shrink-0"
                      />
                    )}

                    {/* Temporal Toggle */}
                    <button
                      onClick={() => toggleTemporal(cond.id)}
                      title={cond.temporal === 'INSTANT' ? 'Evaluates on every tick' : 'Evaluates only on candle close'}
                      className={`shrink-0 flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-wider border rounded-none transition-all cursor-pointer ${
                        cond.temporal === 'INSTANT'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                          : 'bg-[#d1bcff]/10 border-[#d1bcff]/30 text-[#d1bcff] hover:bg-[#d1bcff]/20'
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
                      className="shrink-0 p-1 text-[#958da3] hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer rounded-none opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              })}

              {/* Add Condition button */}
              <button
                onClick={addCondition}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-[#4a4457]/50 hover:border-[#50ffaf]/30 text-[#958da3] hover:text-[#50ffaf] text-[9px] font-bold uppercase tracking-widest transition-all cursor-pointer mb-4"
              >
                <Plus size={10} />
                Add Condition
              </button>

              {/* Strategy Settings Section */}
              <div className="border-t border-[#4a4457]/30 pt-4 mt-2">
                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[#958da3] block mb-3">
                  Strategy Settings & Trade Execution Parameters
                </span>

                <div className="grid grid-cols-2 gap-4 bg-[#1c1b1c] border border-[#4a4457]/50 p-4 shadow-xl">
                  {/* Trade Direction */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-black uppercase tracking-[0.15em] text-[#958da3]">
                      Trade Direction
                    </label>
                    <select
                      value={editDirection}
                      onChange={(e) => setEditDirection(e.target.value as 'LONG' | 'SHORT')}
                      className="bg-[#0e0e0f] border border-[#4a4457]/60 hover:border-[#d1bcff]/40 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-[10px] font-mono text-white rounded-none cursor-pointer w-full transition-colors"
                    >
                      <option value="LONG">LONG (Buy Setup)</option>
                      <option value="SHORT">SHORT (Sell Setup)</option>
                    </select>
                  </div>

                  {/* Temporal Mode */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-black uppercase tracking-[0.15em] text-[#958da3]">
                      Temporal Mode
                    </label>
                    <select
                      value={editTemporalMode}
                      onChange={(e) => setEditTemporalMode(e.target.value as 'INSTANT' | 'ON_CLOSE')}
                      className="bg-[#0e0e0f] border border-[#4a4457]/60 hover:border-[#d1bcff]/40 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-[10px] font-mono text-white rounded-none cursor-pointer w-full transition-colors"
                    >
                      <option value="INSTANT">⚡ INSTANT (Mid-candle)</option>
                      <option value="ON_CLOSE">⏳ ON_CLOSE (Candle Confirmation)</option>
                    </select>
                  </div>

                  {/* Stop Loss Logic */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-black uppercase tracking-[0.15em] text-[#958da3]">
                      Stop Loss Logic
                    </label>
                    <select
                      value={editSlLogic}
                      onChange={(e) => setEditSlLogic(e.target.value)}
                      className="bg-[#0e0e0f] border border-[#4a4457]/60 hover:border-[#d1bcff]/40 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-[10px] font-mono text-white rounded-none cursor-pointer w-full transition-colors"
                    >
                      <option value="Structural Swing">Structural Swing (Hard Invalidation)</option>
                      <option value="Last Candle High/Low">Last Candle High/Low</option>
                      <option value="Manual Pips">Manual Pips ($10.00 Offset)</option>
                    </select>
                  </div>

                  {/* Take Profit Logic */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-black uppercase tracking-[0.15em] text-[#958da3]">
                      Take Profit Logic
                    </label>
                    <select
                      value={editTpLogic}
                      onChange={(e) => setEditTpLogic(e.target.value)}
                      className="bg-[#0e0e0f] border border-[#4a4457]/60 hover:border-[#d1bcff]/40 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-[10px] font-mono text-white rounded-none cursor-pointer w-full transition-colors"
                    >
                      <option value="Nearest Order Book Magnet">Nearest Order Book Magnet</option>
                      <option value="PDH/PDL Target">PDH/PDL Target</option>
                      <option value="Manual Pips">Manual Pips (2x Risk RR)</option>
                    </select>
                  </div>

                  {/* Risk per Trade (%) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[8px] font-black uppercase tracking-[0.15em] text-[#958da3]">
                      Risk per Trade (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100.0"
                      value={editRiskPercent}
                      onChange={(e) => setEditRiskPercent(e.target.value)}
                      className="bg-[#0e0e0f] border border-[#4a4457]/60 hover:border-[#d1bcff]/40 focus:border-[#50ffaf] focus:outline-none px-3 py-2 text-[10px] font-mono text-white rounded-none w-full transition-colors"
                      placeholder="1.0"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-3 border-t border-[#4a4457]/30 flex items-center justify-between">
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2.5 py-1.5 border border-red-500/30 hover:border-red-500 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold transition-all uppercase text-[9px] rounded-none cursor-pointer"
              >
                <Trash2 size={10} />
                Delete
              </button>

              <button
                onClick={handleSave}
                disabled={isSaving || !editName.trim() || editConditions.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#50ffaf] border border-[#50ffaf] hover:bg-[#40dd96] text-black font-bold transition-all uppercase text-[9px] rounded-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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

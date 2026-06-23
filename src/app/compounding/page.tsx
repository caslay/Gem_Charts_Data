"use client";

import React, { useState } from 'react';
import { SYSTEM_VERSION } from '@/lib/version';
import {
  TrendingUp,
  Activity,
  Settings,
  Calculator,
  DollarSign,
  Target,
  BarChart2,
  ShieldCheck,
  Coins,
  Download,
  Calendar,
  Percent,
  Sliders,
  DollarSign as DollarIcon,
  ChevronRight,
  TrendingDown
} from 'lucide-react';
import { useCompoundingEngine, ProjectionDataPoint } from '@/hooks/useCompoundingEngine';

// Reusable Input Field Component
interface InputGroupProps {
  label: string;
  name: string;
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: React.ReactNode;
}

function InputGroup({ label, name, value, onChange, icon }: InputGroupProps) {
  return (
    <div className="flex flex-col gap-1.5 bg-card/40 border border-card-border p-3.5 rounded-xl hover:border-accent/40 transition-all shadow-sm">
      <label className="text-[9px] text-slate-500 dark:text-zinc-400 font-black mb-0.5 flex items-center gap-1.5 uppercase tracking-widest select-none">
        {icon}
        {label}
      </label>
      <input
        type="number"
        name={name}
        value={value}
        onChange={onChange}
        step="any"
        className="w-full bg-card/60 backdrop-blur-md border border-card-border focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none px-3.5 py-2.5 text-xs text-foreground rounded-lg transition-all shadow-sm font-mono"
      />
    </div>
  );
}

// Sliders for Risk and Win Rate
interface SliderGroupProps {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: React.ReactNode;
}

function SliderGroup({ label, name, value, min, max, step, onChange, icon }: SliderGroupProps) {
  return (
    <div className="flex flex-col gap-2 bg-card/45 border border-card-border p-4 rounded-xl shadow-sm hover:border-accent/45 transition-all">
      <div className="flex justify-between items-baseline select-none">
        <span className="text-[10px] text-slate-500 dark:text-zinc-400 uppercase font-black tracking-widest flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="text-xs font-mono text-accent font-black">{value}%</span>
      </div>
      <input
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className="w-full bg-card-border accent-accent h-1 rounded-lg cursor-pointer"
      />
    </div>
  );
}

export default function CompoundingMatrixPage() {
  const { config, handleChange, projectionData, finalData } = useCompoundingEngine();
  const [hoveredPoint, setHoveredPoint] = useState<ProjectionDataPoint | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);

  const exportAsJSON = () => {
    const jsonString = JSON.stringify(projectionData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flow-state-projections.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportAsCSV = () => {
    const headers = [
      'Period', 'Capital', 'Risk%', 'Risk ($)', 'Wins', 'Losses',
      'Net Profit', 'Total', 'Daily Profit (EGP)', 'Profit (EGP)', 'Total (EGP)'
    ];

    const rows = projectionData.map(d => [
      d.period,
      d.capital.toFixed(2),
      d.riskPercent.toFixed(2),
      d.riskAmount.toFixed(2),
      d.wins.toFixed(2),
      d.losses.toFixed(2),
      d.profit.toFixed(2),
      d.total.toFixed(2),
      d.dailyProfitEGP.toFixed(2),
      d.profitEGP.toFixed(2),
      d.totalEGP.toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flow-state-projections.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // SVG Chart Calculation
  const chartHeight = 220;
  const chartWidth = 800;
  const maxCapital = Math.max(...projectionData.map(d => d.total), config.startingCapital);
  const minCapital = config.startingCapital;

  const points = projectionData.map((d, i) => {
    const x = (i / Math.max(1, config.periods - 1)) * chartWidth;
    const y = maxCapital === minCapital ? chartHeight : chartHeight - ((d.total - minCapital) / (maxCapital - minCapital)) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  const areaPath = `M 0,${chartHeight} L ${points} L ${chartWidth},${chartHeight} Z`;
  const linePath = `M ${points}`;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-4 md:p-8 relative">
      
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-accent/5 rounded-full blur-[140px] pointer-events-none z-0" />
      <div className="absolute bottom-[10%] right-[10%] w-[400px] h-[400px] bg-accent/3 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="max-w-7xl mx-auto space-y-6 relative z-10">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-card-border pb-6 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-accent/10 border border-accent/25 rounded-xl shadow-lg shadow-accent/5">
              <Calculator className="w-5 h-5 text-accent animate-pulse" />
            </div>
            <div>
              <h1 className="text-base lg:text-xl font-black text-foreground tracking-[0.15em] uppercase">
                Flow-State Compounding Engine
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 tracking-widest font-black uppercase mt-0.5">
                Quantitative Risk & Growth Matrix (V{SYSTEM_VERSION})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={exportAsJSON}
              className="flex items-center gap-2 bg-card border border-card-border hover:border-accent text-slate-500 dark:text-zinc-400 hover:text-foreground px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4 text-accent" />
              Export JSON
            </button>

            <button
              onClick={exportAsCSV}
              className="flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border border-emerald-500/20 hover:border-emerald-500/40 transition-all cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Sidebar Controls */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-panel p-5 shadow-xl space-y-5">
              <h2 className="text-xs font-black text-foreground tracking-widest uppercase flex items-center gap-2 border-b border-card-border pb-3">
                <Settings className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                Algorithm Mappings
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <InputGroup
                    label="Starting Capital"
                    name="startingCapital"
                    value={config.startingCapital}
                    onChange={handleChange}
                    icon={<DollarSign className="w-3.5 h-3.5 text-accent" />}
                  />
                  <InputGroup
                    label="Periods"
                    name="periods"
                    value={config.periods}
                    onChange={handleChange}
                    icon={<Calendar className="w-3.5 h-3.5 text-accent" />}
                  />
                </div>

                <SliderGroup
                  label="Exposure Risk"
                  name="riskPercent"
                  value={config.riskPercent}
                  min={0.1}
                  max={25}
                  step={0.1}
                  onChange={handleChange}
                  icon={<Sliders className="w-3.5 h-3.5 text-accent" />}
                />

                <div className="grid grid-cols-2 gap-3">
                  <InputGroup
                    label="R:R Ratio"
                    name="rewardRisk"
                    value={config.rewardRisk}
                    onChange={handleChange}
                    icon={<BarChart2 className="w-3.5 h-3.5 text-accent" />}
                  />
                  <InputGroup
                    label="Trades / Period"
                    name="tradesPerPeriod"
                    value={config.tradesPerPeriod}
                    onChange={handleChange}
                    icon={<Activity className="w-3.5 h-3.5 text-accent" />}
                  />
                </div>

                <SliderGroup
                  label="Win Probability"
                  name="winRate"
                  value={config.winRate}
                  min={1}
                  max={100}
                  step={1}
                  onChange={handleChange}
                  icon={<Target className="w-3.5 h-3.5 text-accent" />}
                />

                <div className="border-t border-card-border my-4 pt-4 space-y-3">
                  <h3 className="text-[10px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Market Fees & Exchange</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <InputGroup
                      label="Win Fee %"
                      name="winFeePercent"
                      value={config.winFeePercent}
                      onChange={handleChange}
                    />
                    <InputGroup
                      label="Fix Fee ($)"
                      name="fixedPeriodFee"
                      value={config.fixedPeriodFee}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="mt-3">
                    <InputGroup
                      label="EGP Rate"
                      name="egpRate"
                      value={config.egpRate}
                      onChange={handleChange}
                      icon={<Coins className="w-3.5 h-3.5 text-amber-500" />}
                    />
                  </div>
                </div>

                <div className="border-t border-card-border my-4 pt-4">
                  <label className="flex items-center gap-3 text-xs font-black uppercase text-slate-900 dark:text-zinc-300 cursor-pointer select-none group hover:text-foreground">
                    <input
                      type="checkbox"
                      name="enableRiskScaling"
                      checked={config.enableRiskScaling}
                      onChange={handleChange}
                      className="rounded border border-card-border w-4 h-4 cursor-pointer accent-accent transition-all"
                    />
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#50ffaf]" />
                      <span>Half Risk Protection</span>
                    </div>
                  </label>
                  {config.enableRiskScaling && (
                    <div className="mt-3">
                      <InputGroup
                        label="Preservation Trigger ($)"
                        name="scalingThreshold"
                        value={config.scalingThreshold}
                        onChange={handleChange}
                      />
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>

          {/* Main Visualizer & Data */}
          <div className="lg:col-span-3 space-y-6">

            {/* Projected Hero Card (Glowing final projected balance) */}
            <div className="glass-panel p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden group select-none transition-all duration-300 border-accent/30 shadow-[0_20px_50px_rgba(var(--accent),0.06)] bg-gradient-to-r from-accent/5 via-transparent to-accent/5 rounded-2xl">
              <div className="absolute -right-10 -bottom-10 w-48 h-48 rounded-full blur-3xl pointer-events-none group-hover:scale-125 transition-all duration-300 bg-accent/15 dark:bg-accent/25" />
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">PROJECTED LEDGER HORIZON</span>
                  <h3 className="text-4xl lg:text-5xl font-black tracking-tight text-foreground font-sans">
                    ${(finalData?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-slate-500 dark:text-zinc-400 font-black uppercase tracking-wider mt-2.5">
                    <span className="flex items-center gap-1.5 bg-card px-2.5 py-1 border border-card-border rounded-lg shadow-sm">
                      <DollarIcon size={11} className="text-accent" />
                      Seed: <span className="text-foreground font-mono font-bold">${config.startingCapital.toLocaleString()}</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-card px-2.5 py-1 border border-card-border rounded-lg shadow-sm">
                      <Calendar size={11} className="text-accent" />
                      Horizon: <span className="text-foreground font-mono font-bold">{config.periods} Periods</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-card px-2.5 py-1 border border-card-border rounded-lg shadow-sm">
                      <TrendingUp size={11} className="text-[#50ffaf]" />
                      ROI: <span className="text-[#50ffaf] font-mono font-bold">+{(((finalData?.total || 0) / Math.max(1, config.startingCapital) - 1) * 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}%</span>
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col items-start md:items-end gap-1 shrink-0 border-t md:border-t-0 md:border-l border-card-border pt-4 md:pt-0 md:pl-6">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">Local Currency Value (EGP)</span>
                  <div className="text-2xl font-black text-amber-500 font-sans">
                    £{((finalData?.total || 0) * config.egpRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <span className="text-[8px] text-slate-400 dark:text-zinc-500 font-black uppercase tracking-wider mt-0.5">At 1 USD = {config.egpRate} EGP</span>
                </div>
              </div>
            </div>

            {/* Growth Curve Chart */}
            <div className="glass-panel p-5 shadow-xl relative overflow-hidden">
              <h2 className="text-xs font-black text-foreground mb-6 uppercase tracking-widest flex items-center gap-2 border-b border-card-border pb-3">
                <Activity className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                Algorithmic Growth Curve
              </h2>

              <div className="w-full overflow-x-auto pb-2 relative">
                <svg viewBox={`0 -20 ${chartWidth} ${chartHeight + 40}`} className="w-full min-w-[600px] h-auto drop-shadow-lg">
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                    <line key={i} x1="0" y1={chartHeight * ratio} x2={chartWidth} y2={chartHeight * ratio} stroke="var(--card-border)" strokeWidth="1" strokeDasharray="4 4" />
                  ))}

                  {/* Area Fill */}
                  <path d={areaPath} fill="url(#chartGradient)" />

                  {/* Line */}
                  <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="3" className="drop-shadow-md" />

                  {/* Points */}
                  {projectionData.filter((_, i) => i % Math.max(1, Math.floor(config.periods / 10)) === 0 || i === config.periods - 1).map((d, i) => {
                    const x = ((d.period - 1) / Math.max(1, config.periods - 1)) * chartWidth;
                    const y = maxCapital === minCapital ? chartHeight : chartHeight - ((d.total - minCapital) / (maxCapital - minCapital)) * chartHeight;
                    return (
                      <circle key={i} cx={x} cy={y} r="4" fill="var(--card)" stroke="var(--accent)" strokeWidth="2" />
                    );
                  })}

                  {/* Interactive hover overlays */}
                  {projectionData.map((d, i) => {
                    const x = (i / Math.max(1, config.periods - 1)) * chartWidth;
                    const colWidth = chartWidth / config.periods;
                    return (
                      <rect
                        key={i}
                        x={x - colWidth / 2}
                        y={0}
                        width={colWidth}
                        height={chartHeight}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={(e) => {
                          const svgEl = e.currentTarget.ownerSVGElement;
                          if (svgEl) {
                            const rect = svgEl.getBoundingClientRect();
                            const yVal = maxCapital === minCapital ? chartHeight : chartHeight - ((d.total - minCapital) / (maxCapital - minCapital)) * chartHeight;
                            setHoveredPoint(d);
                            setHoveredPos({ 
                              x: (x / chartWidth) * rect.width, 
                              y: (yVal / chartHeight) * rect.height
                            });
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredPoint(null);
                          setHoveredPos(null);
                        }}
                      />
                    );
                  })}
                </svg>

                {/* SVG dynamic hover coordinate tooltip */}
                {hoveredPoint && hoveredPos && (
                  <div 
                    className="absolute z-30 pointer-events-none bg-card/95 backdrop-blur-md border border-card-border p-3.5 rounded-xl shadow-xl text-[10px] uppercase font-sans font-black flex flex-col gap-1 transition-all duration-75 select-none"
                    style={{ 
                      left: `${hoveredPos.x + 20}px`, 
                      top: `${hoveredPos.y - 10}px` 
                    }}
                  >
                    <div className="text-slate-500 dark:text-zinc-400">Period {hoveredPoint.period}</div>
                    <div className="text-xs text-[#50ffaf] font-mono">${hoveredPoint.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-amber-500 font-mono">£{hoveredPoint.totalEGP.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP</div>
                  </div>
                )}
              </div>
            </div>

            {/* IPDA Data Matrix (The Table) */}
            <div className="glass-panel shadow-xl overflow-hidden border border-card-border rounded-2xl">
              <div className="p-5 border-b border-card-border">
                <h2 className="text-xs font-black text-foreground uppercase tracking-widest flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                  Growth Execution Matrix
                </h2>
              </div>

              <div className="overflow-x-auto max-h-[500px] scrollbar-thin scrollbar-thumb-card-border scrollbar-track-transparent">
                <table className="w-full text-left text-xs text-slate-500 dark:text-zinc-400 font-sans border-collapse">
                  <thead className="text-[10px] uppercase bg-card/50 text-slate-500 dark:text-zinc-400 font-black tracking-widest sticky top-0 z-10 shadow-sm border-b border-card-border select-none">
                    <tr>
                      <th className="px-6 py-4">Per.</th>
                      <th className="px-6 py-4 text-right">Capital</th>
                      <th className="px-6 py-4 text-center">Risk%</th>
                      <th className="px-6 py-4 text-right">Risk Amount</th>
                      <th className="px-6 py-4 text-center">Wins / Losses</th>
                      <th className="px-6 py-4 text-right text-[#50ffaf]">Net Profit</th>
                      <th className="px-6 py-4 text-right text-foreground font-black">Total Equity</th>
                      <th className="px-6 py-4 text-right text-amber-500">Value (EGP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border bg-card/10 select-text">
                    {projectionData.map((row) => (
                      <tr key={row.period} className="hover:bg-card/45 transition-colors border-b border-card-border last:border-0">
                        <td className="px-6 py-4 font-black text-foreground">{row.period}</td>
                        <td className="px-6 py-4 text-right font-mono">${row.capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase border ${row.riskPercent < config.riskPercent ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-card/50 border-card-border text-slate-500 dark:text-zinc-400'}`}>
                            {row.riskPercent.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-rose-600 dark:text-rose-400 font-mono">${row.riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-center font-semibold font-mono">{row.wins.toFixed(1)} W / {row.losses.toFixed(1)} L</td>
                        <td className="px-6 py-4 text-right text-emerald-600 dark:text-[#50ffaf] font-black font-mono">+${row.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-right text-foreground font-black font-mono">${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-right text-amber-500">
                          <div className="text-[10px] font-semibold">D: £{row.dailyProfitEGP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                          <div className="text-[10px] font-semibold">P: £{row.profitEGP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                          <div className="font-black text-xs">T: £{row.totalEGP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

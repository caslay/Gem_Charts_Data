"use client";

import React from 'react';
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
  Calendar
} from 'lucide-react';
import { useCompoundingEngine, ProjectionDataPoint } from '@/hooks/useCompoundingEngine';

export default function CompoundingMatrixPage() {
  const { config, handleChange, projectionData, finalData } = useCompoundingEngine();

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
    <div className="min-h-screen bg-[#0A0A0B] text-gray-200 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="text-emerald-500 w-8 h-8" />
              Flow-State Compounding Engine
            </h1>
            <p className="text-gray-400 mt-1">Quantitative Risk & Growth Matrix (V8.0)</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-[#141415] border border-gray-800 px-4 py-2 rounded-lg text-sm mr-2">
              <span className="text-gray-500">Target Value (USD): </span>
              <span className="text-emerald-400 font-bold ml-1">${(finalData?.total || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </div>
            
            <button 
              onClick={exportAsJSON}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm transition-colors border border-gray-700"
            >
              <Download className="w-4 h-4 text-blue-400" />
              Export JSON
            </button>
            
            <button 
              onClick={exportAsCSV}
              className="flex items-center gap-2 bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-100 px-4 py-2 rounded-lg text-sm transition-colors border border-emerald-800/50"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Sidebar Controls */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-[#141415] border border-gray-800 rounded-xl p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-400" />
                Algorithm Parameters
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <InputGroup 
                    label="Starting Capital ($)" 
                    name="startingCapital" 
                    value={config.startingCapital} 
                    onChange={handleChange} 
                    icon={<DollarSign className="w-4 h-4" />}
                  />
                  <InputGroup 
                    label="Periods" 
                    name="periods" 
                    value={config.periods} 
                    onChange={handleChange} 
                    icon={<Calendar className="w-4 h-4" />}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <InputGroup 
                    label="Risk (%)" 
                    name="riskPercent" 
                    value={config.riskPercent} 
                    onChange={handleChange} 
                  />
                  <InputGroup 
                    label="R:R Ratio" 
                    name="rewardRisk" 
                    value={config.rewardRisk} 
                    onChange={handleChange} 
                  />
                </div>

                <InputGroup 
                  label="Win Rate (%)" 
                  name="winRate" 
                  value={config.winRate} 
                  onChange={handleChange} 
                  icon={<Target className="w-4 h-4" />}
                />

                <InputGroup 
                  label="Trades / Period" 
                  name="tradesPerPeriod" 
                  value={config.tradesPerPeriod} 
                  onChange={handleChange} 
                />

                <div className="border-t border-gray-800 my-4 pt-4">
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Market Fees & Exchange</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <InputGroup 
                      label="Win Fee (%)" 
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
                      icon={<Coins className="w-4 h-4" />}
                    />
                  </div>
                </div>

                <div className="border-t border-gray-800 my-4 pt-4">
                   <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      name="enableRiskScaling" 
                      checked={config.enableRiskScaling} 
                      onChange={handleChange}
                      className="rounded bg-gray-800 border-gray-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-gray-900 w-4 h-4"
                    />
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    Capital Preservation (Half Risk)
                  </label>
                  {config.enableRiskScaling && (
                    <div className="mt-3">
                       <InputGroup 
                        label="Threshold ($)" 
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
            
            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard 
                title="Projected Value (USD)" 
                value={`$${(finalData?.total || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                subValue={`From $${config.startingCapital.toLocaleString()}`}
                icon={<TrendingUp className="text-emerald-500" />}
              />
              <StatCard 
                title="Projected Value (EGP)" 
                value={`£${((finalData?.total || 0) * config.egpRate).toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                subValue={`At ${config.egpRate} Exchange Rate`}
                icon={<Coins className="text-amber-500" />}
              />
              <StatCard 
                title="Total ROI" 
                value={`${(((finalData?.total || 0) / Math.max(1, config.startingCapital)) * 100).toLocaleString(undefined, {maximumFractionDigits: 0})}%`}
                subValue={`${config.periods} Periods of Execution`}
                icon={<BarChart2 className="text-blue-500" />}
              />
            </div>

            {/* Growth Curve Chart */}
            <div className="bg-[#141415] border border-gray-800 rounded-xl p-5 shadow-xl relative overflow-hidden">
               <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5 text-gray-400" />
                Algorithmic Growth Curve
              </h2>
              
              <div className="w-full overflow-x-auto pb-2">
                <svg viewBox={`0 -20 ${chartWidth} ${chartHeight + 40}`} className="w-full min-w-[600px] h-auto drop-shadow-lg">
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.4"/>
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0"/>
                    </linearGradient>
                  </defs>
                  
                  {/* Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                    <line key={i} x1="0" y1={chartHeight * ratio} x2={chartWidth} y2={chartHeight * ratio} stroke="#1f2937" strokeWidth="1" strokeDasharray="4 4" />
                  ))}

                  {/* Area Fill */}
                  <path d={areaPath} fill="url(#chartGradient)" />
                  
                  {/* Line */}
                  <path d={linePath} fill="none" stroke="#10b981" strokeWidth="3" className="drop-shadow-md" />
                  
                  {/* Points */}
                  {projectionData.filter((_, i) => i % Math.max(1, Math.floor(config.periods / 10)) === 0 || i === config.periods - 1).map((d, i) => {
                    const x = ((d.period - 1) / Math.max(1, config.periods - 1)) * chartWidth;
                    const y = maxCapital === minCapital ? chartHeight : chartHeight - ((d.total - minCapital) / (maxCapital - minCapital)) * chartHeight;
                    return (
                      <circle key={i} cx={x} cy={y} r="4" fill="#0A0A0B" stroke="#10b981" strokeWidth="2" />
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* IPDA Data Matrix (The Table) */}
            <div className="bg-[#141415] border border-gray-800 rounded-xl shadow-xl overflow-hidden">
               <div className="p-5 border-b border-gray-800">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-gray-400" />
                    Data Matrix (CSV Output)
                  </h2>
               </div>
               
               <div className="overflow-x-auto max-h-[500px] scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                 <table className="w-full text-left text-sm text-gray-400">
                   <thead className="text-xs uppercase bg-[#1A1A1C] text-gray-500 sticky top-0 z-10 shadow-md">
                     <tr>
                       <th className="px-4 py-3">Per.</th>
                       <th className="px-4 py-3 text-right">Capital</th>
                       <th className="px-4 py-3 text-center">Risk%</th>
                       <th className="px-4 py-3 text-right">Risk ($)</th>
                       <th className="px-4 py-3 text-center">Win/Lose</th>
                       <th className="px-4 py-3 text-right text-emerald-400">Net Profit</th>
                       <th className="px-4 py-3 text-right text-white font-bold">Total</th>
                       <th className="px-4 py-3 text-right text-amber-500">Value (EGP)</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-800">
                     {projectionData.map((row) => (
                       <tr key={row.period} className="hover:bg-[#1A1A1C] transition-colors">
                         <td className="px-4 py-3 font-medium text-gray-300">{row.period}</td>
                         <td className="px-4 py-3 text-right">${row.capital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                         <td className="px-4 py-3 text-center">
                           <span className={`px-2 py-1 rounded text-xs ${row.riskPercent < config.riskPercent ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-300'}`}>
                              {row.riskPercent.toFixed(2)}%
                           </span>
                         </td>
                         <td className="px-4 py-3 text-right text-red-400">${row.riskAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                         <td className="px-4 py-3 text-center">{row.wins.toFixed(1)} / {row.losses.toFixed(1)}</td>
                         <td className="px-4 py-3 text-right text-emerald-400 font-medium">+${row.profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                         <td className="px-4 py-3 text-right text-white font-bold">${row.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                         <td className="px-4 py-3 text-right text-amber-500">
                           <div className="text-xs">D: £{row.dailyProfitEGP.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                           <div className="text-xs">P: £{row.profitEGP.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                           <div className="font-bold">T: £{row.totalEGP.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
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

// Reusable Components
interface InputGroupProps {
  label: string;
  name: string;
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: React.ReactNode;
}

function InputGroup({ label, name, value, onChange, icon }: InputGroupProps) {
  return (
    <div className="flex flex-col">
      <label className="text-xs text-gray-500 font-medium mb-1 flex items-center gap-1 uppercase tracking-wider">
        {icon}
        {label}
      </label>
      <input
        type="number"
        name={name}
        value={value}
        onChange={onChange}
        step="any"
        className="bg-[#0A0A0B] border border-gray-700 text-white text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block w-full p-2.5 transition-all outline-none"
      />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  subValue: string;
  icon: React.ReactNode;
}

function StatCard({ title, value, subValue, icon }: StatCardProps) {
  return (
    <div className="bg-[#141415] border border-gray-800 p-5 rounded-xl flex items-center justify-between shadow-lg">
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
        <p className="text-xs text-gray-600 mt-1">{subValue}</p>
      </div>
      <div className="bg-[#0A0A0B] p-3 rounded-lg border border-gray-800">
        {icon}
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';

export interface CompoundingConfig {
  startingCapital: number;
  riskPercent: number;
  winRate: number;
  rewardRisk: number;
  tradesPerPeriod: number;
  winFeePercent: number;
  fixedPeriodFee: number;
  periods: number;
  egpRate: number;
  enableRiskScaling: boolean;
  scalingThreshold: number;
}

export interface ProjectionDataPoint {
  period: number;
  capital: number;
  riskPercent: number;
  riskAmount: number;
  wins: number;
  losses: number;
  profit: number;
  total: number;
  dailyProfitEGP: number;
  profitEGP: number;
  totalEGP: number;
}

export function useCompoundingEngine(initialConfig?: Partial<CompoundingConfig>) {
  const [config, setConfig] = useState<CompoundingConfig>({
    startingCapital: 300,
    riskPercent: 2.0,
    winRate: 70,
    rewardRisk: 2.0,
    tradesPerPeriod: 7,
    winFeePercent: 4.0, 
    fixedPeriodFee: 1.0, 
    periods: 60,
    egpRate: 49,
    enableRiskScaling: true,
    scalingThreshold: 75000,
    ...initialConfig
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : parseFloat(value) || 0
    }));
  };

  const projectionData = useMemo(() => {
    let currentCapital = config.startingCapital;
    const data: ProjectionDataPoint[] = [];

    for (let i = 1; i <= config.periods; i++) {
      let activeRisk = config.riskPercent;
      if (config.enableRiskScaling && currentCapital >= config.scalingThreshold) {
        activeRisk = config.riskPercent / 2;
      }

      const riskAmount = currentCapital * (activeRisk / 100);
      
      const expectedWins = config.tradesPerPeriod * (config.winRate / 100);
      const expectedLosses = config.tradesPerPeriod * ((100 - config.winRate) / 100);

      const grossWins = expectedWins * (riskAmount * config.rewardRisk);
      const grossLosses = expectedLosses * riskAmount;
      
      const feesDeduction = grossWins * (config.winFeePercent / 100);
      const netWins = grossWins - feesDeduction;
      
      const periodProfit = netWins - grossLosses;
      const totalBeforeFixedFee = currentCapital + periodProfit;
      
      const dailyProfitEstimate = periodProfit / 3.8;
      
      data.push({
        period: i,
        capital: currentCapital,
        riskPercent: activeRisk,
        riskAmount: riskAmount,
        wins: expectedWins,
        losses: expectedLosses,
        profit: periodProfit,
        total: totalBeforeFixedFee,
        dailyProfitEGP: dailyProfitEstimate * config.egpRate,
        profitEGP: periodProfit * config.egpRate,
        totalEGP: totalBeforeFixedFee * config.egpRate
      });

      currentCapital = totalBeforeFixedFee - config.fixedPeriodFee;
    }

    return data;
  }, [config]);

  const finalData = projectionData[projectionData.length - 1];

  return { config, setConfig, handleChange, projectionData, finalData };
}

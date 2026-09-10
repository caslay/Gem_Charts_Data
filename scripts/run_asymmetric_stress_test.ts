/**
 * scripts/run_asymmetric_stress_test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategic Quantitative Stress Test Runner:
 * Eliminating Rule 4 Early Breakeven Fee Drag & Restructuring Trade Geometry
 * for 1:2 to 1:3 Asymmetric Risk-to-Reward.
 *
 * Evaluates:
 *  1. Control: Legacy Rule 4 Baseline V3 (factory_sr_5m_fvg_ce_sniper_v3)
 *  2. Control: Legacy Rule 4 Baseline V2 (factory_sr_5m_fvg_ce_sniper_v2)
 *  3. Step 1: Rule 4 Early BE Disabled Isolated (+0.40R removed)
 *  4. Step 2: Tier-1 Anchor Isolation (Minor 5m pivots suppressed)
 *  5. Step 3: Tier-1 Anchors + Top-Down HTF Order Flow Gate
 *  6. Step 4: Tier-1 Anchors + HTF Gate + LTF Confirmed Displacement MSS
 *  7. Full Asymmetric Restructured Architecture (FVG 50% CE + Dynamic 1:2-1:3 R:R)
 *  8. Full Asymmetric Restructured Architecture (OTE 62% Mitigation + Dynamic 1:2-1:3 R:R)
 *  9. Full Asymmetric Architecture (Fixed 1:2.5 R:R Targets)
 * 10. Full Asymmetric Architecture (60m Post-Loss Cooldown)
 *
 * Uses 1-Year Historical Dataset: 105,120 5m ETHUSDC candles (Aug 2025 – Sep 2026).
 * Enforces 100% Bit-for-Bit Parity with Binance USDⓈ-M Futures (0.00% Maker / 0.04% Taker).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SweepReclaimEngine,
  SweepReclaimScanConfig,
  SweepReclaimAnchorType,
} from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';
import {
  calculate1to1ExecutionTelemetry,
  calculateCompoundingMetrics,
} from '../src/lib/quantEngine/equityCalculator';

interface StressTestExperiment {
  id: string;
  name: string;
  category: 'BASELINE' | 'STEP_ISOLATION' | 'ASYMMETRIC_STRUCTURE';
  config: SweepReclaimScanConfig;
  description: string;
}

interface StressTestResult {
  id: string;
  name: string;
  category: string;
  totalExecutedTrades: number;
  winningTrades: number;
  losingTrades: number;
  scratches: number;
  winRatePct: number;
  winRateExScratchPct: number;
  scratchRatePct: number;
  grossRealizedR: number;
  totalFeesPaidR: number;
  netRealizedR: number;
  avgTradeNetR: number;
  avgWinR: number;
  avgLossR: number;
  realizedRRRatio: number;
  grossProfitFactor: number;
  netProfitFactor: number;
  maxDrawdownR: number;
  compoundedMaxDDPct: number;
  finalEquity1k: number;
  netPnlUsd: number;
  netRoiPct: number;
  feeToGrossRatioPct: number;
  cooldownVetoCount: number;
  concurrencyVetoCount: number;
}

async function main() {
  console.log('═'.repeat(120));
  console.log('🏹 QUEGAR QUANT ENGINE — STRATEGIC ASYMMETRIC STRESS TEST (NO EARLY BE / 1:2 to 1:3 R:R)');
  console.log('═'.repeat(120));

  const scratchDir = path.join(process.cwd(), 'scratch');
  const cacheFile = 'cached_ETHUSDC_5m_1y_1756512000000_1788480000000.json';
  const cachePath = path.join(scratchDir, cacheFile);

  if (!fs.existsSync(cachePath)) {
    throw new Error(`Candle cache file not found at: ${cachePath}`);
  }

  console.log(`📂 Loading historical 1-Year ETHUSDC dataset: ${cacheFile}...`);
  const rawData = fs.readFileSync(cachePath, 'utf8');
  const candles: Candle[] = JSON.parse(rawData);
  console.log(`✅ Loaded ${candles.length.toLocaleString()} candles.`);
  console.log(`   Start: ${new Date(candles[0].t).toISOString()}`);
  console.log(`   End:   ${new Date(candles[candles.length - 1].t).toISOString()}\n`);

  const tier1Anchors: SweepReclaimAnchorType[] = [
    'SWING_PIVOT',
    'PDH',
    'PDL',
    'ASIAN_HIGH',
    'ASIAN_LOW',
    'LONDON_HIGH',
    'LONDON_LOW',
  ];

  const experiments: StressTestExperiment[] = [
    // ── 1. Controls ──────────────────────────────────────────────────────────
    {
      id: 'CTRL-01-V3-CHAMPION',
      name: 'Legacy V3 Champion Baseline (+0.40R Early BE, 1.0R/1.3R Fixed)',
      category: 'BASELINE',
      description: 'Crowned V3 Champion with Rule 4 Early BE (+0.40R), 0.015% Fee Shield, all anchors.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW'],
        suppressInternalPivots: false,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.10,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: false,
        requireMssConfirmation: false,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: true,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },
    {
      id: 'CTRL-02-V2-BASELINE',
      name: 'Legacy V2 Baseline (+0.40R Early BE, 0.05% Offset, Swings+Daily)',
      category: 'BASELINE',
      description: 'V2 Pre-fee baseline champion with wide 0.05% offset, Rule 4 Early BE (+0.40R).',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL'],
        suppressInternalPivots: false,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.10,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: false,
        requireMssConfirmation: false,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: true,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.05,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },

    // ── 2. Step-by-Step Isolation ────────────────────────────────────────────
    {
      id: 'STEP-01-NO-EARLY-BE',
      name: 'Step 1: Rule 4 Early BE Disabled in Isolation (V3 Base)',
      category: 'STEP_ISOLATION',
      description: 'Direct isolated test: Disabling Rule 4 early BE on V3 Champion without other modifications.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW'],
        suppressInternalPivots: false,
        lookbackMajor: 10,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 25,
        maxBarsSweepToReclaim: 10,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.10,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: false,
        requireMssConfirmation: false,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false, // 🔬 ISOLATED RULE 4 REMOVAL
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },
    {
      id: 'STEP-02-ANCHOR-ISOLATION',
      name: 'Step 2: Tier-1 Anchor Isolation (Minor 5m Pivots Suppressed, No Early BE)',
      category: 'STEP_ISOLATION',
      description: 'Directive 1: Exclusively Tier-1 Anchors (Asian/London/PDH/PDL/Major pivots), suppress minor 5m pivots.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true, // 🔬 DIRECTIVE 1: ANCHOR ISOLATION
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: false,
        requireMssConfirmation: false,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },
    {
      id: 'STEP-03-HTF-GATE',
      name: 'Step 3: Tier-1 Anchors + Top-Down HTF Order Flow Gate (No Early BE)',
      category: 'STEP_ISOLATION',
      description: 'Directive 2: Top-down 1H/15m trend confluence. Veto counter-trend reclaims unless macro pool purged.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true, // 🔬 DIRECTIVE 2: HTF ORDER FLOW GATE
        requireMssConfirmation: false,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },
    {
      id: 'STEP-04-CONFIRMED-MSS',
      name: 'Step 4: Tier-1 Anchors + HTF Gate + Confirmed LTF Displacement MSS',
      category: 'STEP_ISOLATION',
      description: 'Directive 3: Require confirmed physical body close beyond internal swing pivot after sweep.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true,
        requireMssConfirmation: true, // 🔬 DIRECTIVE 3: CONFIRMED MSS
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 1.30,
        stage3Multiple: 0.0,
        stage1Ratio: 0.60,
        stage2Ratio: 0.40,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 0,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },

    // ── 3. Full Asymmetric Restructured Architecture ────────────────────────
    {
      id: 'ASYMM-01-DYNAMIC-FVG-CE',
      name: 'Asymmetric Structure A (FVG 50% CE + Dynamic 1:2-1:3 R:R + 45m CD)',
      category: 'ASYMMETRIC_STRUCTURE',
      description: 'Full Asymmetric Model: Tier-1 Anchors, HTF Gate, MSS Confirmation, FVG 50% CE, Dynamic TP1 (DR EQ) / TP2 (Opposing Liquidity >= 2.0R), SL to BE after TP1, Rule 5 45m cooldown.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true,
        requireMssConfirmation: true,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'DYNAMIC_LIQUIDITY', // 🔬 DIRECTIVE 4: DYNAMIC TARGET ROUTING
        dynamicTp1Source: 'DEALING_RANGE_EQ',
        dynamicTp2Source: 'OPPOSING_LIQUIDITY',
        minDynamicTp1Multiple: 1.0,
        maxDynamicTp1Multiple: 1.5,
        minDynamicTp2Multiple: 2.0, // 🔬 Minimum 1:2 R:R Constraint
        maxDynamicTp2Multiple: 3.5,
        stage1Multiple: 1.0,
        stage2Multiple: 2.0,
        stage3Multiple: 0.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false, // 🔬 RULE 4 EARLY BE DISABLED
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 45, // 🔬 RULE 5 COOLDOWN PRESERVED
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },

    {
      id: 'ASYMM-02-DYNAMIC-OTE-62',
      name: 'Asymmetric Structure B (OTE 62% Mitigation + Dynamic 1:2-1:3 R:R + 45m CD)',
      category: 'ASYMMETRIC_STRUCTURE',
      description: 'Same as Structure A but utilizing deep 62% Fibonacci retracement mitigation entry (OTE_62).',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true,
        requireMssConfirmation: true,
        entryMode: 'OTE_62', // 🔬 OTE 62% RETRACEMENT MITIGATION
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'DYNAMIC_LIQUIDITY',
        dynamicTp1Source: 'DEALING_RANGE_EQ',
        dynamicTp2Source: 'OPPOSING_LIQUIDITY',
        minDynamicTp1Multiple: 1.0,
        maxDynamicTp1Multiple: 1.5,
        minDynamicTp2Multiple: 2.0,
        maxDynamicTp2Multiple: 3.5,
        stage1Multiple: 1.0,
        stage2Multiple: 2.0,
        stage3Multiple: 0.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 45,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },

    {
      id: 'ASYMM-03-FIXED-1TO2.5',
      name: 'Asymmetric Structure C (Fixed 1:1.0 / 1:2.5 R:R Targets + 45m CD)',
      category: 'ASYMMETRIC_STRUCTURE',
      description: 'Asymmetric model with fixed 1:1.0 TP1 / 1:2.5 TP2 targets to test pure geometric expansion.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true,
        requireMssConfirmation: true,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'FIXED_RR',
        stage1Multiple: 1.0,
        stage2Multiple: 2.5, // 🔬 1:2.5 R:R Fixed Expansion
        stage3Multiple: 0.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 45,
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },

    {
      id: 'ASYMM-04-60M-COOLDOWN',
      name: 'Asymmetric Structure D (FVG 50% CE + Dynamic Targets + 60m Cooldown)',
      category: 'ASYMMETRIC_STRUCTURE',
      description: 'Asymmetric Structure A with extended 60-minute post-loss cooldown for maximum streak protection.',
      config: {
        symbol: 'ETHUSDC',
        timeframe: '5m',
        anchorTypes: tier1Anchors,
        suppressInternalPivots: true,
        lookbackMajor: 15,
        lookbackInternal: 5,
        maxBarsAnchorToSweep: 35,
        maxBarsSweepToReclaim: 12,
        maxBarsToRetest: 15,
        volumeSmaPeriod: 20,
        volumeExpansionThreshold: 1.20,
        deltaDominanceThreshold: 52.0,
        bodyRatioThreshold: 0.40,
        requireThreePillarDisplacement: true,
        enforceDiscountPremiumGate: true,
        enforceHtfBiasGuard: true,
        requireMssConfirmation: true,
        entryMode: 'FVG_CE',
        slBufferAtrMultiplier: 0.10,
        minSweepDepthAtrMultiplier: 0.10,
        enableStructuralTrail: true,
        enableProfitRatchet: false,
        targetMode: 'DYNAMIC_LIQUIDITY',
        dynamicTp1Source: 'DEALING_RANGE_EQ',
        dynamicTp2Source: 'OPPOSING_LIQUIDITY',
        minDynamicTp1Multiple: 1.0,
        maxDynamicTp1Multiple: 1.5,
        minDynamicTp2Multiple: 2.0,
        maxDynamicTp2Multiple: 3.5,
        stage1Multiple: 1.0,
        stage2Multiple: 2.0,
        stage3Multiple: 0.0,
        stage1Ratio: 0.50,
        stage2Ratio: 0.50,
        stage3Ratio: 0.00,
        enableEarlyBreakeven: false,
        earlyBreakevenMultiple: 0.40,
        enableFeePaddedBreakeven: true,
        breakevenOffsetPct: 0.015,
        enableWaveDeduplication: true,
        filterWeekend: false,
        filterDeadZones: false,
        postLossCooldownMinutes: 60, // 🔬 60-MINUTE POST-LOSS COOLDOWN
        makerFeePct: 0.0,
        takerFeePct: 0.04,
      },
    },
  ];

  console.log(`🚀 Executing ${experiments.length} Candle-by-Candle Path-Dependent Stress Backtests...\n`);

  const results: StressTestResult[] = [];

  for (let idx = 0; idx < experiments.length; idx++) {
    const exp = experiments[idx];
    process.stdout.write(`[${idx + 1}/${experiments.length}] Simulating ${exp.name}... `);
    const t0 = Date.now();

    const engine = new SweepReclaimEngine(exp.config);
    const scanResult = engine.scanHistoricalSetups(candles);
    const setups = scanResult.setups || [];

    const makerFeePct = exp.config.makerFeePct ?? 0.0000;
    const takerFeePct = exp.config.takerFeePct ?? 0.0400;

    const summary = calculate1to1ExecutionTelemetry(setups, {
      enforceSinglePositionWalk: true,
      enableWaveDeduplication: exp.config.enableWaveDeduplication !== false,
      filterWeekend: exp.config.filterWeekend === true,
      filterDeadZones: exp.config.filterDeadZones === true,
      enforceHtfBiasGuard: exp.config.enforceHtfBiasGuard === true,
      enableEarlyBreakeven: exp.config.enableEarlyBreakeven === true,
      earlyBreakevenMultiple: exp.config.earlyBreakevenMultiple ?? 0.40,
      enableFeePaddedBreakeven: exp.config.enableFeePaddedBreakeven !== false,
      breakevenOffsetPct: exp.config.breakevenOffsetPct ?? 0.015,
      postLossCooldownMinutes: exp.config.postLossCooldownMinutes ?? 0,
      makerFeePct,
      takerFeePct,
    });

    const compounding = calculateCompoundingMetrics(summary.executedTrades, {
      initialCapital: 1000.0,
      riskPerTradePct: 2.0,
      compoundingMode: 'DYNAMIC_COMPOUNDING',
      makerFeePct,
      takerFeePct,
    });

    const closedTrades = summary.executedTrades.filter((t) => t.outcome !== 'PENDING');
    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter((t) => t.isWin).length;
    const losses = closedTrades.filter((t) => t.isLoss).length;
    const scratches = closedTrades.filter((t) => t.isScratch).length;

    const winRatePct = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(1)) : 0;
    const winRateExScratchPct = (wins + losses) > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
    const scratchRatePct = totalTrades > 0 ? parseFloat(((scratches / totalTrades) * 100).toFixed(1)) : 0;

    let grossR = 0;
    let totalFeesR = 0;
    let netR = 0;
    let sumWinR = 0;
    let sumLossR = 0;

    for (const t of closedTrades) {
      const gR = t.realizedR;
      const nR = t.netRealizedR ?? gR;
      const feeR = t.feeInR ?? 0;

      grossR += gR;
      totalFeesR += feeR;
      netR += nR;

      if (nR > 0) sumWinR += nR;
      if (nR < 0) sumLossR += Math.abs(nR);
    }

    const avgWinR = wins > 0 ? parseFloat((sumWinR / wins).toFixed(2)) : 0;
    const avgLossR = losses > 0 ? parseFloat((sumLossR / losses).toFixed(2)) : 0;
    const realizedRRRatio = avgLossR > 0 ? parseFloat((avgWinR / avgLossR).toFixed(2)) : 0;
    const avgTradeNetR = totalTrades > 0 ? parseFloat((netR / totalTrades).toFixed(3)) : 0;

    const grossPF = compounding.grossProfitFactor ?? (compounding.grossLossUsd > 0 ? compounding.grossProfitUsd / compounding.grossLossUsd : 0);
    const netPF = compounding.netProfitFactor ?? compounding.profitFactor;
    const feeToGrossPct = grossR > 0 ? parseFloat(((totalFeesR / grossR) * 100).toFixed(1)) : 999;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s. Trades: ${totalTrades} | Net R: ${netR.toFixed(2)}R | Net PF: ${netPF.toFixed(2)} | Fees: -${totalFeesR.toFixed(2)}R`);

    results.push({
      id: exp.id,
      name: exp.name,
      category: exp.category,
      totalExecutedTrades: totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      scratches,
      winRatePct,
      winRateExScratchPct,
      scratchRatePct,
      grossRealizedR: parseFloat(grossR.toFixed(2)),
      totalFeesPaidR: parseFloat(totalFeesR.toFixed(2)),
      netRealizedR: parseFloat(netR.toFixed(2)),
      avgTradeNetR,
      avgWinR,
      avgLossR,
      realizedRRRatio,
      grossProfitFactor: parseFloat(grossPF.toFixed(2)),
      netProfitFactor: parseFloat(netPF.toFixed(2)),
      maxDrawdownR: parseFloat((summary.netMaxDrawdownR ?? summary.maxDrawdownR).toFixed(2)),
      compoundedMaxDDPct: parseFloat(compounding.maxDrawdownPct.toFixed(1)),
      finalEquity1k: parseFloat(compounding.finalRealizedEquity.toFixed(2)),
      netPnlUsd: parseFloat(compounding.realizedNetPnlUsd.toFixed(2)),
      netRoiPct: parseFloat(compounding.realizedNetRoiPct.toFixed(1)),
      feeToGrossRatioPct: feeToGrossPct,
      cooldownVetoCount: summary.vetoedBreakdown?.cooldownVetoCount ?? 0,
      concurrencyVetoCount: summary.vetoedBreakdown?.concurrencyVetoCount ?? 0,
    });
  }

  // ── Output Formatted Comparative Table ─────────────────────────────────────
  console.log('\n' + '═'.repeat(160));
  console.log('📊 COMPARATIVE QUANTITATIVE TELEMETRY BREAKDOWN (1-YEAR ETHUSDC · 105,120 5M CANDLES)');
  console.log('═'.repeat(160));

  const tableHeader = [
    'ID'.padEnd(24),
    'Trades'.padStart(7),
    'W/L/S'.padStart(14),
    'Win%'.padStart(7),
    'ExSc%'.padStart(7),
    'Scr%'.padStart(7),
    'Gross R'.padStart(10),
    'Fees R'.padStart(9),
    'Net R'.padStart(9),
    'Avg Win'.padStart(8),
    'Avg Loss'.padStart(9),
    'R:R'.padStart(6),
    'Gross PF'.padStart(9),
    'Net PF'.padStart(8),
    'Max DD'.padStart(8),
    'Comp DD%'.padStart(9),
    '$1k Eq'.padStart(12),
    'Fee/Gross%'.padStart(11),
  ].join(' | ');

  console.log(tableHeader);
  console.log('─'.repeat(160));

  for (const r of results) {
    const row = [
      r.id.padEnd(24),
      r.totalExecutedTrades.toString().padStart(7),
      `${r.winningTrades}/${r.losingTrades}/${r.scratches}`.padStart(14),
      `${r.winRatePct}%`.padStart(7),
      `${r.winRateExScratchPct}%`.padStart(7),
      `${r.scratchRatePct}%`.padStart(7),
      `${r.grossRealizedR > 0 ? '+' : ''}${r.grossRealizedR.toFixed(1)}R`.padStart(10),
      `-${r.totalFeesPaidR.toFixed(1)}R`.padStart(9),
      `${r.netRealizedR > 0 ? '+' : ''}${r.netRealizedR.toFixed(1)}R`.padStart(9),
      `+${r.avgWinR.toFixed(2)}R`.padStart(8),
      `-${r.avgLossR.toFixed(2)}R`.padStart(9),
      `1:${r.realizedRRRatio.toFixed(1)}`.padStart(6),
      r.grossProfitFactor.toFixed(2).padStart(9),
      r.netProfitFactor.toFixed(2).padStart(8),
      `-${r.maxDrawdownR.toFixed(1)}R`.padStart(8),
      `${r.compoundedMaxDDPct}%`.padStart(9),
      `$${r.finalEquity1k.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(12),
      `${r.feeToGrossRatioPct}%`.padStart(11),
    ].join(' | ');
    console.log(row);
  }

  console.log('═'.repeat(160));

  // Save results to scratch JSON for auditing
  const outputPath = path.join(scratchDir, 'asymmetric_stress_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved detailed forensic results to: ${outputPath}`);
}

main().catch((err) => {
  console.error('❌ Stress Test Execution Error:', err);
  process.exit(1);
});

/**
 * scannerPresets.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive Local-First Scanner Preset Management System & Storage Store.
 * 
 * Features:
 *  - 0ms Latency Local-First CRUD with synchronous localStorage operations & SSR safety.
 *  - Built-in Institutional Factory Presets (Sweep & Reclaim + Order Block).
 *  - Resilient Background Cloud Synchronization with graceful offline / HTTP 402 trapping.
 *  - Reactive Event Broadcasting for real-time multi-tab & multi-component sync.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  SweepReclaimAnchorType,
  SweepReclaimEntryMode,
} from './SweepReclaimEngine';
import {
  updateSweepReclaimLiveSettings,
  getSweepReclaimAutoExec,
  getOrderBlockAutoExec,
  SupportedOBTimeframe,
  SupportedSRTimeframe,
  BinanceFeeTier,
} from './strategyExecutionConfig';

export type ScannerStrategyType = 'SWEEP_RECLAIM' | 'ORDER_BLOCK' | 'TREND_CONTINUATION';
export type StrategyArmedType = 'SWEEP_RECLAIM' | 'ORDER_BLOCK' | 'TREND_CONTINUATION' | 'CUSTOM_STRATEGY';

export const STORAGE_KEY_SCANNER_PRESETS = 'FLOW_STATE_SCANNER_PRESETS';
export const STORAGE_KEY_ACTIVE_PRESET_PREFIX = 'FLOW_STATE_ACTIVE_PRESET_';
export const STORAGE_KEY_ARMED_EXECUTION = 'FLOW_STATE_ARMED_EXECUTION';

export const SCANNER_PRESETS_CHANGED_EVENT = 'scanner-presets-changed';
export const FLOW_STATE_ARMED_STATE_CHANGED = 'flow-state-armed-state-changed';
export const FLOW_STATE_PURGE_CACHE_EVENT = 'flow-state-purge-cache';

export interface ArmedExecutionStatus {
  type: StrategyArmedType;
  id: string;
  name: string;
  isAutoExecEnabled: boolean;
  timeframe?: string;
  symbol?: string;
  updatedAt: number;
}

export interface SweepReclaimPresetConfig {
  symbol: string;
  timeframe: string;
  anchorTypes: SweepReclaimAnchorType[];
  suppressInternalPivots?: boolean;
  lookbackMajor: number;
  lookbackInternal: number;
  maxBarsAnchorToSweep: number;
  maxBarsSweepToReclaim: number;
  maxBarsToRetest: number;
  volumeSmaPeriod?: number;
  volumeExpansionThreshold: number;
  deltaDominanceThreshold: number;
  bodyRatioThreshold: number;
  requireThreePillarDisplacement: boolean;
  enforceDiscountPremiumGate: boolean;
  stage1Multiple: number;
  stage2Multiple: number;
  stage3Multiple: number;
  stage1Ratio?: number;
  stage2Ratio?: number;
  stage3Ratio?: number;
  entryMode: SweepReclaimEntryMode;
  enableStructuralTrail: boolean;
  enableProfitRatchet: boolean;
  minSweepDepthAtrMultiplier: number;
  slBufferAtrMultiplier: number;

  // 🎯 Pillar 4 Dynamic Liquidity Targets & MSS Confirmation
  targetMode?: 'FIXED_RR' | 'DYNAMIC_LIQUIDITY' | 'HYBRID_LIQUIDITY';
  dynamicTp1Source?: 'DEALING_RANGE_EQ' | 'FIXED_RR';
  dynamicTp2Source?: 'OPPOSING_LIQUIDITY' | 'FIXED_RR';
  minDynamicTp1Multiple?: number;
  maxDynamicTp1Multiple?: number;
  minDynamicTp2Multiple?: number;
  maxDynamicTp2Multiple?: number;
  requireMssConfirmation?: boolean;
  mssLookbackBars?: number;
  maxBarsSweepToMss?: number;

  // 🛡️ Quant Shield & Loss Streak Protection Settings (5 Institutional Rules)
  enableWaveDeduplication?: boolean; // Rule 1: Single-Position & Wave Anchor Deduplication (default: true)
  filterWeekend?: boolean; // Rule 2: Weekend Off-Liquidity Filter (Fri 22:00 - Sun 20:00 UTC) (default: true)
  filterDeadZones?: boolean; // Rule 6: Dead Zone Filter (default: false)
  enforceHtfBiasGuard?: boolean; // Rule 3: Macro Daily Bias & 1H Structure Alignment (default: false)
  enableEarlyBreakeven?: boolean; // Rule 4: Dynamic Early Breakeven Ratchet (default: true)
  earlyBreakevenMultiple?: number; // Rule 4: MFE Multiple to trigger Breakeven (default: 0.60)
  enableFeePaddedBreakeven?: boolean; // Fee-Padded Breakeven: Offset BE stop to cover Binance 0.0400% taker fee (default: true)
  breakevenOffsetPct?: number; // Percentage offset from entry (default: 0.05% -> Entry * (1 ± 0.0005))
  postLossCooldownMinutes?: number; // Rule 5: Directional cooldown minutes after stop-out (default: 45)

  // 💰 Institutional Binance Fee Model (USDC-M Futures)
  makerFeePct?: number;
  takerFeePct?: number;
  feeTierPreset?: BinanceFeeTier;
  useBnbDiscount?: boolean;

  // 🏛️ Institutional Confluence Architecture (ICT + AMT + Wyckoff + SMT)
  enforceValueAreaGate?: boolean;
  valueAreaLookbackBars?: number;
  pocExclusionBandPct?: number;
  enforceSmtGate?: boolean;
  smtLookbackBars?: number;
  enforceInstitutionalKillzones?: boolean;
  institutionalKillzoneCutoffHourUtc?: number;
  institutionalKillzoneCutoffMinuteUtc?: number;
  enforcePreNewsFreeze?: boolean;
  enableM15StructuralTrail?: boolean;
}

export interface OrderBlockPresetConfig {
  symbol: string;
  timeframe: '5m' | '15m' | '1h' | '4h';
  minTier: 'ALL' | 'A_PLUS_ONLY' | 'A_AND_A_PLUS';
  strictTierAPlus: boolean;
  minVolumeExpansion?: number;
  minTakerDelta?: number;
  minDisplacementPips?: number;
  requireFvgConfluence?: boolean;
  requireOlsValidation?: boolean;
  olsSensitivity?: 'AGGRESSIVE' | 'MODERATE' | 'CONSERVATIVE';
  enforceDiscountPremiumGate?: boolean;
  maxBarsToMitigation: number;
  enableBreakerSim: boolean;
  maxBreakerRetestBars: number;
  enableDynamicMgmt?: boolean;
  tp1Multiple: number;
  tp2Multiple: number;
  positionScalingMode: 'THREE_STAGE_HARVEST' | 'TWO_STAGE_DYNAMIC' | 'SINGLE_STAGE';
  tp1Ratio: number;
  tp2Ratio: number;
  tp3Ratio: number;
  trailingStopMode: 'STRUCTURAL_FVG_TRAIL' | 'STATIC_BREAKEVEN';
  trailingBuffer: number;
  dynamicDolTp2Scaling: boolean;
  adaptiveBreakerConfirmation: boolean;
  requireBreakerConfirmation: boolean;
  requireBreakerDOL: boolean;
  requireBreakerVolumetric: boolean;
  breakerSessionFilter: 'ALL' | 'NY_AND_LONDON' | 'NY_ONLY' | 'LONDON_ONLY';
  aggregateConsecutive: boolean;
  maxConsecutive: number;
  entryMode: 'BOUNDARY' | 'MEAN_THRESHOLD';
  targetRr: number;
}

export interface TrendContinuationPresetConfig {
  symbol: string;
  timeframe: string;
  lookbackMajor: number;
  lookbackInternal: number;
  emaPeriod: number;
  enforceHtfTrendLock: boolean;
  volumeSmaPeriod: number;
  volumeExpansionThreshold: number;
  deltaDominanceThreshold: number;
  bodyRatioThreshold: number;
  requireThreePillarDisplacement: boolean;
  maxBarsToRetest: number;
  maxOriginLookbackBars?: number;
  slBufferAtrMultiplier: number;
  entryMode: 'FVG_PROXIMAL' | 'FVG_CE';
  stage1Ratio: number;
  stage2Ratio: number;
  stage1Multiple: number;
  stage2Multiple: number;
  dynamicTp2Source: 'OPPOSING_LIQUIDITY' | 'FIXED_RR';
  minDynamicTp2Multiple: number;
  maxDynamicTp2Multiple: number;
  enableM15StructuralTrail: boolean;
  enableFeePaddedBreakeven: boolean;
  breakevenOffsetPct: number;
  postLossCooldownMinutes: number;
  makerFeePct: number;
  takerFeePct: number;
  feeTierPreset?: BinanceFeeTier;
  useBnbDiscount?: boolean;
  enforceValueAreaGate?: boolean;
  valueAreaLookbackBars?: number;
  valueAreaMode?: 'PREVIOUS_DAY_DEVELOPING' | 'ROLLING_HISTOGRAM';
  pocBandPct?: number;
  enforceOlsValidation?: boolean;
  enforceOiSponsorship?: boolean;
  enforceSmtGate?: boolean;
  smtLookbackBars?: number;
  enableDynamicProfitFloor?: boolean;
  enforceToxicWindowBlacklist?: boolean;
  enforceRolloverFreeze?: boolean;
  enforceNewsFreeze?: boolean;
}

export interface ScannerPreset {
  id: string;
  name: string;
  description?: string;
  strategyType: ScannerStrategyType;
  symbol: string;
  timeframe: string;
  isFactory: boolean;
  syncStatus: 'synced' | 'local_only' | 'pending_sync' | 'factory';
  createdAt: number;
  updatedAt: number;
  config: SweepReclaimPresetConfig | OrderBlockPresetConfig | TrendContinuationPresetConfig;
}

// ── Factory Presets (Always available as immutable institutional baselines) ──

export const FACTORY_SWEEP_RECLAIM_PRESETS: ScannerPreset[] = [
  // ── 🏛️ Index 0: 15m Institutional Asymmetric Macro Sniper (Platform Primary Champion) ──
  {
    id: 'factory_sr_15m_asymmetric_macro_sniper',
    name: '15m Institutional Asymmetric Macro Sniper (SMT + AMT + FVG Proximal + 1:3-1:5R DOL)',
    description: 'The Income-Grade Institutional Asymmetric Engine engineered for aggressive capital compounding. Standardized on 15m structural baseline, limit entries at FVG Proximal (outer shelf boundary) with 12-bar TTL, gated by mandatory Intermarket BTC SMT Divergence, Auction Market Theory Value Area profile (Discount below VAL / Premium above VAH with POC exclusion), 0-90m Institutional Killzones (London 07:00-08:30 & NY AM 13:00-14:30 UTC with strict 16:30 Cairo hard cutoff), Rollover (00:00 UTC) and Pre-News Freezes, and Two-Stage Asymmetric Harvest (40-50% @ 1.2-1.5R Dealing Range EQ with Next-Bar BE +0.015% Fee Shield, remaining 50-60% runner trailing 15m 3-bar swing structure to 1:3.0-1:5.0R Opposing External Liquidity, 45m post-loss cooldown).',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789100000000,
    updatedAt: 1789100000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      suppressInternalPivots: true,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12, // 12-bar TTL
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.45,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: false,
      enforceValueAreaGate: true,
      valueAreaLookbackBars: 96,
      pocExclusionBandPct: 0.0015,
      enforceSmtGate: true,
      smtLookbackBars: 15,
      enforceInstitutionalKillzones: true,
      institutionalKillzoneCutoffHourUtc: 14,
      institutionalKillzoneCutoffMinuteUtc: 30,
      enforcePreNewsFreeze: true,
      stage1Multiple: 1.30,
      stage2Multiple: 3.50,
      stage3Multiple: 0.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      entryMode: 'FVG_PROXIMAL', // Outer shelf boundary
      enableStructuralTrail: true,
      enableM15StructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'DYNAMIC_LIQUIDITY',
      dynamicTp1Source: 'DEALING_RANGE_EQ',
      dynamicTp2Source: 'OPPOSING_LIQUIDITY',
      minDynamicTp1Multiple: 1.20,
      maxDynamicTp1Multiple: 1.50,
      minDynamicTp2Multiple: 3.00,
      maxDynamicTp2Multiple: 5.00,
      requireMssConfirmation: false,
      mssLookbackBars: 15,
      maxBarsSweepToMss: 10,
      enableEarlyBreakeven: false, // Next-bar ratchet strictly on bar i+1 after TP1 fills
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: true,
      filterDeadZones: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 45,
      makerFeePct: 0.0000,
      takerFeePct: 0.0400,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  // ── 🏛️ Index 1: 15m Institutional Confluence Champion (ICT + AMT + Wyckoff + SMT) ──
  {
    id: 'factory_sr_15m_institutional_confluence',
    name: '15m Institutional Confluence Champion (ICT + AMT + Wyckoff + SMT)',
    description: 'The Income-Grade Institutional Confluence Architecture for ETHUSDC.p on 15m timeframe. Combines ICT 2022 Deep Mitigation, Auction Market Theory Value Area gating (Discount below VAL / Premium above VAH, POC exclusion), Wyckoff Phase D SOS/SOW confirmed MSS body close with 3-pillar volumetric sponsorship (>=1.20x Vol, >=52% Delta, >=45% Body), Intermarket BTC SMT Divergence gatekeeper, 0-90m Institutional Killzones (London 07:00-08:30 & NY AM 13:00-14:30 UTC with strict 14:30 UTC cutoff), and Two-Stage Asymmetric Harvest (50% @ 1.2-1.5R EQ with Next-Bar BE +0.015% Fee Shield, 50% runner trailing M15 structure to opposing liquidity at 1:3.0-1:5.0R with 45m post-loss cooldown).',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789100000000,
    updatedAt: 1789100000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      suppressInternalPivots: true,
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.45,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      enforceValueAreaGate: true,
      valueAreaLookbackBars: 96,
      pocExclusionBandPct: 0.0015,
      enforceSmtGate: true,
      smtLookbackBars: 15,
      enforceInstitutionalKillzones: true,
      institutionalKillzoneCutoffHourUtc: 14,
      institutionalKillzoneCutoffMinuteUtc: 30,
      enforcePreNewsFreeze: true,
      stage1Multiple: 1.30,
      stage2Multiple: 3.50,
      stage3Multiple: 0.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableM15StructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'DYNAMIC_LIQUIDITY',
      dynamicTp1Source: 'DEALING_RANGE_EQ',
      dynamicTp2Source: 'OPPOSING_LIQUIDITY',
      minDynamicTp1Multiple: 1.20,
      maxDynamicTp1Multiple: 1.50,
      minDynamicTp2Multiple: 3.00,
      maxDynamicTp2Multiple: 5.00,
      requireMssConfirmation: true,
      mssLookbackBars: 15,
      maxBarsSweepToMss: 10,
      enableEarlyBreakeven: false,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: true,
      filterDeadZones: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 45,
      makerFeePct: 0.0000,
      takerFeePct: 0.0400,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },
];

export const FACTORY_ORDER_BLOCK_PRESETS: ScannerPreset[] = [
  {
    id: 'factory_ob_deep_macro_15m',
    name: 'Deep Macro OB 15m Harvest',
    description: 'Multi-gate institutional order block backtest model with 3-Stage Harvest and Breaker confirmation.',
    strategyType: 'ORDER_BLOCK',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      minTier: 'ALL',
      strictTierAPlus: false,
      maxBarsToMitigation: 24,
      enableBreakerSim: true,
      maxBreakerRetestBars: 20,
      enableDynamicMgmt: true,
      tp1Multiple: 1.0,
      tp2Multiple: 1.5,
      positionScalingMode: 'THREE_STAGE_HARVEST',
      tp1Ratio: 0.40,
      tp2Ratio: 0.40,
      tp3Ratio: 0.20,
      trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
      trailingBuffer: 0.05,
      dynamicDolTp2Scaling: true,
      adaptiveBreakerConfirmation: true,
      requireBreakerConfirmation: true,
      requireBreakerDOL: true,
      requireBreakerVolumetric: true,
      breakerSessionFilter: 'ALL',
      aggregateConsecutive: true,
      maxConsecutive: 5,
      entryMode: 'BOUNDARY',
      targetRr: 2.5,
    } as OrderBlockPresetConfig,
  },
  {
    id: 'factory_ob_elite_a_plus_sniper',
    name: 'Elite A+ Order Block Sniper',
    description: 'Strict A+ Tier Order Block scanner filtering for maximum volumetric expansion and DOL alignment.',
    strategyType: 'ORDER_BLOCK',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      minTier: 'A_PLUS_ONLY',
      strictTierAPlus: true,
      maxBarsToMitigation: 24,
      enableBreakerSim: true,
      maxBreakerRetestBars: 20,
      enableDynamicMgmt: true,
      tp1Multiple: 1.2,
      tp2Multiple: 2.0,
      positionScalingMode: 'THREE_STAGE_HARVEST',
      tp1Ratio: 0.40,
      tp2Ratio: 0.40,
      tp3Ratio: 0.20,
      trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
      trailingBuffer: 0.05,
      dynamicDolTp2Scaling: true,
      adaptiveBreakerConfirmation: true,
      requireBreakerConfirmation: true,
      requireBreakerDOL: true,
      requireBreakerVolumetric: true,
      breakerSessionFilter: 'ALL',
      aggregateConsecutive: true,
      maxConsecutive: 5,
      entryMode: 'MEAN_THRESHOLD',
      targetRr: 3.5,
    } as OrderBlockPresetConfig,
  },
  {
    id: 'factory_ob_breaker_momentum_scalper',
    name: 'Breaker Momentum 5m Scalper',
    description: 'Fast 5m Breaker Block transition model with volumetric validation and dynamic DOL target scaling.',
    strategyType: 'ORDER_BLOCK',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      minTier: 'ALL',
      strictTierAPlus: false,
      maxBarsToMitigation: 20,
      enableBreakerSim: true,
      maxBreakerRetestBars: 16,
      enableDynamicMgmt: true,
      tp1Multiple: 1.0,
      tp2Multiple: 2.0,
      positionScalingMode: 'TWO_STAGE_DYNAMIC',
      tp1Ratio: 0.50,
      tp2Ratio: 0.50,
      tp3Ratio: 0.0,
      trailingStopMode: 'STRUCTURAL_FVG_TRAIL',
      trailingBuffer: 0.05,
      dynamicDolTp2Scaling: true,
      adaptiveBreakerConfirmation: true,
      requireBreakerConfirmation: true,
      requireBreakerDOL: true,
      requireBreakerVolumetric: true,
      breakerSessionFilter: 'ALL',
      aggregateConsecutive: true,
      maxConsecutive: 4,
      entryMode: 'BOUNDARY',
      targetRr: 3.0,
    } as OrderBlockPresetConfig,
  },
];

export const FACTORY_TREND_CONTINUATION_PRESETS: ScannerPreset[] = [
  {
    id: 'factory_tc_15m_trend_expansion_champion',
    name: '15m Institutional Trend Expansion Champion (HTF Lock + BOS + 30/70 Asymmetric Model)',
    description: 'Engine 2: Institutional Trend-Following & BOS Expansion Engine. Enforces 24/7 crypto liquidity flow scanning across all global sessions (Asia, London, New York, Weekends) with strict negative filtering toxic window blacklist (23:50-00:10 UTC funding rollover, ±20m US macro CPI/PPI/FOMC) and zero 14:30 entry curfew; Previous Day / Developing Daily Value Area macro anchor alignment with expansion mode preservation; strict HTF Trend Lock (1H/4H rolling Level-2 swings + 120 EMA directional lock); Level-2 Major confirmed physical body close Break of Structure (BOS) with 3-pillar displacement (>=1.25x Vol, >=52% Delta, >=50% Body); resting limit entries at FVG Proximal Edge with 12-bar TTL; and Inverted 30/70 Asymmetric Harvest (30% @ 1.5R de-risking tranche with Next-Bar BE +0.015% fee shield, 70% macro runner trailing 15m 3-bar swing pivots to 3.0R-5.0R opposing liquidity or Asian SD expansions, +1.0R dynamic profit floor @ +2.0R MFE, 45m post-loss cooldown).',
    strategyType: 'TREND_CONTINUATION',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789100000000,
    updatedAt: 1789100000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      lookbackMajor: 15,
      lookbackInternal: 10,
      emaPeriod: 120,
      enforceHtfTrendLock: true,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.25,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.50,
      requireThreePillarDisplacement: true,
      maxBarsToRetest: 12,
      maxOriginLookbackBars: 32,
      slBufferAtrMultiplier: 0.10,
      entryMode: 'FVG_PROXIMAL',
      stage1Ratio: 0.30,
      stage2Ratio: 0.70,
      stage1Multiple: 1.50,
      stage2Multiple: 4.00,
      dynamicTp2Source: 'OPPOSING_LIQUIDITY',
      minDynamicTp2Multiple: 3.00,
      maxDynamicTp2Multiple: 5.00,
      enableM15StructuralTrail: true,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      postLossCooldownMinutes: 45,
      makerFeePct: 0.0000,
      takerFeePct: 0.0400,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
      enforceValueAreaGate: true,
      valueAreaLookbackBars: 96,
      valueAreaMode: 'PREVIOUS_DAY_DEVELOPING',
      pocBandPct: 0.0020,
      enforceOlsValidation: true,
      enforceOiSponsorship: true,
      enforceSmtGate: true,
      smtLookbackBars: 15,
      enableDynamicProfitFloor: true,
      enforceToxicWindowBlacklist: true,
      enforceRolloverFreeze: true,
      enforceNewsFreeze: true,
    } as TrendContinuationPresetConfig,
  },
];

export const ALL_FACTORY_PRESETS: ScannerPreset[] = [
  ...FACTORY_SWEEP_RECLAIM_PRESETS,
  ...FACTORY_TREND_CONTINUATION_PRESETS,
  ...FACTORY_ORDER_BLOCK_PRESETS,
];

// ── Event Broadcasting ────────────────────────────────────────────────────────

function dispatchPresetsChangedEvent(detail?: any) {
  if (typeof window === 'undefined') return;
  try {
    const event = new CustomEvent(SCANNER_PRESETS_CHANGED_EVENT, { detail });
    window.dispatchEvent(event);
  } catch (err) {
    console.warn('[scannerPresets] Failed to dispatch presets changed event:', err);
  }
}

// ── Local-First Storage CRUD Helpers ──────────────────────────────────────────

/**
 * Loads all presets (Factory + Custom User Presets) synchronously from localStorage.
 */
export function loadScannerPresets(strategyType?: ScannerStrategyType): ScannerPreset[] {
  const factoryPresets = strategyType
    ? ALL_FACTORY_PRESETS.filter((p) => p.strategyType === strategyType)
    : ALL_FACTORY_PRESETS;

  if (typeof window === 'undefined') {
    return factoryPresets;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCANNER_PRESETS);
    if (!raw) return factoryPresets;

    const userPresets: ScannerPreset[] = JSON.parse(raw);
    const validUserPresets = Array.isArray(userPresets)
      ? userPresets.filter((p) => !p.isFactory && (!strategyType || p.strategyType === strategyType))
      : [];

    return [...factoryPresets, ...validUserPresets];
  } catch (err) {
    console.warn('[scannerPresets] Failed to parse local presets, returning factory presets:', err);
    return factoryPresets;
  }
}

/**
 * Retrieves only custom (user-created) presets from localStorage.
 */
export function loadCustomPresets(): ScannerPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCANNER_PRESETS);
    if (!raw) return [];
    const parsed: ScannerPreset[] = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => !p.isFactory) : [];
  } catch {
    return [];
  }
}

/**
 * Saves a list of custom presets into localStorage and notifies listeners.
 */
function saveCustomPresetsToLocalStorage(customPresets: ScannerPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SCANNER_PRESETS, JSON.stringify(customPresets));
    dispatchPresetsChangedEvent({ customPresetsCount: customPresets.length });
  } catch (err) {
    console.warn('[scannerPresets] Failed to save custom presets to localStorage:', err);
  }
}

/**
 * Creates and saves a new custom preset into localStorage (0ms latency), then triggers background cloud sync.
 */
export function saveCustomPreset(
  presetData: Omit<ScannerPreset, 'id' | 'isFactory' | 'syncStatus' | 'createdAt' | 'updatedAt'>
): ScannerPreset {
  const now = Date.now();
  const id = `preset_custom_${presetData.strategyType.toLowerCase()}_${now}_${Math.random().toString(36).slice(2, 7)}`;

  const newPreset: ScannerPreset = {
    ...presetData,
    id,
    isFactory: false,
    syncStatus: 'local_only',
    createdAt: now,
    updatedAt: now,
  };

  const existingCustom = loadCustomPresets();
  const updated = [newPreset, ...existingCustom.filter((p) => p.id !== id)];
  saveCustomPresetsToLocalStorage(updated);

  // Trigger background cloud sync defensively
  syncPresetToCloud(newPreset).catch(() => { });

  return newPreset;
}

/**
 * Updates an existing custom preset in localStorage.
 */
export function updateCustomPreset(
  id: string,
  updates: Partial<Omit<ScannerPreset, 'id' | 'isFactory' | 'createdAt'>>
): ScannerPreset | null {
  const existingCustom = loadCustomPresets();
  const targetIndex = existingCustom.findIndex((p) => p.id === id);

  if (targetIndex === -1) {
    console.warn(`[scannerPresets] Preset with ID ${id} not found or is a protected factory preset.`);
    return null;
  }

  const existing = existingCustom[targetIndex];
  const updatedPreset: ScannerPreset = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: 'pending_sync',
  };

  existingCustom[targetIndex] = updatedPreset;
  saveCustomPresetsToLocalStorage(existingCustom);

  // Trigger background cloud sync defensively
  syncPresetToCloud(updatedPreset).catch(() => { });

  return updatedPreset;
}

/**
 * Deletes a custom preset from localStorage.
 */
export function deleteCustomPreset(id: string): boolean {
  const existingCustom = loadCustomPresets();
  const filtered = existingCustom.filter((p) => p.id !== id);

  if (filtered.length === existingCustom.length) {
    return false; // Nothing was deleted (e.g. factory preset or not found)
  }

  saveCustomPresetsToLocalStorage(filtered);

  // Delete from cloud in background
  deletePresetFromCloud(id).catch(() => { });

  return true;
}

/**
 * Gets a preset by ID.
 */
export function getPresetById(id: string): ScannerPreset | null {
  const all = loadScannerPresets();
  return all.find((p) => p.id === id) || null;
}

/**
 * Gets the active preset ID for a specific strategy tab from localStorage.
 */
export function getActivePresetId(strategyType: ScannerStrategyType): string {
  const fallback = strategyType === 'SWEEP_RECLAIM' 
    ? FACTORY_SWEEP_RECLAIM_PRESETS[0].id 
    : strategyType === 'TREND_CONTINUATION'
      ? FACTORY_TREND_CONTINUATION_PRESETS[0].id
      : FACTORY_ORDER_BLOCK_PRESETS[0].id;
  if (typeof window === 'undefined') return fallback;
  try {
    const item = localStorage.getItem(`${STORAGE_KEY_ACTIVE_PRESET_PREFIX}${strategyType}`);
    if (
      !item ||
      item === 'factory_sr_3m_sfp_shelf_sniper' ||
      item === 'factory_sr_5m_fvg_ce_sniper_v2' ||
      item === 'factory_sr_5m_fvg_ce_sniper_v3' ||
      item === 'factory_sr_5m_alpha_shield_v2' ||
      item === 'factory_sr_5m_alpha_shield_v3' ||
      item === 'factory_sr_5m_asymmetric_rr_sniper' ||
      item === 'factory_sr_5m_asymmetric_ote_sniper' ||
      item === 'factory_sr_15m_macro_sniper_v1' ||
      item === 'factory_sr_15m_scen_a_conservative_ce' ||
      item === 'factory_sr_15m_scen_a_conservative_proximal' ||
      item === 'factory_sr_15m_scen_b_asymmetric_ce' ||
      item === 'factory_sr_15m_scen_b_asymmetric_proximal' ||
      item.startsWith('opt_test') ||
      item.startsWith('custom_sr_5m')
    ) {
      // Auto-migrate legacy or unviable experimental presets back to primary Champion
      localStorage.setItem(`${STORAGE_KEY_ACTIVE_PRESET_PREFIX}${strategyType}`, fallback);
      return fallback;
    }
    return item || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sets the active preset ID for a specific strategy tab in localStorage.
 */
export function setActivePresetId(strategyType: ScannerStrategyType, presetId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (presetId) {
      localStorage.setItem(`${STORAGE_KEY_ACTIVE_PRESET_PREFIX}${strategyType}`, presetId);
    } else {
      localStorage.removeItem(`${STORAGE_KEY_ACTIVE_PRESET_PREFIX}${strategyType}`);
    }
  } catch (err) {
    console.warn('[scannerPresets] Failed to save active preset ID:', err);
  }
}

// ── Resilient Background Cloud Synchronization ────────────────────────────────

/**
 * Background helper to sync a single preset to the cloud API without throwing unhandled errors.
 */
async function syncPresetToCloud(preset: ScannerPreset): Promise<void> {
  if (typeof window === 'undefined' || preset.isFactory) return;

  try {
    const res = await fetch('/api/quant-lab/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });

    if (res.ok) {
      // Mark as synced locally
      const custom = loadCustomPresets();
      const idx = custom.findIndex((p) => p.id === preset.id);
      if (idx !== -1) {
        custom[idx].syncStatus = 'synced';
        saveCustomPresetsToLocalStorage(custom);
      }
    } else if (res.status === 402) {
      // Data Quota Exceeded — silently remain local_only
      console.info('[scannerPresets] Cloud sync deferred: Data Quota Exceeded (HTTP 402). Operating in local-first mode.');
    }
  } catch {
    // Network offline / unreachable — silently remain local_only
  }
}

/**
 * Background helper to delete a preset from cloud storage.
 */
async function deletePresetFromCloud(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch(`/api/quant-lab/presets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    // Silent catch
  }
}

/**
 * Reconciles local presets with cloud storage in the background.
 */
export async function syncPresetsWithCloud(): Promise<{ syncedCount: number; isOffline: boolean }> {
  if (typeof window === 'undefined') return { syncedCount: 0, isOffline: false };

  try {
    const res = await fetch('/api/quant-lab/presets');
    if (!res.ok) {
      return { syncedCount: 0, isOffline: true };
    }

    const data = await res.json();
    const cloudPresets: ScannerPreset[] = data.presets || [];

    if (!Array.isArray(cloudPresets) || cloudPresets.length === 0) {
      // If cloud has no presets, push pending local presets
      const localCustom = loadCustomPresets();
      for (const p of localCustom) {
        await syncPresetToCloud(p);
      }
      return { syncedCount: localCustom.length, isOffline: false };
    }

    // Merge cloud presets with local presets (cloud wins on newer updatedAt)
    const localCustom = loadCustomPresets();
    const mergedMap = new Map<string, ScannerPreset>();

    for (const lp of localCustom) {
      mergedMap.set(lp.id, lp);
    }

    for (const cp of cloudPresets) {
      const existing = mergedMap.get(cp.id);
      if (!existing || cp.updatedAt >= existing.updatedAt) {
        mergedMap.set(cp.id, { ...cp, syncStatus: 'synced' });
      }
    }

    const mergedList = Array.from(mergedMap.values());
    saveCustomPresetsToLocalStorage(mergedList);

    return { syncedCount: mergedList.length, isOffline: false };
  } catch {
    return { syncedCount: 0, isOffline: true };
  }
}

// ── Armed Execution Cockpit State & Live Strategy Linkage ─────────────────────

/**
 * Dispatches a global event instructing all strategy evaluators to clear debounce locks and condition caches.
 */
export function purgeConditionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const event = new CustomEvent(FLOW_STATE_PURGE_CACHE_EVENT, { detail: { timestamp: Date.now() } });
    window.dispatchEvent(event);
  } catch (err) {
    console.warn('[scannerPresets] Failed to dispatch purge cache event:', err);
  }
}

/**
 * Retrieves the currently armed execution status with fallback to platform default (15m Macro Champion).
 */
export function getArmedExecutionStatus(): ArmedExecutionStatus {
  const defaultStatus: ArmedExecutionStatus = {
    type: 'SWEEP_RECLAIM',
    id: FACTORY_SWEEP_RECLAIM_PRESETS[0].id,
    name: FACTORY_SWEEP_RECLAIM_PRESETS[0].name,
    isAutoExecEnabled: getSweepReclaimAutoExec(),
    symbol: 'ETHUSDC',
    timeframe: '15m',
    updatedAt: Date.now(),
  };

  if (typeof window === 'undefined') return defaultStatus;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_ARMED_EXECUTION);
    if (!raw) return defaultStatus;
    const parsed = JSON.parse(raw);
    if (
      !parsed.id ||
      parsed.id === 'factory_sr_3m_sfp_shelf_sniper' ||
      parsed.id === 'factory_sr_5m_fvg_ce_sniper_v2' ||
      parsed.id === 'factory_sr_5m_fvg_ce_sniper_v3' ||
      parsed.id === 'factory_sr_5m_alpha_shield_v2' ||
      parsed.id === 'factory_sr_5m_alpha_shield_v3' ||
      parsed.id === 'factory_sr_5m_asymmetric_rr_sniper' ||
      parsed.id === 'factory_sr_5m_asymmetric_ote_sniper' ||
      parsed.id === 'factory_sr_15m_macro_sniper_v1' ||
      parsed.id === 'factory_sr_15m_scen_a_conservative_ce' ||
      parsed.id === 'factory_sr_15m_scen_a_conservative_proximal' ||
      parsed.id === 'factory_sr_15m_scen_b_asymmetric_ce' ||
      parsed.id === 'factory_sr_15m_scen_b_asymmetric_proximal' ||
      parsed.id.startsWith('opt_test') ||
      parsed.id.startsWith('custom_sr_5m')
    ) {
      // Auto-migrate legacy or pruned armed status to 15m Asymmetric Macro Champion
      localStorage.setItem(STORAGE_KEY_ARMED_EXECUTION, JSON.stringify(defaultStatus));
      return defaultStatus;
    }
    return {
      ...parsed,
      isAutoExecEnabled:
        parsed.type === 'SWEEP_RECLAIM'
          ? getSweepReclaimAutoExec()
          : parsed.type === 'ORDER_BLOCK'
            ? getOrderBlockAutoExec()
            : true,
    };
  } catch {
    return defaultStatus;
  }
}

/**
 * Updates the currently armed execution status and notifies listeners.
 */
export function setArmedExecutionStatus(status: ArmedExecutionStatus): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_ARMED_EXECUTION, JSON.stringify(status));
    const event = new CustomEvent(FLOW_STATE_ARMED_STATE_CHANGED, { detail: status });
    window.dispatchEvent(event);
  } catch (err) {
    console.warn('[scannerPresets] Failed to set armed execution status:', err);
  }
}

/**
 * Arms any preset (Sweep & Reclaim, Order Block, or User Custom) directly into the live automated execution engine.
 */
export function applyPresetToLiveExecution(preset: ScannerPreset): void {
  setActivePresetId(preset.strategyType, preset.id);

  if (preset.strategyType === 'SWEEP_RECLAIM') {
    const cfg = preset.config as SweepReclaimPresetConfig;
    const liveAnchors: ('SWING_PIVOT' | 'ASIAN' | 'LONDON' | 'DAILY')[] = [];
    if (cfg.anchorTypes?.includes('SWING_PIVOT')) liveAnchors.push('SWING_PIVOT');
    if (cfg.anchorTypes?.some((t) => t.startsWith('ASIAN'))) liveAnchors.push('ASIAN');
    if (cfg.anchorTypes?.some((t) => t.startsWith('LONDON'))) liveAnchors.push('LONDON');
    if (cfg.anchorTypes?.includes('PDH') || cfg.anchorTypes?.includes('PDL')) liveAnchors.push('DAILY');

    updateSweepReclaimLiveSettings({
      entryMode: cfg.entryMode,
      enforceDiscountPremiumGate: cfg.enforceDiscountPremiumGate ?? false,
      volumeSmaPeriod: cfg.volumeSmaPeriod ?? 20,
      volumeExpansionThreshold: cfg.volumeExpansionThreshold ?? 1.20,
      deltaDominanceThreshold: cfg.deltaDominanceThreshold ?? 52.0,
      bodyRatioThreshold: cfg.bodyRatioThreshold ?? 0.45,
      stage1Multiple: cfg.stage1Multiple ?? 1.30,
      stage2Multiple: cfg.stage2Multiple ?? 3.50,
      stage3Multiple: cfg.stage3Multiple ?? 0.0,
      stage1Ratio: cfg.stage1Ratio ?? 0.50,
      stage2Ratio: cfg.stage2Ratio ?? 0.50,
      stage3Ratio: cfg.stage3Ratio ?? 0.00,
      enableStructuralTrail: cfg.enableStructuralTrail ?? true,
      enableProfitRatchet: cfg.enableProfitRatchet ?? false,
      anchorTypes: liveAnchors.length > 0 ? liveAnchors : ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'],
      lookbackMajor: cfg.lookbackMajor ?? 15,
      lookbackInternal: cfg.lookbackInternal ?? 10,
      maxBarsAnchorToSweep: cfg.maxBarsAnchorToSweep ?? 25,
      maxBarsSweepToReclaim: cfg.maxBarsSweepToReclaim ?? 10,
      maxBarsToRetest: cfg.maxBarsToRetest ?? 12,
      minSweepDepthAtrMultiplier: cfg.minSweepDepthAtrMultiplier ?? 0.10,
      slBufferAtrMultiplier: cfg.slBufferAtrMultiplier ?? 0.10,
      requireThreePillarDisplacement: cfg.requireThreePillarDisplacement ?? true,
      enabledTimeframes: cfg.timeframe ? [cfg.timeframe as SupportedSRTimeframe] : ['15m'],

      // 🛡️ Quant Shield Parameters (Full Parity)
      enableWaveDeduplication: cfg.enableWaveDeduplication !== false,
      filterWeekend: cfg.filterWeekend !== false,
      enforceHtfBiasGuard: cfg.enforceHtfBiasGuard === true,
      enableEarlyBreakeven: cfg.enableEarlyBreakeven === true,
      earlyBreakevenMultiple: typeof cfg.earlyBreakevenMultiple === 'number' ? cfg.earlyBreakevenMultiple : 0.40,
      enableFeePaddedBreakeven: cfg.enableFeePaddedBreakeven !== false,
      breakevenOffsetPct: typeof cfg.breakevenOffsetPct === 'number' ? cfg.breakevenOffsetPct : 0.015,
      postLossCooldownMinutes: typeof cfg.postLossCooldownMinutes === 'number' ? cfg.postLossCooldownMinutes : 45,

      // 🎯 Pillar 4 Dynamic Liquidity Targets & MSS Confirmation
      targetMode: cfg.targetMode ?? 'DYNAMIC_LIQUIDITY',
      dynamicTp1Source: cfg.dynamicTp1Source ?? 'DEALING_RANGE_EQ',
      dynamicTp2Source: cfg.dynamicTp2Source ?? 'OPPOSING_LIQUIDITY',
      minDynamicTp1Multiple: cfg.minDynamicTp1Multiple ?? 1.20,
      maxDynamicTp1Multiple: cfg.maxDynamicTp1Multiple ?? 1.50,
      minDynamicTp2Multiple: cfg.minDynamicTp2Multiple ?? 3.00,
      maxDynamicTp2Multiple: cfg.maxDynamicTp2Multiple ?? 5.00,
      requireMssConfirmation: cfg.requireMssConfirmation ?? false,
      mssLookbackBars: (cfg as any).mssLookbackBars ?? 15,
      maxBarsSweepToMss: (cfg as any).maxBarsSweepToMss ?? 10,

      // 🏛️ Institutional Confluence Architecture (ICT + AMT + Wyckoff + SMT)
      enforceValueAreaGate: cfg.enforceValueAreaGate ?? true,
      valueAreaLookbackBars: cfg.valueAreaLookbackBars ?? 96,
      pocExclusionBandPct: cfg.pocExclusionBandPct ?? 0.0015,
      enforceSmtGate: cfg.enforceSmtGate ?? true,
      smtLookbackBars: cfg.smtLookbackBars ?? 15,
      enforceInstitutionalKillzones: cfg.enforceInstitutionalKillzones ?? true,
      institutionalKillzoneCutoffHourUtc: cfg.institutionalKillzoneCutoffHourUtc ?? 14,
      institutionalKillzoneCutoffMinuteUtc: cfg.institutionalKillzoneCutoffMinuteUtc ?? 30,
      enforcePreNewsFreeze: cfg.enforcePreNewsFreeze ?? true,
      enableM15StructuralTrail: cfg.enableM15StructuralTrail ?? true,

      // 💰 Institutional Binance Fee Model
      makerFeePct: typeof cfg.makerFeePct === 'number' ? cfg.makerFeePct : 0.0000,
      takerFeePct: typeof cfg.takerFeePct === 'number' ? cfg.takerFeePct : 0.0400,
      feeTierPreset: cfg.feeTierPreset || 'USDC_REGULAR_VIP1',
      useBnbDiscount: cfg.useBnbDiscount === true,
    });

    setArmedExecutionStatus({
      type: 'SWEEP_RECLAIM',
      id: preset.id,
      name: preset.name,
      isAutoExecEnabled: getSweepReclaimAutoExec(),
      symbol: cfg.symbol || 'ETHUSDC',
      timeframe: cfg.timeframe || '5m',
      updatedAt: Date.now(),
    });
  } else if (preset.strategyType === 'ORDER_BLOCK') {
    const cfg = preset.config as OrderBlockPresetConfig;
    setArmedExecutionStatus({
      type: 'ORDER_BLOCK',
      id: preset.id,
      name: preset.name,
      isAutoExecEnabled: getOrderBlockAutoExec(),
      symbol: cfg.symbol || 'ETHUSDC',
      timeframe: cfg.timeframe || '15m',
      updatedAt: Date.now(),
    });
  } else if (preset.strategyType === 'TREND_CONTINUATION') {
    const cfg = preset.config as TrendContinuationPresetConfig;
    setArmedExecutionStatus({
      type: 'TREND_CONTINUATION',
      id: preset.id,
      name: preset.name,
      isAutoExecEnabled: true,
      symbol: cfg.symbol || 'ETHUSDC',
      timeframe: cfg.timeframe || '15m',
      updatedAt: Date.now(),
    });
  }

  // Purge any transient condition locks so new parameters take effect on the current tick
  purgeConditionCache();
}

/**
 * Arms a custom Equation Builder strategy for live evaluation.
 */
export function armCustomStrategy(strategy: { id: string; name: string; target_environment?: string }): void {
  setArmedExecutionStatus({
    type: 'CUSTOM_STRATEGY',
    id: strategy.id,
    name: strategy.name,
    isAutoExecEnabled: true,
    symbol: 'ETHUSDC',
    timeframe: '5m',
    updatedAt: Date.now(),
  });

  purgeConditionCache();
}


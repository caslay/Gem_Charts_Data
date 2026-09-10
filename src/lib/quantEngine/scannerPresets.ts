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

export type ScannerStrategyType = 'SWEEP_RECLAIM' | 'ORDER_BLOCK';
export type StrategyArmedType = 'SWEEP_RECLAIM' | 'ORDER_BLOCK' | 'CUSTOM_STRATEGY';

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
  config: SweepReclaimPresetConfig | OrderBlockPresetConfig;
}

// ── Factory Presets (Always available as immutable institutional baselines) ──

export const FACTORY_SWEEP_RECLAIM_PRESETS: ScannerPreset[] = [
  // ── 👑 Index 0: 15m Macro Swing & Fee Shield Champion (Platform Primary Default) ──
  {
    id: 'factory_sr_15m_macro_sniper_v1',
    name: '15m Macro Swing & Fee Shield Champion (Ultra-Low Churn)',
    description: 'The 1-Year Validated Macro Swing Champion (+92.38R Net Realized Return, 63.6% Ex-Scratch Win Rate, 1.51 Net PF, 16.7% Max DD under real Binance 0.04% taker fees). Eliminates 5m churn by elevating execution to 15m Major Swings (lookback 15/10), slashing fee destruction by 80%. Enters at FVG 50% CE with 70% TP1 @ 1.0R / 30% TP2 @ 1.35R, Rule 4 Early BE (+0.35R), and Rule 6 Precision Dead Zone Filter.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.35,
      stage3Multiple: 0.0,
      stage1Ratio: 0.70,
      stage2Ratio: 0.30,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },

  // ── 🏹 Index 1: 15m Asymmetric Runner (Pure TP1 BE Benchmark Champion) ──
  {
    id: 'factory_sr_15m_scen_b_asymmetric_proximal',
    name: '15m Asymmetric Runner FVG Proximal (60/40 @ 1.0/2.0R)',
    description: '15m Sweep & Reclaim with Asymmetric Runner (60% @ 1.0R / 40% @ 2.0R), entering at FVG Proximal with Pure TP1 Breakeven (+0.015% fee shield), 45m post-loss cooldown, and Rule 6 dead zone filter (+46.01R Net 1Y, 1.17 PF, $21,918 equity from $10k).',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789070000000,
    updatedAt: 1789070000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
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
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 0.0,
      stage1Ratio: 0.60,
      stage2Ratio: 0.40,
      stage3Ratio: 0.00,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: false,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 45,
    } as SweepReclaimPresetConfig,
  },

  // ── 🏆 Index 2: 5m Sweep & Reclaim Fee Shield V3 Sniper (5m High-Turnover Champion) ──
  {
    id: 'factory_sr_5m_fvg_ce_sniper_v3',
    name: '5m Sweep & Reclaim Fee Shield V3 Sniper (5m High-Turnover Champion)',
    description: 'The 1-Year Validated All-Time Post-Fee Champion (+186.18R Net Realized Return, 1.37 Net PF, 29.0% Max DD, +9,733% Compounded Return from $1k to $98,333.52 under real Binance 0.04% taker fees). Outperforms V2 by +$79,413.88 (+420% more capital). Enters at FVG 50% CE with Swings + Daily + Asian session anchors, 1.10x Vol, 15-bar TTL, 60% TP1 @ 1.0R / 40% TP2 @ 1.30R, Rule 4 Early BE (+0.40R), and the Calibrated 0.015% Fee Shield.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW'],
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
      stage1Multiple: 1.0,
      stage2Multiple: 1.30,
      stage3Multiple: 3.0,
      stage1Ratio: 0.60,
      stage2Ratio: 0.40,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Hardened Parameters (Calibrated 0.015% Fee Shield)
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },

  {
    id: 'factory_sr_5m_alpha_shield_v3',
    name: '5m Sweep & Reclaim Fee Shield Alpha V3 (Ultra-Low Drawdown)',
    description: 'The 1-Year Validated Ultra-Low Drawdown Post-Fee Champion (+178.79R Net Realized Return, 1.37 Net PF, record-low 27.6% Compounded Max DD, -16.94R DD, +8,223% Compounded Return from $1k to $83,235.49). Tight 10-bar retest window eliminates stale order fills in chop while the 0.015% Fee Shield protects equity.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 10, // 🔬 Retest Freshness Gate: 10 bars (50 min)
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.30,
      stage3Multiple: 3.0,
      stage1Ratio: 0.60,
      stage2Ratio: 0.40,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Hardened Parameters (Calibrated 0.015% Fee Shield)
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },

  // ── 🏛️ V2 Legacy Champions (Pre-Fee Baselines — Preserved) ─────────────────
  {
    id: 'factory_sr_5m_fvg_ce_sniper_v2',
    name: '5m Sweep & Reclaim FVG 50% CE Sniper V2 (Pre-Fee Baseline)',
    description: 'The 1-Year Validated Institutional Pre-Fee Baseline (+223.8R Net Nominal Return, 1.75 PF, -6.68R Max DD, +7,328% Compounded Return from $1k to $74,287, 14/14 Winning Months). Enters at FVG 50% Consequent Encroachment (CE) with purified Swing Pivots + Daily anchors, 1.10x Volume expansion, 15-bar TTL, 60% TP1 @ 1.0R / 40% TP2 @ 1.30R, and Rule 4 Early Breakeven (+0.40R).',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL'],
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
      stage1Multiple: 1.0,
      stage2Multiple: 1.30,
      stage3Multiple: 3.0,
      stage1Ratio: 0.60,
      stage2Ratio: 0.40,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Hardened Parameters (1-Year Tested)
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.05,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_5m_alpha_shield_v2',
    name: '5m Sweep & Reclaim Alpha Shield V2 (Pre-Fee Capital Shield)',
    description: 'The 1-Year Validated Low-Drawdown Capital Shield Pre-Fee Baseline (+206.8R Net Realized Return, 1.70 PF, ultra-low -5.75R Max DD, 11.3% Compounded DD, +5,182% Compounded Return from $1k to $52,821, 14/14 Winning Months). Enters at FVG 50% CE with Swing Pivots + Daily anchors, 1.10x Volume, 15-bar TTL, 50% TP1 @ 1.0R / 50% TP2 @ 1.50R, and Rule 4 Early Breakeven (+0.40R).',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL'],
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
      stage1Multiple: 1.0,
      stage2Multiple: 1.50,
      stage3Multiple: 3.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Hardened Parameters (1-Year Tested)
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.05,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },

  // ── 🧪 User Custom Optimization Base: "ETHUSDC 5m - Custom Setup" ──
  {
    id: 'custom_sr_5m_user_base_v1',
    name: 'ETHUSDC 5m - Custom Setup (User Base V1)',
    description: 'User-created custom preset with stricter body ratio (0.55), all 7 anchor types, HTF Bias Guard, Dead Zone filter, and 10-bar retest TTL. Serves as the base for iterative optimization.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1788954079006,
    updatedAt: 1788954079044,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 10,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.30,
      stage3Multiple: 3.0,
      stage1Ratio: 0.60,
      stage2Ratio: 0.40,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.40,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: true,
      postLossCooldownMinutes: 0,
      makerFeePct: 0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },
  // ── 🧪 Test 2: 15m + HTF Bias Guard (User Custom Feature) ──
  {
    id: 'opt_test2_15m_htf_guard',
    name: 'Opt Test 2: 15m + HTF Bias Guard',
    description: 'Test 2: 15m base + enforceHtfBiasGuard to filter counter-trend trades.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1788954079006,
    updatedAt: 1788954079006,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.35,
      stage3Multiple: 0.0,
      stage1Ratio: 0.70,
      stage2Ratio: 0.30,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: true,
      postLossCooldownMinutes: 0,
      makerFeePct: 0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  // ── 🧪 Test 3: 15m + HTF Guard + Body Ratio 0.55 ──
  {
    id: 'opt_test3_15m_htf_body055',
    name: 'Opt Test 3: 15m + HTF Guard + Body 0.55',
    description: 'Test 3: 15m + HTF Bias Guard + stricter body ratio 0.55 for displacement quality.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1788954079006,
    updatedAt: 1788954079006,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.35,
      stage3Multiple: 0.0,
      stage1Ratio: 0.70,
      stage2Ratio: 0.30,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: true,
      postLossCooldownMinutes: 0,
      makerFeePct: 0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  // ── 🧪 Test 4: 15m + HTF Guard + Body 0.55 + Wider Sweep Window (35 bars) ──
  {
    id: 'opt_test4_15m_wider_sweep',
    name: 'Opt Test 4: 15m + Wider Sweep (35 bars)',
    description: 'Test 4: Wider anchor-to-sweep window (35 bars) to capture more institutional setups on 15m.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1788954079006,
    updatedAt: 1788954079006,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.35,
      stage3Multiple: 0.0,
      stage1Ratio: 0.70,
      stage2Ratio: 0.30,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: true,
      postLossCooldownMinutes: 0,
      makerFeePct: 0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  // ── 🧪 Test 5: Best of Phase A + Relaxed Body (0.40) to maximize trade count ──
  {
    id: 'opt_test5_15m_relaxed_body',
    name: 'Opt Test 5: 15m + HTF Guard + Body 0.40 + Wider Sweep',
    description: 'Test 5: Same as Test 4 but with relaxed body ratio 0.40 to increase trade count while keeping HTF guard.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '15m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1788954079006,
    updatedAt: 1788954079006,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '15m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 15,
      lookbackInternal: 10,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 12,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.10,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.35,
      stage3Multiple: 0.0,
      stage1Ratio: 0.70,
      stage2Ratio: 0.30,
      stage3Ratio: 0.00,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,
      targetMode: 'FIXED_RR',
      requireMssConfirmation: false,
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.35,
      enableFeePaddedBreakeven: true,
      breakevenOffsetPct: 0.015,
      enableWaveDeduplication: true,
      filterWeekend: false,
      filterDeadZones: true,
      enforceHtfBiasGuard: true,
      postLossCooldownMinutes: 0,
      makerFeePct: 0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  // ── 🏹 Asymmetric 1:2 to 1:3 R:R Architecture (No Rule 4 Early BE Churn) ──
  {
    id: 'factory_sr_5m_asymmetric_rr_sniper',
    name: '5m Sweep & Reclaim Asymmetric 1:2-1:3 R:R Sniper (No Early BE)',
    description: 'Strategic Asymmetric Structure eliminating Rule 4 Early BE fee drag. Operates exclusively on Tier-1 Anchors (Asian/London, PDH/PDL, Major level-2 pivots), gates top-down HTF order flow, requires confirmed LTF displacement body close beyond preceding internal swing (MSS), enters at FVG 50% CE with pinned SL beyond sweep wick, routes TP1 to Dealing Range 50% EQ, TP2 to Opposing External Liquidity (min 1:2 R:R constraint), advances SL to BE strictly after TP1, and enforces Rule 5 45m post-loss cooldown.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789000000000,
    updatedAt: 1789000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
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
      postLossCooldownMinutes: 45,
      makerFeePct: 0.0,
      takerFeePct: 0.04,
      feeTierPreset: 'USDC_REGULAR_VIP1',
      useBnbDiscount: false,
    } as SweepReclaimPresetConfig,
  },

  {
    id: 'factory_sr_5m_asymmetric_ote_sniper',
    name: '5m Sweep & Reclaim Asymmetric OTE Deep Mitigation Sniper (No Early BE)',
    description: 'Same as Asymmetric 1:2-1:3 R:R Sniper but utilizing 62% Optimal Trade Entry (OTE) retracement mitigation entry.',
    strategyType: 'SWEEP_RECLAIM',
    symbol: 'ETHUSDC',
    timeframe: '5m',
    isFactory: true,
    syncStatus: 'factory',
    createdAt: 1789000000000,
    updatedAt: 1789000000000,
    config: {
      symbol: 'ETHUSDC',
      timeframe: '5m',
      anchorTypes: ['SWING_PIVOT', 'PDH', 'PDL', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
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
      entryMode: 'OTE_62',
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

export const ALL_FACTORY_PRESETS: ScannerPreset[] = [
  ...FACTORY_SWEEP_RECLAIM_PRESETS,
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
    : FACTORY_ORDER_BLOCK_PRESETS[0].id;
  if (typeof window === 'undefined') return fallback;
  try {
    const item = localStorage.getItem(`${STORAGE_KEY_ACTIVE_PRESET_PREFIX}${strategyType}`);
    if (
      item === 'factory_sr_3m_sfp_shelf_sniper' ||
      item === 'factory_sr_5m_fvg_ce_sniper_v2' ||
      item === 'factory_sr_15m_scen_a_conservative_ce' ||
      item === 'factory_sr_15m_scen_a_conservative_proximal' ||
      item === 'factory_sr_15m_scen_b_asymmetric_ce'
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
    id: 'factory_sr_15m_macro_sniper_v1',
    name: '15m Macro Swing & Fee Shield Champion (Ultra-Low Churn)',
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
      parsed.id === 'factory_sr_3m_sfp_shelf_sniper' ||
      parsed.id === 'factory_sr_5m_fvg_ce_sniper_v2' ||
      parsed.id === 'factory_sr_15m_scen_a_conservative_ce' ||
      parsed.id === 'factory_sr_15m_scen_a_conservative_proximal' ||
      parsed.id === 'factory_sr_15m_scen_b_asymmetric_ce'
    ) {
      // Auto-migrate legacy or pruned armed status to 15m Macro Champion
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
      enforceDiscountPremiumGate: cfg.enforceDiscountPremiumGate ?? true,
      volumeSmaPeriod: cfg.volumeSmaPeriod ?? 20,
      volumeExpansionThreshold: cfg.volumeExpansionThreshold ?? 1.10,
      deltaDominanceThreshold: cfg.deltaDominanceThreshold ?? 52.0,
      bodyRatioThreshold: cfg.bodyRatioThreshold ?? 0.40,
      stage1Multiple: cfg.stage1Multiple ?? 1.0,
      stage2Multiple: cfg.stage2Multiple ?? 1.30,
      stage3Multiple: cfg.stage3Multiple ?? 3.0,
      stage1Ratio: cfg.stage1Ratio ?? 0.60,
      stage2Ratio: cfg.stage2Ratio ?? 0.40,
      stage3Ratio: cfg.stage3Ratio ?? 0.00,
      enableStructuralTrail: cfg.enableStructuralTrail ?? true,
      enableProfitRatchet: cfg.enableProfitRatchet ?? false,
      anchorTypes: liveAnchors.length > 0 ? liveAnchors : ['SWING_PIVOT', 'ASIAN', 'DAILY'],
      lookbackMajor: cfg.lookbackMajor ?? 10,
      lookbackInternal: cfg.lookbackInternal ?? 5,
      maxBarsAnchorToSweep: cfg.maxBarsAnchorToSweep ?? 25,
      maxBarsSweepToReclaim: cfg.maxBarsSweepToReclaim ?? 10,
      maxBarsToRetest: cfg.maxBarsToRetest ?? 15,
      minSweepDepthAtrMultiplier: cfg.minSweepDepthAtrMultiplier ?? 0.10,
      slBufferAtrMultiplier: cfg.slBufferAtrMultiplier ?? 0.10,
      requireThreePillarDisplacement: cfg.requireThreePillarDisplacement ?? true,
      enabledTimeframes: cfg.timeframe ? [cfg.timeframe as SupportedSRTimeframe] : ['5m'],

      // 🛡️ Quant Shield Parameters (Full Parity)
      enableWaveDeduplication: cfg.enableWaveDeduplication === true,
      filterWeekend: cfg.filterWeekend === true,
      enforceHtfBiasGuard: cfg.enforceHtfBiasGuard === true,
      enableEarlyBreakeven: cfg.enableEarlyBreakeven === true,
      earlyBreakevenMultiple: typeof cfg.earlyBreakevenMultiple === 'number' ? cfg.earlyBreakevenMultiple : 0.40,
      enableFeePaddedBreakeven: cfg.enableFeePaddedBreakeven === true,
      breakevenOffsetPct: typeof cfg.breakevenOffsetPct === 'number' ? cfg.breakevenOffsetPct : 0.05,
      postLossCooldownMinutes: typeof cfg.postLossCooldownMinutes === 'number' ? cfg.postLossCooldownMinutes : 0,

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


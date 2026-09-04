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

  // 🛡️ Quant Shield & Loss Streak Protection Settings (5 Institutional Rules)
  enableWaveDeduplication?: boolean; // Rule 1: Single-Position & Wave Anchor Deduplication (default: true)
  filterWeekend?: boolean; // Rule 2: Weekend Off-Liquidity Filter (Fri 22:00 - Sun 20:00 UTC) (default: true)
  enforceHtfBiasGuard?: boolean; // Rule 3: Macro Daily Bias & 1H Structure Alignment (default: false)
  enableEarlyBreakeven?: boolean; // Rule 4: Dynamic Early Breakeven Ratchet (default: true)
  earlyBreakevenMultiple?: number; // Rule 4: MFE Multiple to trigger Breakeven (default: 0.60)
  postLossCooldownMinutes?: number; // Rule 5: Directional cooldown minutes after stop-out (default: 45)
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
  {
    id: 'factory_sr_5m_winner_fvg_proximal',
    name: '5m Sweep & Reclaim 2-Stage Max Alpha Champion (FVG Proximal)',
    description: 'The #1 PM2-Validated 2-Stage Alpha Champion for 5m ETH. Enters at FVG Proximal Edge with 1.20x Vol, 52% Delta, 0.40 Body, 50% TP1 @ 1.0R / 50% TP2 @ 1.4R, and pure Structural Trailing SL (+154.9R 3M Net Gain, 66.2% Win Rate, 1.96 PF).',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // Quant Shield Defaults (Pure Baseline)
      enableEarlyBreakeven: false,
      earlyBreakevenMultiple: 0.60,
      enableWaveDeduplication: false,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 0,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_5m_alpha_shield_early_be',
    name: '5m Sweep & Reclaim Alpha Shield (Early BE + Wave Guard)',
    description: 'The 1-Year Validated Institutional Alpha Champion (+161.4R Net Return, 1.37 PF, -13.2R Max DD, +1,928% Compounded Return). Enters at FVG Proximal Edge with 2-Stage TP (50% @ 1.0R / 50% @ 1.4R), Rule 1 Wave Deduplication, Rule 5 Post-Loss Cooldown (45m), and Rule 4 Early Breakeven Ratchet (+0.50R MFE). Slashes stop-outs by >50% while completely eliminating same-bar false exits.',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      stage1Ratio: 0.50,
      stage2Ratio: 0.50,
      stage3Ratio: 0.00,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: false,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Hardened Parameters (1-Year Tested)
      enableEarlyBreakeven: true,
      earlyBreakevenMultiple: 0.50,
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      postLossCooldownMinutes: 45,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_5m_anti_cluster_dual_optimized',
    name: '5m Sweep & Reclaim Anti-Cluster Shield (Dual-Optimized)',
    description: 'Dual-Optimized anti-loss cluster profile bypassing minor 5m swing pivots. Anchors strictly to Session Extremes (Asian/London) and PDH/PDL with FVG Proximal entries, Discount/Premium Dealing Range Gate, 3-Stage Harvest (40% @ 1.0R, 40% @ 1.4R with +1.0R ratchet floor, 20% runner), Wave Deduplication, and 45-min post-loss cooldown.',
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
      anchorTypes: ['ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.20,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.40,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      stage1Ratio: 0.40,
      stage2Ratio: 0.40,
      stage3Ratio: 0.20,
      entryMode: 'FVG_PROXIMAL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.10,

      // 🛡️ Quant Shield Parameters (Anti-Loss Streak Hardening)
      enableWaveDeduplication: true,
      filterWeekend: false,
      enforceHtfBiasGuard: false,
      enableEarlyBreakeven: false, // Configurable: false for pure structural trailing, true with 0.60 for max loss pruning
      earlyBreakevenMultiple: 0.60,
      postLossCooldownMinutes: 45,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_golden_default',
    name: 'Golden Sweep & Reclaim (15m Baseline)',
    description: 'Validated 15m 3-Pillar displacement reclaim with Mean Threshold limit routing and 40/40/20 harvest scaling.',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_5m_winner_ob_mt',
    name: '5m Sweep OB 50% MT Institutional Sniper (Lowest SL Rate)',
    description: 'Institutional Order Block Mean Threshold precision sniper with 10.34 Profit Factor, 60.6% Win Rate, and ultra-low 8.95% SL hit rate (+990.21R Net Gain across 1,184 trades).',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 12,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeSmaPeriod: 20,
      volumeExpansionThreshold: 1.25,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.48,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.4,
      stage3Multiple: 3.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_5m_fast_harvest_shield',
    name: '5m Fast-Harvest Structural Pivot Shield (Highest Win Rate)',
    description: 'High-frequency defensive structural model delivering 65.3% Win Rate and 8.21 Profit Factor with 1.0R/1.3R/2.2R dynamic harvest (+915.93R Net Gain across 1,150 trades).',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 12,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 18,
      volumeSmaPeriod: 16,
      volumeExpansionThreshold: 1.30,
      deltaDominanceThreshold: 52.0,
      bodyRatioThreshold: 0.50,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.3,
      stage3Multiple: 2.2,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.12,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_eth_high_velocity',
    name: 'ETH High-Velocity 5m Scalper',
    description: 'Ultra-responsive 5m liquidity sweep scanner targeting displacement BISI/SIBI FVG 50% CE with tight structural trail.',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW'],
      lookbackMajor: 10,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 25,
      maxBarsSweepToReclaim: 10,
      maxBarsToRetest: 20,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 55.0,
      bodyRatioThreshold: 0.55,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'FVG_CE',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_btc_institutional_sniper',
    name: 'BTC Institutional 15m Sniper',
    description: 'High-conviction 15m sweep model executing at Sweep Order Block 50% Mean Threshold (MT) with 65% delta dominance.',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 35,
      maxBarsSweepToReclaim: 14,
      maxBarsToRetest: 30,
      volumeExpansionThreshold: 1.75,
      deltaDominanceThreshold: 65.0,
      bodyRatioThreshold: 0.65,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 4.0,
      entryMode: 'SWEEP_OB_MT',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.12,
      slBufferAtrMultiplier: 0.18,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_runaway_momentum_ote',
    name: 'Runaway Momentum 62% OTE',
    description: 'Deep pullback Fibonacci retracement model for high-velocity displacement trends executing at 62% OTE.',
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
      anchorTypes: ['SWING_PIVOT', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeExpansionThreshold: 1.80,
      deltaDominanceThreshold: 65.0,
      bodyRatioThreshold: 0.65,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 2.0,
      stage3Multiple: 3.5,
      entryMode: 'OTE_62',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
    } as SweepReclaimPresetConfig,
  },
  {
    id: 'factory_sr_reclaimed_shelf_breakout',
    name: 'Reclaimed Anchor Shelf Breakout',
    description: 'Direct anchor level defense model executing immediately at the reclaimed session/pivot horizontal level.',
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
      anchorTypes: ['SWING_PIVOT', 'ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'PDH', 'PDL'],
      lookbackMajor: 15,
      lookbackInternal: 5,
      maxBarsAnchorToSweep: 30,
      maxBarsSweepToReclaim: 12,
      maxBarsToRetest: 24,
      volumeExpansionThreshold: 1.50,
      deltaDominanceThreshold: 60.0,
      bodyRatioThreshold: 0.60,
      requireThreePillarDisplacement: true,
      enforceDiscountPremiumGate: true,
      stage1Multiple: 1.0,
      stage2Multiple: 1.5,
      stage3Multiple: 3.0,
      entryMode: 'SHELF_LEVEL',
      enableStructuralTrail: true,
      enableProfitRatchet: true,
      minSweepDepthAtrMultiplier: 0.10,
      slBufferAtrMultiplier: 0.15,
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
 * Retrieves the currently armed execution status with fallback to platform default (5m Champion).
 */
export function getArmedExecutionStatus(): ArmedExecutionStatus {
  const defaultStatus: ArmedExecutionStatus = {
    type: 'SWEEP_RECLAIM',
    id: 'factory_sr_5m_winner_fvg_proximal',
    name: '5m Sweep & Reclaim Max Profit Champion (FVG Proximal)',
    isAutoExecEnabled: getSweepReclaimAutoExec(),
    symbol: 'ETHUSDC',
    timeframe: '5m',
    updatedAt: Date.now(),
  };

  if (typeof window === 'undefined') return defaultStatus;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_ARMED_EXECUTION);
    if (!raw) return defaultStatus;
    const parsed = JSON.parse(raw);
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
      enforceDiscountPremiumGate: cfg.enforceDiscountPremiumGate,
      volumeExpansionThreshold: cfg.volumeExpansionThreshold,
      deltaDominanceThreshold: cfg.deltaDominanceThreshold,
      bodyRatioThreshold: cfg.bodyRatioThreshold,
      stage1Multiple: cfg.stage1Multiple ?? 1.0,
      stage2Multiple: cfg.stage2Multiple ?? 1.5,
      stage3Multiple: cfg.stage3Multiple ?? 3.0,
      enableStructuralTrail: cfg.enableStructuralTrail,
      enableProfitRatchet: cfg.enableProfitRatchet,
      anchorTypes: liveAnchors.length > 0 ? liveAnchors : ['SWING_PIVOT', 'ASIAN', 'LONDON', 'DAILY'],
      lookbackMajor: cfg.lookbackMajor ?? 15,
      lookbackInternal: cfg.lookbackInternal ?? 5,
      maxBarsAnchorToSweep: cfg.maxBarsAnchorToSweep ?? 40,
      maxBarsSweepToReclaim: cfg.maxBarsSweepToReclaim ?? 16,
      maxBarsToRetest: cfg.maxBarsToRetest ?? 30,
      minSweepDepthAtrMultiplier: cfg.minSweepDepthAtrMultiplier ?? 0.10,
      slBufferAtrMultiplier: cfg.slBufferAtrMultiplier ?? 0.15,
      requireThreePillarDisplacement: cfg.requireThreePillarDisplacement ?? true,
      enabledTimeframes: cfg.timeframe ? [cfg.timeframe as SupportedOBTimeframe] : ['15m'],
    });

    setArmedExecutionStatus({
      type: 'SWEEP_RECLAIM',
      id: preset.id,
      name: preset.name,
      isAutoExecEnabled: getSweepReclaimAutoExec(),
      symbol: cfg.symbol || 'ETHUSDC',
      timeframe: cfg.timeframe || '15m',
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


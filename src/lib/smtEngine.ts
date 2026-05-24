export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  [key: string]: any;
}

export interface SmtContext {
  m5_divergence: 'BULLISH_CONFIRMED' | 'BEARISH_CONFIRMED' | 'NONE';
  m15_divergence: 'BULLISH_CONFIRMED' | 'BEARISH_CONFIRMED' | 'NONE';
  macro_bias_sync: 'DECOUPLED' | 'SYNCED';
  btc_relative_strength: 'LEADER' | 'LAGGARD';
}

/**
 * Solves SMT divergence for a given candle series.
 * Checks the last target candle against the lowest low/highest high of the previous reference candles.
 * 
 * IF ETH_Low < Last_20_Candles_Low AND BTC_Low > Last_20_Candles_Low -> BULLISH_CONFIRMED
 * IF ETH_High > Last_20_Candles_High AND BTC_High < Last_20_Candles_High -> BEARISH_CONFIRMED
 */
export function evaluateMicroSmt(
  ethCandles: Candle[],
  btcCandles: Candle[]
): 'BULLISH_CONFIRMED' | 'BEARISH_CONFIRMED' | 'NONE' {
  if (ethCandles.length < 2 || btcCandles.length < 2) return 'NONE';

  // We evaluate the latest kline (the active/last kline in the klines array)
  // to detect real-time SMT crossovers.
  const ethTarget = ethCandles[ethCandles.length - 1];
  const btcTarget = btcCandles[btcCandles.length - 1];

  // Reference window excludes the target candle itself.
  // The default limit fetched is 20, so we take up to preceding 19 klines as the benchmark.
  const ethRef = ethCandles.slice(0, ethCandles.length - 1);
  const btcRef = btcCandles.slice(0, btcCandles.length - 1);

  if (ethRef.length === 0 || btcRef.length === 0) return 'NONE';

  const ethRefLow = Math.min(...ethRef.map((c) => c.l));
  const ethRefHigh = Math.max(...ethRef.map((c) => c.h));

  const btcRefLow = Math.min(...btcRef.map((c) => c.l));
  const btcRefHigh = Math.max(...btcRef.map((c) => c.h));

  // BULLISH MICRO SMT check
  if (ethTarget.l < ethRefLow && btcTarget.l > btcRefLow) {
    return 'BULLISH_CONFIRMED';
  }

  // BEARISH MICRO SMT check
  if (ethTarget.h > ethRefHigh && btcTarget.h < btcRefHigh) {
    return 'BEARISH_CONFIRMED';
  }

  return 'NONE';
}

/**
 * Evaluates Macro SMT Divergence based on sweep statuses against Daily PDH/PDL targets.
 * 
 * IF ETH sweeps PDH BUT BTC fails to sweep its PDH -> BEARISH_MACRO_SMT
 * IF ETH sweeps PDL BUT BTC fails to sweep its PDL -> BULLISH_MACRO_SMT
 */
export function evaluateMacroSmt(
  ethHigh: number,
  ethLow: number,
  ethPdh: number,
  ethPdl: number,
  btcHigh: number,
  btcLow: number,
  btcPdh: number,
  btcPdl: number
): { bullish: boolean; bearish: boolean } {
  const ethSweptPdh = ethHigh >= ethPdh;
  const ethSweptPdl = ethLow <= ethPdl;

  const btcSweptPdh = btcHigh >= btcPdh;
  const btcSweptPdl = btcLow <= btcPdl;

  const bearish = ethSweptPdh && !btcSweptPdh;
  const bullish = ethSweptPdl && !btcSweptPdl;

  return { bullish, bearish };
}

/**
 * Determines relative strength between ETH and BTC based on standard distance % to True Day Open.
 * Whichever asset is performing stronger relative to its opening anchor is the LEADER, others LAGGARD.
 */
export function calculateRelativeStrength(
  ethPrice: number,
  ethOpen: number | null,
  btcPrice: number,
  btcOpen: number | null
): 'LEADER' | 'LAGGARD' {
  if (!ethOpen || !btcOpen) return 'LAGGARD'; // Default baseline

  const ethPerf = (ethPrice - ethOpen) / ethOpen;
  const btcPerf = (btcPrice - btcOpen) / btcOpen;

  // If BTC performance is superior to ETH, BTC is the leader. Otherwise, BTC is lagging.
  return btcPerf > ethPerf ? 'LEADER' : 'LAGGARD';
}

/**
 * Unified Orchestrator to solve SMT Context
 */
export function getSmtContext(params: {
  ethCandles5m: Candle[];
  btcCandles5m: Candle[];
  ethCandles15m: Candle[];
  btcCandles15m: Candle[];
  ethPrice: number;
  ethOpen: number | null;
  ethPdh: number;
  ethPdl: number;
  btcPrice: number;
  btcOpen: number | null;
  btcHigh1h: number;
  btcLow1h: number;
  btcPdh: number;
  btcPdl: number;
}): SmtContext {
  const m5_divergence = evaluateMicroSmt(params.ethCandles5m, params.btcCandles5m);
  const m15_divergence = evaluateMicroSmt(params.ethCandles15m, params.btcCandles15m);

  const macroSmt = evaluateMacroSmt(
    params.ethPrice,
    params.ethPrice, // using live price as low/high bounds for instant macro evaluation
    params.ethPdh,
    params.ethPdl,
    params.btcPrice,
    params.btcPrice,
    params.btcPdh,
    params.btcPdl
  );

  const btc_relative_strength = calculateRelativeStrength(
    params.ethPrice,
    params.ethOpen,
    params.btcPrice,
    params.btcOpen
  );

  // Sync is DECOUPLED if we have active confirmed divergences or one asset swept a level while the other failed
  const isDecoupled =
    m5_divergence !== 'NONE' ||
    m15_divergence !== 'NONE' ||
    macroSmt.bullish ||
    macroSmt.bearish;

  const macro_bias_sync = isDecoupled ? 'DECOUPLED' : 'SYNCED';

  return {
    m5_divergence,
    m15_divergence,
    macro_bias_sync,
    btc_relative_strength,
  };
}

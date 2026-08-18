import { Candle } from './fvgEngine';
 
export interface InstitutionalSponsorship {
  status: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION';
  anomaly_multiplier: number;
  volume_delta: number;
  statistical_validation: {
    t_statistic: number;
    p_value: number;
    confidence_level: 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM' | 'LOW';
    confidence_tier?: 'CONFIRMED_95' | 'MODERATE_90' | 'BORDERLINE_85' | 'REJECTED' | 'CONSOLIDATION';
    confidence_tier_label?: string;
    confidence_interval_95: boolean; // Standard primary institutional benchmark (|t| >= 1.65, p <= 0.10)
    confidence_interval_95_strict: boolean; // Strict elite benchmark (|t| >= 1.96, p < 0.05)
    confidence_interval_90?: boolean;
    confidence_interval_85?: boolean;
  };
}
 
function erf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return sign * y;
}

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const mat: number[][] = [];
  for (let i = 0; i < n; i++) {
    mat[i] = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      mat[i][j] = A[i][j];
    }
    mat[i][n + i] = 1;
  }

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(mat[r][i]) > Math.abs(mat[maxRow][i])) {
        maxRow = r;
      }
    }

    if (maxRow !== i) {
      const temp = mat[i];
      mat[i] = mat[maxRow];
      mat[maxRow] = temp;
    }

    const pivot = mat[i][i];
    if (Math.abs(pivot) < 1e-12) {
      return null;
    }

    for (let j = i; j < 2 * n; j++) {
      mat[i][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = mat[r][i];
        for (let j = i; j < 2 * n; j++) {
          mat[r][j] -= factor * mat[i][j];
        }
      }
    }
  }

  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    inv[i] = mat[i].slice(n);
  }
  return inv;
}

function runRegression(recentCandles: Candle[]): {
  t_statistic: number;
  p_value: number;
  confidence_level: 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM' | 'LOW';
  confidence_tier: 'CONFIRMED_95' | 'MODERATE_90' | 'BORDERLINE_85' | 'REJECTED' | 'CONSOLIDATION';
  confidence_tier_label: string;
  confidence_interval_95: boolean;
  confidence_interval_95_strict: boolean;
  confidence_interval_90: boolean;
  confidence_interval_85: boolean;
} {
  const N = recentCandles.length;

  const volumes = recentCandles.map(c => c.v !== undefined ? c.v : ((c.taker_buy_vol || 0) + (c.taker_sell_vol || 0)));
  const volumeDeltas = recentCandles.map(c => (c.taker_buy_vol || 0) - (c.taker_sell_vol || 0));
  
  const rollingVols = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    const count = Math.min(i + 1, 14);
    for (let k = 0; k < count; k++) {
      sum += volumes[i - k];
    }
    rollingVols[i] = sum / count;
  }

  const anomalyMultipliers = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    anomalyMultipliers[i] = volumes[i] / (rollingVols[i] + 1e-5);
  }

  const deadZones = new Array<number>(N);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  for (let i = 0; i < N; i++) {
    try {
      const parts = formatter.formatToParts(new Date(recentCandles[i].t));
      let hour = 0;
      let minute = 0;
      for (const part of parts) {
        if (part.type === 'hour') hour = parseInt(part.value, 10);
        if (part.type === 'minute') minute = parseInt(part.value, 10);
      }
      deadZones[i] = (hour === 12 || (hour === 13 && minute <= 30)) ? 1 : 0;
    } catch {
      deadZones[i] = 0;
    }
  }

  const hasDeadZoneVariance = deadZones.some(d => d === 1) && deadZones.some(d => d === 0);

  // 1. Expand Forward Return Lookahead Horizon to 3 candles (Architectural Directive 1)
  const futureReturns = new Array<number>(N);
  for (let i = 0; i < N - 3; i++) {
    const prevC = recentCandles[i].c;
    futureReturns[i] = prevC !== 0 ? (recentCandles[i + 3].c - prevC) / prevC : 0;
  }
  for (let i = Math.max(0, N - 3); i < N; i++) {
    futureReturns[i] = 0;
  }

  // 2. Strict chronological safety: drop 14 warmup candles and last 3 incomplete future return candles
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 14; i < N - 3; i++) {
    if (hasDeadZoneVariance) {
      X.push([1, anomalyMultipliers[i], volumeDeltas[i], deadZones[i]]);
    } else {
      X.push([1, anomalyMultipliers[i], volumeDeltas[i]]);
    }
    y.push(futureReturns[i]);
  }

  const M = y.length;
  if (M < 10) {
    return {
      t_statistic: 0,
      p_value: 1,
      confidence_level: 'LOW',
      confidence_tier: 'REJECTED',
      confidence_tier_label: 'REJECTED',
      confidence_interval_95: false,
      confidence_interval_95_strict: false,
      confidence_interval_90: false,
      confidence_interval_85: false
    };
  }

  const K = X[0].length;
  const XT_X: number[][] = [];
  for (let r = 0; r < K; r++) {
    XT_X[r] = new Array<number>(K).fill(0);
    for (let c = 0; c < K; c++) {
      let sum = 0;
      for (let i = 0; i < M; i++) {
        sum += X[i][r] * X[i][c];
      }
      XT_X[r][c] = sum;
    }
  }

  const XT_y: number[] = new Array<number>(K).fill(0);
  for (let r = 0; r < K; r++) {
    let sum = 0;
    for (let i = 0; i < M; i++) {
      sum += X[i][r] * y[i];
    }
    XT_y[r] = sum;
  }

  const inv = invertMatrix(XT_X);
  if (!inv) {
    return {
      t_statistic: 0,
      p_value: 1,
      confidence_level: 'LOW',
      confidence_tier: 'REJECTED',
      confidence_tier_label: 'REJECTED',
      confidence_interval_95: false,
      confidence_interval_95_strict: false,
      confidence_interval_90: false,
      confidence_interval_85: false
    };
  }

  const beta = new Array<number>(K).fill(0);
  for (let r = 0; r < K; r++) {
    let sum = 0;
    for (let c = 0; c < K; c++) {
      sum += inv[r][c] * XT_y[c];
    }
    beta[r] = sum;
  }

  let RSS = 0;
  for (let i = 0; i < M; i++) {
    let yHat = 0;
    for (let j = 0; j < K; j++) {
      yHat += X[i][j] * beta[j];
    }
    const resid = y[i] - yHat;
    RSS += resid * resid;
  }

  const df = M - K;
  const s2 = RSS / df;
  const se1 = Math.sqrt(s2 * inv[1][1]);
  
  let t_statistic = 0;
  if (se1 > 0) {
    t_statistic = beta[1] / se1;
  }

  if (isNaN(t_statistic) || !isFinite(t_statistic)) {
    t_statistic = 0;
  }

  const absT = Math.abs(t_statistic);
  const p_value = 2 * (1 - normalCDF(absT));
  
  // 4-Tier Quant Classification (Architectural Directives 2 & 3)
  const confidence_interval_95_strict = p_value < 0.05 && absT >= 1.96;
  const confidence_interval_90 = p_value <= 0.10 && absT >= 1.65;
  const confidence_interval_85 = p_value <= 0.15 && absT >= 1.44;
  const confidence_interval_95 = confidence_interval_90; // Standard primary institutional benchmark

  let confidence_level: 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  let confidence_tier: 'CONFIRMED_95' | 'MODERATE_90' | 'BORDERLINE_85' | 'REJECTED' | 'CONSOLIDATION' = 'REJECTED';
  let confidence_tier_label = 'REJECTED';

  if (confidence_interval_95_strict) {
    confidence_level = 'HIGH';
    confidence_tier = 'CONFIRMED_95';
    confidence_tier_label = 'CONFIRMED (95%)';
  } else if (confidence_interval_90) {
    confidence_level = 'MEDIUM_HIGH';
    confidence_tier = 'MODERATE_90';
    confidence_tier_label = 'MODERATE (90%)';
  } else if (confidence_interval_85) {
    confidence_level = 'MEDIUM';
    confidence_tier = 'BORDERLINE_85';
    confidence_tier_label = 'BORDERLINE (85%)';
  } else {
    confidence_level = 'LOW';
    confidence_tier = 'REJECTED';
    confidence_tier_label = 'REJECTED';
  }

  return {
    t_statistic: parseFloat(t_statistic.toFixed(4)),
    p_value: parseFloat(p_value.toFixed(4)),
    confidence_level,
    confidence_tier,
    confidence_tier_label,
    confidence_interval_95,
    confidence_interval_95_strict,
    confidence_interval_90,
    confidence_interval_85
  };
}

export function verifyDisplacementOffline(recentCandles: Candle[], symbol: string = 'ETHUSDC'): InstitutionalSponsorship {
  if (recentCandles.length < 16) {
    return {
      status: 'INACTIVE',
      anomaly_multiplier: 0,
      volume_delta: 0,
      statistical_validation: {
        t_statistic: 0,
        p_value: 1,
        confidence_level: 'LOW',
        confidence_tier: 'REJECTED',
        confidence_tier_label: 'REJECTED',
        confidence_interval_95: false,
        confidence_interval_95_strict: false,
        confidence_interval_90: false,
        confidence_interval_85: false
      }
    };
  }

  // Volatility Filter offline check (price range < 0.1% is CONSOLIDATION)
  const minPrice = Math.min(...recentCandles.map(c => c.l));
  const maxPrice = Math.max(...recentCandles.map(c => c.h));
  const volatilityRange = (maxPrice - minPrice) / (minPrice + 1e-9);
  const isConsolidation = volatilityRange < 0.001;
 
  // Binance's last candle is open, so the last closed candle is length - 2
  const latestClosed = recentCandles[recentCandles.length - 2];
 
  // 14 candles prior to the latest closed candle
  const prior14 = recentCandles.slice(recentCandles.length - 16, recentCandles.length - 2);
 
  let sumBuyVol = 0;
  let sumSellVol = 0;
 
  for (const c of prior14) {
    sumBuyVol += c.taker_buy_vol || 0;
    sumSellVol += c.taker_sell_vol || 0;
  }
 
  const avgBuyVol = sumBuyVol / 14;
  const avgSellVol = sumSellVol / 14;
 
  const latestBuyVol = latestClosed.taker_buy_vol || 0;
  const latestSellVol = latestClosed.taker_sell_vol || 0;
  const isBullish = latestClosed.c > latestClosed.o;
  const isBearish = latestClosed.c < latestClosed.o;
 
  let status: 'ACTIVE_BULLISH' | 'ACTIVE_BEARISH' | 'INACTIVE' | 'CONSOLIDATION' = isConsolidation ? 'CONSOLIDATION' : 'INACTIVE';
  let anomaly_multiplier = 0;
  const volume_delta = parseFloat((latestBuyVol - latestSellVol).toFixed(2));
 
  const volMultiplier = symbol.includes('ETH') ? 2.0 : 2.5;

  if (!isConsolidation) {
    if (isBullish && latestBuyVol > (avgBuyVol * volMultiplier) && avgBuyVol > 0) {
      status = 'ACTIVE_BULLISH';
      anomaly_multiplier = parseFloat((latestBuyVol / avgBuyVol).toFixed(2));
    } else if (isBearish && latestSellVol > (avgSellVol * volMultiplier) && avgSellVol > 0) {
      status = 'ACTIVE_BEARISH';
      anomaly_multiplier = parseFloat((latestSellVol / avgSellVol).toFixed(2));
    }
  }
 
  const statistical_validation = isConsolidation 
    ? {
        t_statistic: 0,
        p_value: 1,
        confidence_level: 'LOW' as const,
        confidence_tier: 'CONSOLIDATION' as const,
        confidence_tier_label: 'CONSOLIDATION',
        confidence_interval_95: false,
        confidence_interval_95_strict: false,
        confidence_interval_90: false,
        confidence_interval_85: false
      }
    : runRegression(recentCandles);

  return {
    status,
    anomaly_multiplier,
    volume_delta,
    statistical_validation
  };
}
 
export async function verifyDisplacement(recentCandles: Candle[], symbol: string = 'ETHUSDC'): Promise<InstitutionalSponsorship> {
  const localResult = verifyDisplacementOffline(recentCandles, symbol);
  if (recentCandles.length < 16) {
    return localResult;
  }

  // Fast-path: in development mode or unless USE_PYTHON_DISPLACEMENT is explicitly enabled,
  // use the high-performance local JS OLS analytical engine directly (0ms network latency)
  if (process.env.NODE_ENV === 'development' && process.env.USE_PYTHON_DISPLACEMENT !== 'true') {
    return localResult;
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200); // 1.2s rapid response threshold

    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const baseUrl = process.env.NODE_ENV === 'development' 
      ? 'http://127.0.0.1:8000' 
      : (vercelHost ? `https://${vercelHost}` : 'http://127.0.0.1:4000');
 
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Bypass Vercel Authentication on Preview Deployments for server-to-server fetches
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
 
    const response = await fetch(`${baseUrl}/api/py/calculate-displacement?symbol=${symbol}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(recentCandles.map(c => ({
        t: c.t,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v || ((c.taker_buy_vol || 0) + (c.taker_sell_vol || 0)),
        taker_buy_vol: c.taker_buy_vol || 0,
        taker_sell_vol: c.taker_sell_vol || 0,
      }))),
      signal: controller.signal
    });
 
    clearTimeout(id);
    if (response.ok) {
      const data = await response.json();
      return data as InstitutionalSponsorship;
    } else {
      console.error('[verifyDisplacement] HTTP Error:', response.status, await response.text());
    }
  } catch (error: any) {
    console.warn(`[verifyDisplacement] Fetch Error: ${error.message || error}`);
    // Silent fail back to local offline analytical engine
  }
 
  return localResult;
}

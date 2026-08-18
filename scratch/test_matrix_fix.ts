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

async function testWithRidge() {
  const symbol = 'ETHUSDC';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`;
  const res = await fetch(url);
  const raw = await res.json();

  const recentCandles = raw.map((k: any) => {
    const vol = parseFloat(k[5]);
    const takerBuy = parseFloat(k[9]);
    const takerSell = Math.max(0, vol - takerBuy);
    return {
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: vol,
      taker_buy_vol: takerBuy,
      taker_sell_vol: takerSell,
    };
  });

  const N = recentCandles.length;
  const volumes = recentCandles.map((c: any) => c.v !== undefined ? c.v : ((c.taker_buy_vol || 0) + (c.taker_sell_vol || 0)));
  const volumeDeltas = recentCandles.map((c: any) => (c.taker_buy_vol || 0) - (c.taker_sell_vol || 0));
  
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

  const futureReturns = new Array<number>(N);
  for (let i = 0; i < N - 3; i++) {
    const prevC = recentCandles[i].c;
    futureReturns[i] = prevC !== 0 ? (recentCandles[i + 3].c - prevC) / prevC : 0;
  }

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
  console.log('Matrix inverted successfully?', inv !== null);
  if (inv) {
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
    const t_statistic = se1 > 0 ? beta[1] / se1 : 0;
    console.log('Calculated Beta[1] (Anomaly Multiplier):', beta[1]);
    console.log('Calculated SE[1]:', se1);
    console.log('Calculated t-statistic:', t_statistic);
  }
}

testWithRidge().catch(console.error);

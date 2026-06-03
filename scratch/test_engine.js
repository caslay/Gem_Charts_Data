// Standalone mock of Candle and the exact logic of the MarketStructureEngine to isolate execution
class MarketStructureEngine {
  constructor(config) {
    this.atr_period = config?.atrPeriod ?? 14;
    this.adaptive_n_min = config?.adaptiveNMin ?? 3;
    this.adaptive_n_max = config?.adaptiveNMax ?? 15;
    this.mss_body_ratio = config?.mssBodyRatio ?? 0.70;
    this.displacement_vef = config?.displacementVef ?? 1.50;
    this.sharp_departure_mult = config?.sharpDepartureMult ?? 1.50;
    this.n_base = 5;

    this.current_trend_state = 'BULLISH_SWING';
    this.active_swing_high = null;
    this.active_swing_low = null;
    this.candidate_high = -Infinity;
    this.candidate_low = Infinity;
    this.protected_high = null;
    this.protected_low = null;
    this.active_idm_level = null;

    this.candles = [];
    this.last_mother_bar_index = 0;
    this.confirmed_pivots = [];
    this.registered_events = [];
    this.pending_breaks = [];
  }

  calculate_adaptive_n(current_idx) {
    const atr = this.compute_atr(current_idx, this.atr_period);
    const rolling_median_atr = this.compute_median_atr(current_idx, 100);

    if (isNaN(atr) || isNaN(rolling_median_atr) || rolling_median_atr === 0) return this.n_base;

    const ratio = atr / rolling_median_atr;
    const adaptive_n = Math.floor(this.n_base * (2.0 - ratio));

    if (isNaN(adaptive_n)) return this.n_base;
    return Math.max(this.adaptive_n_min, Math.min(this.adaptive_n_max, adaptive_n));
  }

  is_inside_bar(current_idx, mother_idx) {
    const current = this.candles[current_idx];
    const mother = this.candles[mother_idx];
    if (!current || !mother) return false;
    return current.high <= mother.high && current.low >= mother.low;
  }

  process_candle(candle) {
    this.candles.push(candle);
    const t = this.candles.length - 1;

    if (t < 2) {
      this.last_mother_bar_index = t;
      return;
    }

    if (this.is_inside_bar(t, this.last_mother_bar_index)) {
      this.candles[t].inside_bar = true;
      return;
    } else {
      this.last_mother_bar_index = t;
    }

    const N_t = this.calculate_adaptive_n(t);
    this.detect_pivots(t, N_t);
    this.update_inducement_gates(t);
    this.evaluate_state_transitions(t);
    this.check_pending_departures(t);
  }

  detect_pivots(t, N_t) {
    if (isNaN(N_t)) return;
    const check_idx = t - N_t;
    if (check_idx < N_t || check_idx < 0 || check_idx >= this.candles.length) return;

    const target_candle = this.candles[check_idx];
    if (!target_candle || target_candle.inside_bar) return;

    const target_high = target_candle.high;
    const target_low = target_candle.low;
    let is_swing_high = true;
    let is_swing_low = true;

    for (let j = 1; j <= N_t; j++) {
      const left = this.candles[check_idx - j];
      const right = this.candles[check_idx + j];

      if (!left || !right) {
        is_swing_high = false;
        is_swing_low = false;
        continue;
      }

      if (left.high > target_high || right.high > target_high) {
        is_swing_high = false;
      }
      if (left.low < target_low || right.low < target_low) {
        is_swing_low = false;
      }
    }

    if (is_swing_high) {
      const isConfirmed = target_high === this.active_swing_high;
      this.confirmed_pivots.push({
        type: 'SWING_HIGH',
        index: check_idx,
        price: target_high,
        confirmed: isConfirmed,
        timestamp: target_candle.t
      });
      if (target_high > this.candidate_high) {
        this.candidate_high = target_high;
      }
      if (isConfirmed) {
        this.confirm_corresponding_low(check_idx);
      }
    }
    if (is_swing_low) {
      const isConfirmed = target_low === this.active_swing_low;
      this.confirmed_pivots.push({
        type: 'SWING_LOW',
        index: check_idx,
        price: target_low,
        confirmed: isConfirmed,
        timestamp: target_candle.t
      });
      if (target_low < this.candidate_low) {
        this.candidate_low = target_low;
      }
      if (isConfirmed) {
        this.confirm_corresponding_high(check_idx);
      }
    }
  }

  confirm_corresponding_low(highIdx) {
    const lastHighIndex = this.confirmed_pivots
      .filter(p => p.type === 'SWING_HIGH' && p.confirmed && p.index < highIdx)
      .reduce((max, p) => p.index > max ? p.index : max, 0);

    const lows = this.confirmed_pivots.filter(p => p.type === 'SWING_LOW' && p.index > lastHighIndex && p.index < highIdx);
    if (lows.length > 0) {
      const lowestLow = lows.reduce((min, p) => p.price < min.price ? p : min, lows[0]);
      lowestLow.confirmed = true;
      this.active_swing_low = lowestLow.price;
      this.protected_low = lowestLow.price;
      // console.log(`[Gate] Retroactively confirmed corresponding Low: ${lowestLow.price} at index ${lowestLow.index}`);
    }
  }

  confirm_corresponding_high(lowIdx) {
    const lastLowIndex = this.confirmed_pivots
      .filter(p => p.type === 'SWING_LOW' && p.confirmed && p.index < lowIdx)
      .reduce((max, p) => p.index > max ? p.index : max, 0);

    const highs = this.confirmed_pivots.filter(p => p.type === 'SWING_HIGH' && p.index > lastLowIndex && p.index < lowIdx);
    if (highs.length > 0) {
      const highestHigh = highs.reduce((max, p) => p.price > max.price ? p : max, highs[0]);
      highestHigh.confirmed = true;
      this.active_swing_high = highestHigh.price;
      this.protected_high = highestHigh.price;
      // console.log(`[Gate] Retroactively confirmed corresponding High: ${highestHigh.price} at index ${highestHigh.index}`);
    }
  }

  update_inducement_gates(t) {
    const current = this.candles[t];
    const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
    const volume_sma = this.compute_volume_sma(t, 20);
    const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;

    if (this.current_trend_state === 'BULLISH_SWING') {
      if (this.active_swing_high === null && current.close < current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
        console.log(`[IDM] V-Reversal confirming Swing High: ${this.candidate_high} at candle ${t}`);
        this.active_swing_high = this.candidate_high;
        this.active_idm_level = null;
        
        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_HIGH' && p.price === this.candidate_high);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_low(pivot.index);
        }

        this.registered_events.push({
          type: 'SWING_HIGH_CONFIRMED',
          price: this.active_swing_high,
          index: t,
          timestamp: current.t,
          is_vreversal: true
        });
      }

      if (this.active_idm_level !== null && current.low < this.active_idm_level) {
        console.log(`[IDM] Sweep confirmed Swing High: ${this.candidate_high} (swept level ${this.active_idm_level} with low ${current.low}) at candle ${t}`);
        this.active_swing_high = this.candidate_high;
        this.active_idm_level = null;

        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_HIGH' && p.price === this.candidate_high);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_low(pivot.index);
        }

        this.registered_events.push({
          type: 'SWING_HIGH_CONFIRMED',
          price: this.active_swing_high,
          index: t,
          timestamp: current.t
        });
      }

      if (current.high > this.candidate_high) {
        this.candidate_high = current.high;
        const new_idm = this.locate_last_pullback_low(t);
        if (new_idm !== null) {
          this.active_idm_level = new_idm;
          // console.log(`[IDM] Candidate High updated to ${this.candidate_high}. Active IDM Level shifted to ${this.active_idm_level} at candle ${t}`);
        }
      }
    } else if (this.current_trend_state === 'BEARISH_SWING') {
      if (this.active_swing_low === null && current.close > current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
        console.log(`[IDM] V-Reversal confirming Swing Low: ${this.candidate_low} at candle ${t}`);
        this.active_swing_low = this.candidate_low;
        this.active_idm_level = null;

        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_LOW' && p.price === this.candidate_low);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_high(pivot.index);
        }

        this.registered_events.push({
          type: 'SWING_LOW_CONFIRMED',
          price: this.active_swing_low,
          index: t,
          timestamp: current.t,
          is_vreversal: true
        });
      }

      if (this.active_idm_level !== null && current.high > this.active_idm_level) {
        console.log(`[IDM] Sweep confirmed Swing Low: ${this.candidate_low} (swept level ${this.active_idm_level} with high ${current.high}) at candle ${t}`);
        this.active_swing_low = this.candidate_low;
        this.active_idm_level = null;

        const pivot = this.confirmed_pivots.find(p => p.type === 'SWING_LOW' && p.price === this.candidate_low);
        if (pivot) {
          pivot.confirmed = true;
          this.confirm_corresponding_high(pivot.index);
        }

        this.registered_events.push({
          type: 'SWING_LOW_CONFIRMED',
          price: this.active_swing_low,
          index: t,
          timestamp: current.t
        });
      }

      if (current.low < this.candidate_low) {
        this.candidate_low = current.low;
        const new_idm = this.locate_last_pullback_high(t);
        if (new_idm !== null) {
          this.active_idm_level = new_idm;
          // console.log(`[IDM] Candidate Low updated to ${this.candidate_low}. Active IDM Level shifted to ${this.active_idm_level} at candle ${t}`);
        }
      }
    }
  }

  evaluate_state_transitions(t) {
    const current = this.candles[t];

    if (this.current_trend_state === 'BULLISH_SWING') {
      if (this.active_swing_high !== null && current.close > this.active_swing_high) {
        console.log(`[BOS] Bullish BOS registered! Level: ${this.active_swing_high} at candle ${t}`);
        this.registered_events.push({
          type: 'BOS',
          direction: 'BULLISH',
          level: this.active_swing_high,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.active_swing_high, type: 'BOS', direction: 'BULLISH' });
        this.protected_low = this.active_swing_low;
        this.active_swing_high = null;
        this.candidate_high = current.high;
      }

      if (this.protected_low !== null && current.close < this.protected_low) {
        const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
        const volume_sma = this.compute_volume_sma(t, 20);
        const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
        const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
        const event_type = is_displaced ? 'MSS' : 'CHoCH';

        console.log(`[Reversal] Bearish ${event_type} registered! Broken protected low: ${this.protected_low} at candle ${t}`);
        this.registered_events.push({
          type: event_type,
          direction: 'BEARISH',
          level: this.protected_low,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.protected_low, type: event_type, direction: 'BEARISH' });

        this.current_trend_state = 'BEARISH_SWING';
        this.protected_high = this.active_swing_high;
        this.active_swing_low = current.low;
        this.candidate_low = current.low;
        this.active_idm_level = null;
      }
    } else if (this.current_trend_state === 'BEARISH_SWING') {
      if (this.active_swing_low !== null && current.close < this.active_swing_low) {
        console.log(`[BOS] Bearish BOS registered! Level: ${this.active_swing_low} at candle ${t}`);
        this.registered_events.push({
          type: 'BOS',
          direction: 'BEARISH',
          level: this.active_swing_low,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.active_swing_low, type: 'BOS', direction: 'BEARISH' });
        this.protected_high = this.active_swing_high;
        this.active_swing_low = null;
        this.candidate_low = current.low;
      }

      if (this.protected_high !== null && current.close > this.protected_high) {
        const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
        const volume_sma = this.compute_volume_sma(t, 20);
        const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
        const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
        const event_type = is_displaced ? 'MSS' : 'CHoCH';

        console.log(`[Reversal] Bullish ${event_type} registered! Broken protected high: ${this.protected_high} at candle ${t}`);
        this.registered_events.push({
          type: event_type,
          direction: 'BULLISH',
          level: this.protected_high,
          index: t,
          timestamp: current.t
        });
        this.pending_breaks.push({ event_idx: t, p_ref: this.protected_high, type: event_type, direction: 'BULLISH' });

        this.current_trend_state = 'BULLISH_SWING';
        this.protected_low = this.active_swing_low;
        this.active_swing_high = current.high;
        this.candidate_high = current.high;
        this.active_idm_level = null;
      }
    }
  }

  check_pending_departures(t) {
    const atr = this.compute_atr(t, this.atr_period);
    for (let i = this.pending_breaks.length - 1; i >= 0; i--) {
      const pb = this.pending_breaks[i];
      const k = t - pb.event_idx;

      if (k > 5) {
        const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
        if (ev) {
          ev.sharp_departure_failed = true;
          ev.invalidated = true;
        }
        this.pending_breaks.splice(i, 1);
      } else {
        const distance = Math.abs(this.candles[t].close - pb.p_ref);
        if (distance >= this.sharp_departure_mult * atr) {
          const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
          if (ev) {
            ev.sharp_departure_confirmed = true;
          }
          this.pending_breaks.splice(i, 1);
        }
      }
    }
  }

  compute_tr(idx) {
    const current = this.candles[idx];
    if (!current) return 0;
    if (idx === 0) return current.high - current.low;
    const prev = this.candles[idx - 1];
    if (!prev) return current.high - current.low;
    return Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
  }

  compute_atr(idx, len) {
    if (idx < len - 1) {
      let trSum = 0;
      for (let i = 0; i <= idx; i++) {
        trSum += this.compute_tr(i);
      }
      return trSum / (idx + 1);
    }
    let trSum = 0;
    for (let i = idx - len + 1; i <= idx; i++) {
      trSum += this.compute_tr(i);
    }
    return trSum / len;
  }

  compute_median_atr(idx, horizon) {
    const atrs = [];
    const start = Math.max(0, idx - horizon + 1);
    for (let i = start; i <= idx; i++) {
      atrs.push(this.compute_atr(i, this.atr_period));
    }
    if (atrs.length === 0) return 0;
    atrs.sort((a, b) => a - b);
    const mid = Math.floor(atrs.length / 2);
    if (atrs.length % 2 === 0) {
      return (atrs[mid - 1] + atrs[mid]) / 2;
    }
    return atrs[mid];
  }

  compute_volume_sma(idx, len) {
    const start = Math.max(0, idx - len + 1);
    let volSum = 0;
    for (let i = start; i <= idx; i++) {
      const candle = this.candles[i];
      if (candle) {
        volSum += candle.volume;
      }
    }
    return volSum / (idx - start + 1);
  }

  locate_last_pullback_low(peak_idx) {
    for (let k = peak_idx - 1; k >= 0; k--) {
      const candle_k = this.candles[k];
      if (!candle_k || candle_k.inside_bar) continue;

      let is_pullback = false;
      let lowest_low = Infinity;
      let highest_in_between = -Infinity;

      for (let s = k + 1; s <= peak_idx; s++) {
        const candle_s = this.candles[s];
        if (!candle_s || candle_s.inside_bar) continue;

        const prev_s = this.candles[s - 1];
        if (!prev_s) continue;
        if (prev_s.high > highest_in_between) {
          highest_in_between = prev_s.high;
        }

        if (highest_in_between > candle_k.high) {
          break;
        }

        if (candle_s.low < candle_k.low) {
          is_pullback = true;
          for (let j = k; j <= peak_idx; j++) {
            const candle_j = this.candles[j];
            if (candle_j && candle_j.low < lowest_low) {
              lowest_low = candle_j.low;
            }
          }
          break;
        }
      }

      if (is_pullback) {
        return lowest_low;
      }
    }
    return null;
  }

  locate_last_pullback_high(t) {
    for (let k = t - 1; k >= 0; k--) {
      const candle_k = this.candles[k];
      if (!candle_k || candle_k.inside_bar) continue;

      let is_pullback = false;
      let highest_high = -Infinity;
      let lowest_in_between = Infinity;

      for (let s = k + 1; s <= t; s++) {
        const candle_s = this.candles[s];
        if (!candle_s || candle_s.inside_bar) continue;

        const prev_s = this.candles[s - 1];
        if (!prev_s) continue;
        if (prev_s.low < lowest_in_between) {
          lowest_in_between = prev_s.low;
        }

        if (lowest_in_between < candle_k.low) {
          break;
        }

        if (candle_s.high > candle_k.high) {
          is_pullback = true;
          for (let j = k; j <= t; j++) {
            const candle_j = this.candles[j];
            if (candle_j && candle_j.high > highest_high) {
              highest_high = candle_j.high;
            }
          }
          break;
        }
      }

      if (is_pullback) {
        return highest_high;
      }
    }
    return null;
  }
}

async function run() {
  try {
    console.log('Fetching ETHUSDT 5m klines from Binance...');
    const url = 'https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=5m&limit=1000';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Binance request failed');
    const rawData = await res.json();
    console.log(`Fetched ${rawData.length} klines.`);

    const candles = rawData.map(c => ({
      t: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));

    const engine = new MarketStructureEngine();
    console.log('Processing candles in the engine...');
    for (const c of candles) {
      engine.process_candle(c);
    }

    console.log('\n--- STANDALONE ENGINE RESULTS ---');
    console.log(`Total processed candles in engine: ${engine.candles.length}`);
    const insideBarsCount = engine.candles.filter(c => c.inside_bar).length;
    console.log(`Inside Bars Filtered: ${insideBarsCount} (${((insideBarsCount / candles.length) * 100).toFixed(1)}%)`);
    console.log(`Confirmed Swings Count: ${engine.confirmed_pivots.filter(p => p.confirmed).length}`);
    console.log(`Unconfirmed Swings Count: ${engine.confirmed_pivots.filter(p => !p.confirmed).length}`);
    console.log(`Total Confirmed Pivots (SWING_HIGH/SWING_LOW): ${engine.confirmed_pivots.length}`);
    console.log(`Registered Events Count: ${engine.registered_events.length}`);
    console.log('BOS Events:', engine.registered_events.filter(e => e.type === 'BOS'));
    console.log('MSS Events:', engine.registered_events.filter(e => e.type === 'MSS'));
    console.log('CHoCH Events:', engine.registered_events.filter(e => e.type === 'CHoCH'));
    console.log('All Swings:', engine.confirmed_pivots.map(p => ({ idx: p.index, type: p.type, price: p.price, confirmed: p.confirmed })));
  } catch (err) {
    console.error('Error running test script:', err);
  }
}

run();

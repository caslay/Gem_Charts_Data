"use strict";
/**
 * structureEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized Algorithmic Market Structure Engine (V11.0)
 *
 * Designed to perform real-time ICT/SMC structural tracking based on
 * Interbank Price Delivery Algorithm (IPDA) mechanics.
 *
 * Features:
 *   1. Volatility-Adjusted Adaptive Pivot Window (Nt)
 *   2. Inside Bar Mitigation Filter (recursive mother bar indexing)
 *   3. Inducement (IDM) Confirmation Gate (sweep-validated swing confirmation)
 *   4. Displacement Verification (BR >= 0.70 & VEF >= 1.50)
 *   5. Hardening Filters: Sharp Departure & V-Reversal Gates
 *   6. Full Legacy Downstream Compatibility Mappings
 * ─────────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketStructureEngine = void 0;
exports.analyzeMarketStructure = analyzeMarketStructure;
exports.analyzeMarketStructureStateful = analyzeMarketStructureStateful;
// ─── MarketStructureEngine Class ──────────────────────────────────────────────
class MarketStructureEngine {
    constructor(config) {
        this.n_base = 5;
        // Sharp Departure watch list
        this.pending_breaks = [];
        this.atr_period = config?.atrPeriod ?? 14;
        this.adaptive_n_min = config?.adaptiveNMin ?? 3;
        this.adaptive_n_max = config?.adaptiveNMax ?? 15;
        this.mss_body_ratio = config?.mssBodyRatio ?? 0.70;
        this.displacement_vef = config?.displacementVef ?? 1.50;
        this.sharp_departure_mult = config?.sharpDepartureMult ?? 1.50;
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
    }
    // 1. Dynamic Volatility Window Calculation
    calculate_adaptive_n(current_idx) {
        const atr = this.compute_atr(current_idx, this.atr_period);
        const rolling_median_atr = this.compute_median_atr(current_idx, 100);
        if (isNaN(atr) || isNaN(rolling_median_atr) || rolling_median_atr === 0)
            return this.n_base;
        const ratio = atr / rolling_median_atr;
        const adaptive_n = Math.floor(this.n_base * (2.0 - ratio));
        if (isNaN(adaptive_n))
            return this.n_base;
        // Clamp to hard limits
        return Math.max(this.adaptive_n_min, Math.min(this.adaptive_n_max, adaptive_n));
    }
    // 2. Inside Bar Filtering Gate
    is_inside_bar(current_idx, mother_idx) {
        const current = this.candles[current_idx];
        const mother = this.candles[mother_idx];
        if (!current || !mother)
            return false;
        return current.high <= mother.high && current.low >= mother.low;
    }
    // Single-pass processing pipeline
    process_candle(candle) {
        this.candles.push(candle);
        const t = this.candles.length - 1;
        if (t < 2) {
            this.last_mother_bar_index = t;
            return;
        }
        // A. Evaluate Inside Bar Mitigation Filter
        if (this.is_inside_bar(t, this.last_mother_bar_index)) {
            // Flag inside bar state inside the candle for pullback reference
            this.candles[t].inside_bar = true;
            return;
        }
        else {
            this.last_mother_bar_index = t;
        }
        // B. Compute Volatility-Adjusted Window and Detect Pivots
        const N_t = this.calculate_adaptive_n(t);
        this.detect_pivots(t, N_t);
        // C. Update Inducement Sweep and Swing Confirmations
        this.update_inducement_gates(t);
        // D. Evaluate FSM State Transitions
        this.evaluate_state_transitions(t);
        // E. Evaluate Sharp Departures on Breakouts
        this.check_pending_departures(t);
    }
    detect_pivots(t, N_t) {
        if (isNaN(N_t))
            return;
        const check_idx = t - N_t;
        if (check_idx < N_t || check_idx < 0 || check_idx >= this.candles.length)
            return;
        const target_candle = this.candles[check_idx];
        if (!target_candle || target_candle.inside_bar)
            return;
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
        }
    }
    update_inducement_gates(t) {
        const current = this.candles[t];
        // Calculate Volume and Body elements for V-Reversal overrides
        const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
        const volume_sma = this.compute_volume_sma(t, 20);
        const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
        if (this.current_trend_state === 'BULLISH_SWING') {
            // V-Reversal override: Aggressive downward displacement collapses candidate without pullback
            if (this.active_swing_high === null && current.close < current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
                this.active_swing_high = this.candidate_high;
                this.active_idm_level = null;
                // Force-confirm the unconfirmed candidate pivot
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
            // Standard Inducement Sweep validation
            if (this.active_idm_level !== null && current.low < this.active_idm_level) {
                this.active_swing_high = this.candidate_high;
                this.active_idm_level = null; // Confirmed, reset level
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
            // Inducement Shift Mechanism
            if (current.high > this.candidate_high) {
                this.candidate_high = current.high;
                const new_idm = this.locate_last_pullback_low(t);
                if (new_idm !== null) {
                    this.active_idm_level = new_idm;
                }
            }
        }
        else if (this.current_trend_state === 'BEARISH_SWING') {
            // V-Reversal override: Aggressive upward displacement spikes candidate without pullback
            if (this.active_swing_low === null && current.close > current.open && body_ratio >= 0.85 && volume_expansion >= 2.0) {
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
            // Standard Inducement Sweep validation
            if (this.active_idm_level !== null && current.high > this.active_idm_level) {
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
            // Inducement Shift Mechanism
            if (current.low < this.candidate_low) {
                this.candidate_low = current.low;
                const new_idm = this.locate_last_pullback_high(t);
                if (new_idm !== null) {
                    this.active_idm_level = new_idm;
                }
            }
        }
    }
    evaluate_state_transitions(t) {
        const current = this.candles[t];
        if (this.current_trend_state === 'BULLISH_SWING') {
            // 1. Evaluate Break of Structure (BOS)
            if (this.active_swing_high !== null && current.close > this.active_swing_high) {
                this.registered_events.push({
                    type: 'BOS',
                    direction: 'BULLISH',
                    level: this.active_swing_high,
                    index: t,
                    timestamp: current.t
                });
                // Dynamic queue for momentum verification
                this.pending_breaks.push({ event_idx: t, p_ref: this.active_swing_high, type: 'BOS', direction: 'BULLISH' });
                this.protected_low = this.active_swing_low;
                this.active_swing_high = null;
                this.candidate_high = current.high;
            }
            // 2. Evaluate Change of Character / Market Structure Shift
            if (this.protected_low !== null && current.close < this.protected_low) {
                const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
                const volume_sma = this.compute_volume_sma(t, 20);
                const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
                const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
                const event_type = is_displaced ? 'MSS' : 'CHoCH';
                this.registered_events.push({
                    type: event_type,
                    direction: 'BEARISH',
                    level: this.protected_low,
                    index: t,
                    timestamp: current.t
                });
                this.pending_breaks.push({ event_idx: t, p_ref: this.protected_low, type: event_type, direction: 'BEARISH' });
                // Perform FSM State Mutation
                this.current_trend_state = 'BEARISH_SWING';
                this.protected_high = this.active_swing_high;
                this.active_swing_low = current.low;
                this.candidate_low = current.low;
                this.active_idm_level = null;
            }
        }
        else if (this.current_trend_state === 'BEARISH_SWING') {
            // 1. Evaluate Break of Structure (BOS)
            if (this.active_swing_low !== null && current.close < this.active_swing_low) {
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
            // 2. Evaluate Change of Character / Market Structure Shift
            if (this.protected_high !== null && current.close > this.protected_high) {
                const body_ratio = Math.abs(current.close - current.open) / (current.high - current.low || 1);
                const volume_sma = this.compute_volume_sma(t, 20);
                const volume_expansion = volume_sma > 0 ? (current.volume / volume_sma) : 1.0;
                const is_displaced = body_ratio >= this.mss_body_ratio && volume_expansion >= this.displacement_vef;
                const event_type = is_displaced ? 'MSS' : 'CHoCH';
                this.registered_events.push({
                    type: event_type,
                    direction: 'BULLISH',
                    level: this.protected_high,
                    index: t,
                    timestamp: current.t
                });
                this.pending_breaks.push({ event_idx: t, p_ref: this.protected_high, type: event_type, direction: 'BULLISH' });
                // Perform FSM State Mutation
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
                // Exceeded MaxConsolidation consolidation range, departure failed
                const ev = this.registered_events.find(e => e.index === pb.event_idx && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
                if (ev) {
                    ev.sharp_departure_failed = true;
                    ev.invalidated = true;
                }
                this.pending_breaks.splice(i, 1);
            }
            else {
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
    // Mathematics Helpers
    compute_tr(idx) {
        const current = this.candles[idx];
        if (!current)
            return 0;
        if (idx === 0)
            return current.high - current.low;
        const prev = this.candles[idx - 1];
        if (!prev)
            return current.high - current.low;
        return Math.max(current.high - current.low, Math.abs(current.high - prev.close), Math.abs(current.low - prev.close));
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
        if (atrs.length === 0)
            return 0;
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
    // Pullback search algorithms
    locate_last_pullback_low(peak_idx) {
        for (let k = peak_idx - 1; k >= 0; k--) {
            const candle_k = this.candles[k];
            if (!candle_k || candle_k.inside_bar)
                continue;
            let is_pullback = false;
            let lowest_low = Infinity;
            let highest_in_between = -Infinity;
            for (let s = k + 1; s <= peak_idx; s++) {
                const candle_s = this.candles[s];
                if (!candle_s || candle_s.inside_bar)
                    continue;
                const prev_s = this.candles[s - 1];
                if (!prev_s)
                    continue;
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
            if (!candle_k || candle_k.inside_bar)
                continue;
            let is_pullback = false;
            let highest_high = -Infinity;
            let lowest_in_between = Infinity;
            for (let s = k + 1; s <= t; s++) {
                const candle_s = this.candles[s];
                if (!candle_s || candle_s.inside_bar)
                    continue;
                const prev_s = this.candles[s - 1];
                if (!prev_s)
                    continue;
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
exports.MarketStructureEngine = MarketStructureEngine;
// ─── Single/Stateful Execution Wrapper ───────────────────────────────────────
function analyzeMarketStructure(candles, currentPrice, displacementStatus, contextAnchorTimestamp, globalAnchors, config) {
    if (candles.length === 0) {
        return {
            last_processed_index: 0,
            engine_state: { current_trend_state: 'BULLISH_SWING', protected_high: null, protected_low: null, active_swing_range: { low: null, high: null } },
            swing_points: [],
            structural_events: [],
            liquidity_zones: [],
            expansion_mode: 'NORMAL',
            market_velocity: 0,
            runaway_origin_price: null,
            swings: [],
            zigzag: [],
            dealingRange: { high: 0, low: 0, equilibrium: 0, current_status: 'UNKNOWN', anchor_high_swing: null, anchor_low_swing: null },
            currentTrend: 'UNSET',
            latestMSS: null,
            market_structure_shift: false,
            market_structure_shift_direction: null
        };
    }
    // V11.0.1 - Normalization Guard: Enforce double-sided candle properties naming compatibility
    // (supporting both h/l/o/c/v and high/low/open/close/volume seamlessly)
    const normalizedCandles = candles.map(c => ({
        ...c,
        open: c.open !== undefined ? c.open : c.o,
        high: c.high !== undefined ? c.high : c.h,
        low: c.low !== undefined ? c.low : c.l,
        close: c.close !== undefined ? c.close : c.c,
        volume: c.volume !== undefined ? c.volume : c.v
    }));
    // 1. Process candles sequentially through the MarketStructureEngine
    const engine = new MarketStructureEngine(config);
    for (const c of normalizedCandles) {
        engine.process_candle(c);
    }
    // Sort and build structural arrays
    const last_idx = normalizedCandles.length - 1;
    const swing_points = engine.confirmed_pivots;
    const structural_events = engine.registered_events;
    // 2. COMPATIBILITY WRAPPER: Map new arrays to legacy Next.js visual keys
    const swings = swing_points.map(pt => ({
        t: pt.timestamp,
        price: pt.price,
        type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
        grade: 'MAJOR',
        colorValidated: true,
        candle_index: pt.index,
        timestamp: new Date(pt.timestamp).toISOString(),
        structure_type: 'MAJOR',
        confirmed: pt.confirmed
    }));
    // Reconstruct zig-zag segment lines with legacy direction validation
    const zigzag = [];
    let trend = 'UNSET';
    let latestMSS = null;
    const confirmedSwings = swings.filter(s => s.confirmed);
    const alternatingSwings = [];
    for (const s of confirmedSwings) {
        if (alternatingSwings.length === 0) {
            alternatingSwings.push(s);
            continue;
        }
        const last = alternatingSwings[alternatingSwings.length - 1];
        if (last.type === s.type) {
            if (s.price > last.price)
                alternatingSwings[alternatingSwings.length - 1] = s;
            else {
                if (s.price < last.price)
                    alternatingSwings[alternatingSwings.length - 1] = s;
            }
        }
        else {
            alternatingSwings.push(s);
        }
    }
    for (let i = 0; i < alternatingSwings.length - 1; i++) {
        const from = alternatingSwings[i];
        const to = alternatingSwings[i + 1];
        const trendBefore = trend;
        let label = 'INTERNAL';
        let trendAfter = trend;
        // Resolve breakout event at the segment's ending coordinate
        const ev = structural_events.find(e => e.index === to.candle_index && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
        if (ev) {
            if (ev.type === 'BOS') {
                label = 'BOS';
                trendAfter = ev.direction || 'UNSET';
            }
            else {
                label = 'MSS';
                trendAfter = ev.direction || 'UNSET';
            }
        }
        trend = trendAfter;
        const segment = {
            from,
            to,
            label,
            trendBefore,
            trendAfter,
            displacementConfirmed: label === 'MSS' && !ev?.sharp_departure_failed
        };
        zigzag.push(segment);
        if (label === 'MSS') {
            latestMSS = segment;
        }
    }
    // Derive active Dealing Range
    let dealingRange;
    const majorHighs = alternatingSwings.filter(s => s.type === 'HIGH');
    const majorLows = alternatingSwings.filter(s => s.type === 'LOW');
    if (majorHighs.length > 0 && majorLows.length > 0) {
        const lastHigh = majorHighs[majorHighs.length - 1];
        const lastLow = majorLows[majorLows.length - 1];
        const highVal = parseFloat(lastHigh.price.toFixed(2));
        const lowVal = parseFloat(lastLow.price.toFixed(2));
        const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
        dealingRange = {
            high: highVal,
            low: lowVal,
            equilibrium: eqVal,
            current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
            anchor_high_swing: lastHigh,
            anchor_low_swing: lastLow
        };
    }
    else {
        const highVal = normalizedCandles.length > 0 ? Math.max(...normalizedCandles.map(c => c.high)) : 0;
        const lowVal = normalizedCandles.length > 0 ? Math.min(...normalizedCandles.map(c => c.low)) : 0;
        const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
        dealingRange = {
            high: highVal,
            low: lowVal,
            equilibrium: eqVal,
            current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
            anchor_high_swing: null,
            anchor_low_swing: null
        };
    }
    const hasConfirmedMSS = latestMSS !== null && latestMSS.displacementConfirmed;
    // Add internal sub-waves to returned object for complete layout styling
    const internalTrend = engine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH';
    // Merge unconfirmed raw swings back into returned swings strictly for unconfirmed trace ray visualizers
    swings.push(...swings.filter(s => !s.confirmed).map(s => ({ ...s, structure_type: 'INTERNAL' })));
    swings.sort((a, b) => a.t - b.t);
    return {
        last_processed_index: last_idx,
        engine_state: {
            current_trend_state: engine.current_trend_state,
            protected_high: engine.protected_high,
            protected_low: engine.protected_low,
            active_swing_range: {
                low: engine.active_swing_low,
                high: engine.active_swing_high
            }
        },
        swing_points,
        structural_events,
        liquidity_zones: [],
        // Dynamic indicators
        expansion_mode: 'NORMAL',
        market_velocity: 0,
        runaway_origin_price: null,
        // Legacy fields mapped perfectly
        swings,
        zigzag,
        dealingRange,
        currentTrend: engine.current_trend_state === 'BULLISH_SWING' ? 'BULLISH' : 'BEARISH',
        latestMSS,
        market_structure_shift: hasConfirmedMSS,
        market_structure_shift_direction: hasConfirmedMSS ? latestMSS.trendAfter : null,
        // Subordinate inner waves mapped for zero dashboard disruption
        subTrend: trend,
        innerSwings: swings,
        innerZigzag: zigzag,
        internalTrend,
        internalZigzag: zigzag,
        latestInternalMSS: latestMSS,
        internal_market_structure_shift: hasConfirmedMSS,
        internalDealingRange: dealingRange
    };
}
// Stateful Caching Layer for real-time memory synchronization
const accumulatedCandlesCache = new Map();
const contextAnchorCache = new Map();
function analyzeMarketStructureStateful(symbol, interval, newCandles, currentPrice, displacementStatus, isInit = false, globalAnchors, config) {
    const cacheKey = `${symbol}_${interval}`;
    let accumulated = accumulatedCandlesCache.get(cacheKey) || [];
    if (isInit || accumulated.length === 0) {
        accumulated = [...newCandles].sort((a, b) => a.t - b.t);
    }
    else {
        const existingIds = new Set(accumulated.map(c => c.t));
        const uniqueNew = newCandles.filter(c => !existingIds.has(c.t));
        accumulated = [...accumulated, ...uniqueNew].sort((a, b) => a.t - b.t);
    }
    // 10,000 candles ceiling to optimize visual canvas performance
    if (accumulated.length > 10000) {
        accumulated = accumulated.slice(-10000);
    }
    accumulatedCandlesCache.set(cacheKey, accumulated);
    let anchor = contextAnchorCache.get(cacheKey) || null;
    if (anchor === null && accumulated.length > 0) {
        anchor = accumulated[0].t;
        contextAnchorCache.set(cacheKey, anchor);
    }
    return analyzeMarketStructure(accumulated, currentPrice, displacementStatus, anchor, globalAnchors, config);
}

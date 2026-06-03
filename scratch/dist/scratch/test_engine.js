"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const structureEngine_1 = require("../src/lib/structureEngine");
const https_1 = __importDefault(require("https"));
async function fetchBinanceCandles(symbol, interval, limit) {
    return new Promise((resolve, reject) => {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        https_1.default.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const raw = JSON.parse(data);
                    if (!Array.isArray(raw)) {
                        reject(new Error('Invalid response from Binance'));
                        return;
                    }
                    const candles = raw.map((c) => {
                        const v = parseFloat(c[5]);
                        const taker_buy_vol = parseFloat(c[9]);
                        return {
                            t: c[0],
                            o: parseFloat(c[1]),
                            h: parseFloat(c[2]),
                            l: parseFloat(c[3]),
                            c: parseFloat(c[4]),
                            v: v,
                            taker_buy_vol,
                            taker_sell_vol: v - taker_buy_vol,
                            isClosed: true
                        };
                    });
                    resolve(candles);
                }
                catch (e) {
                    reject(e);
                }
            });
        }).on('error', (e) => reject(e));
    });
}
function buildZigZagSegments(swingsOnly, events, isDisplacement) {
    const segments = [];
    let trendState = 'UNSET';
    let latestMSSegment = null;
    for (let i = 0; i < swingsOnly.length - 1; i++) {
        const from = swingsOnly[i];
        const to = swingsOnly[i + 1];
        const trendBefore = trendState;
        let label = 'INTERNAL';
        let trendAfter = trendState;
        // Find if there is an event at the ending coordinate
        const ev = events.find(e => e.index === to.candle_index && (e.type === 'BOS' || e.type === 'MSS' || e.type === 'CHoCH'));
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
        else {
            // Fallback: directional check if no formal event exists
            if (to.type === 'HIGH') {
                const priorHighs = swingsOnly.slice(0, i + 1).filter(s => s.type === 'HIGH');
                const priorHigh = priorHighs[priorHighs.length - 1];
                if (priorHigh && to.price > priorHigh.price) {
                    if (trendState === 'BULLISH') {
                        label = 'BOS';
                        trendAfter = 'BULLISH';
                    }
                    else if (trendState === 'BEARISH') {
                        label = 'MSS';
                        trendAfter = 'BULLISH';
                    }
                    else {
                        trendAfter = 'BULLISH';
                    }
                }
                else if (trendState === 'UNSET') {
                    trendAfter = 'BULLISH';
                }
            }
            else {
                const priorLows = swingsOnly.slice(0, i + 1).filter(s => s.type === 'LOW');
                const priorLow = priorLows[priorLows.length - 1];
                if (priorLow && to.price < priorLow.price) {
                    if (trendState === 'BEARISH') {
                        label = 'BOS';
                        trendAfter = 'BEARISH';
                    }
                    else if (trendState === 'BULLISH') {
                        label = 'MSS';
                        trendAfter = 'BEARISH';
                    }
                    else {
                        trendAfter = 'BEARISH';
                    }
                }
                else if (trendState === 'UNSET') {
                    trendAfter = 'BEARISH';
                }
            }
        }
        trendState = trendAfter;
        const segment = {
            from,
            to,
            label,
            trendBefore,
            trendAfter,
            displacementConfirmed: label === 'MSS' && (ev ? !ev.sharp_departure_failed : isDisplacement)
        };
        segments.push(segment);
        if (label === 'MSS') {
            latestMSSegment = segment;
        }
    }
    return { segments, trend: trendState, latestMSS: latestMSSegment };
}
function buildDealingRange(swingsOnly, currentPrice, normalizedCandles) {
    const highs = swingsOnly.filter(s => s.type === 'HIGH');
    const lows = swingsOnly.filter(s => s.type === 'LOW');
    if (highs.length > 0 && lows.length > 0) {
        const lastHigh = highs[highs.length - 1];
        const lastLow = lows[lows.length - 1];
        const highVal = parseFloat(lastHigh.price.toFixed(2));
        const lowVal = parseFloat(lastLow.price.toFixed(2));
        const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
        return {
            high: highVal,
            low: lowVal,
            equilibrium: eqVal,
            current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
            anchor_high_swing: lastHigh,
            anchor_low_swing: lastLow
        };
    }
    else {
        // Fallback
        const highVal = normalizedCandles.length > 0 ? Math.max(...normalizedCandles.map(c => c.high)) : 0;
        const lowVal = normalizedCandles.length > 0 ? Math.min(...normalizedCandles.map(c => c.low)) : 0;
        const eqVal = parseFloat(((highVal + lowVal) / 2).toFixed(2));
        return {
            high: highVal,
            low: lowVal,
            equilibrium: eqVal,
            current_status: currentPrice > eqVal ? 'PREMIUM' : 'DISCOUNT',
            anchor_high_swing: null,
            anchor_low_swing: null
        };
    }
}
async function runTest() {
    try {
        const candles = await fetchBinanceCandles('ETHUSDT', '5m', 1000);
        console.log(`Fetched ${candles.length} candles.`);
        // Normalize candles to have full names as expected by the engine
        const normalizedCandles = candles.map(c => ({
            ...c,
            open: c.open !== undefined ? c.open : c.o,
            high: c.high !== undefined ? c.high : c.h,
            low: c.low !== undefined ? c.low : c.l,
            close: c.close !== undefined ? c.close : c.c,
            volume: c.volume !== undefined ? c.volume : c.v
        }));
        // 1. Process primary Major Engine
        console.log('Running primary Major Structure Engine...');
        const majorEngine = new structureEngine_1.MarketStructureEngine();
        for (const c of normalizedCandles) {
            majorEngine.process_candle(c);
        }
        // 2. Process secondary Inner Engine (3-bar lookback Nt = 1)
        console.log('Running secondary Inner Structure Engine (3-bar)...');
        const innerEngine = new structureEngine_1.MarketStructureEngine({
            adaptiveNMin: 1,
            adaptiveNMax: 2
        });
        for (const c of normalizedCandles) {
            innerEngine.process_candle(c);
        }
        const currentPrice = normalizedCandles[normalizedCandles.length - 1].close;
        // Map major engine pivots to StructuralSwing interface
        const rawSwings = majorEngine.confirmed_pivots.map(pt => ({
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
        // Alternating Swings Core Filter (Fixed High/Low selections)
        const confirmedSwings = rawSwings.filter(s => s.confirmed);
        const alternatingSwings = [];
        for (const s of confirmedSwings) {
            if (alternatingSwings.length === 0) {
                alternatingSwings.push(s);
                continue;
            }
            const last = alternatingSwings[alternatingSwings.length - 1];
            if (last.type === s.type) {
                if (s.type === 'HIGH') {
                    if (s.price > last.price)
                        alternatingSwings[alternatingSwings.length - 1] = s;
                }
                else {
                    if (s.price < last.price)
                        alternatingSwings[alternatingSwings.length - 1] = s;
                }
            }
            else {
                alternatingSwings.push(s);
            }
        }
        console.log(`Confirmed Major alternating swings count: ${alternatingSwings.length}`);
        // Parent-Child Wave Containment Tagging
        let currentMajorHigh = -Infinity;
        let currentMajorLow = Infinity;
        const markedConfirmedSwings = alternatingSwings.map((s) => {
            let structure_type = 'MAJOR';
            if (currentMajorHigh === -Infinity || currentMajorLow === Infinity) {
                if (s.type === 'HIGH') {
                    currentMajorHigh = s.price;
                }
                else {
                    currentMajorLow = s.price;
                }
                return { ...s, structure_type };
            }
            if (s.price >= currentMajorLow && s.price <= currentMajorHigh) {
                structure_type = 'INTERNAL';
            }
            else {
                structure_type = 'MAJOR';
                if (s.type === 'HIGH' && s.price > currentMajorHigh) {
                    currentMajorHigh = s.price;
                }
                else if (s.type === 'LOW' && s.price < currentMajorLow) {
                    currentMajorLow = s.price;
                }
            }
            return { ...s, structure_type };
        });
        const majorSwings = markedConfirmedSwings.filter(s => s.structure_type === 'MAJOR');
        const internalSwings = markedConfirmedSwings.filter(s => s.structure_type === 'INTERNAL');
        console.log(`Classified Swings: MAJOR count: ${majorSwings.length} | INTERNAL count: ${internalSwings.length}`);
        // Build Zig-Zag and Dealing Ranges
        const majorResult = buildZigZagSegments(majorSwings, majorEngine.registered_events, majorEngine.current_trend_state === 'BULLISH_SWING');
        const internalResult = buildZigZagSegments(internalSwings, majorEngine.registered_events, majorEngine.current_trend_state === 'BULLISH_SWING');
        const dealingRange = buildDealingRange(majorSwings, currentPrice, normalizedCandles);
        const internalDealingRange = buildDealingRange(internalSwings, currentPrice, normalizedCandles);
        // Inner Swings (3-bar visual zigzag lines)
        const rawInnerSwings = innerEngine.confirmed_pivots.map(pt => ({
            t: pt.timestamp,
            price: pt.price,
            type: pt.type === 'SWING_HIGH' ? 'HIGH' : 'LOW',
            grade: 'INNER',
            colorValidated: true,
            candle_index: pt.index,
            timestamp: new Date(pt.timestamp).toISOString(),
            structure_type: 'INNER',
            confirmed: pt.confirmed
        }));
        const confirmedInnerSwings = rawInnerSwings.filter(s => s.confirmed);
        const alternatingInnerSwings = [];
        for (const s of confirmedInnerSwings) {
            if (alternatingInnerSwings.length === 0) {
                alternatingInnerSwings.push(s);
                continue;
            }
            const last = alternatingInnerSwings[alternatingInnerSwings.length - 1];
            if (last.type === s.type) {
                if (s.type === 'HIGH') {
                    if (s.price > last.price)
                        alternatingInnerSwings[alternatingInnerSwings.length - 1] = s;
                }
                else {
                    if (s.price < last.price)
                        alternatingInnerSwings[alternatingInnerSwings.length - 1] = s;
                }
            }
            else {
                alternatingInnerSwings.push(s);
            }
        }
        const innerZigzagResult = buildZigZagSegments(alternatingInnerSwings, innerEngine.registered_events, innerEngine.current_trend_state === 'BULLISH_SWING');
        console.log('\n--- Dual-Engine FSM Execution Output ---');
        console.log('MACRO TREND:', majorResult.trend);
        console.log('MACRO DEALING RANGE:', dealingRange.high, '-', dealingRange.low, `(Eq: ${dealingRange.equilibrium})`);
        console.log('MACRO BOS/MSS events count:', majorResult.segments.filter(s => s.label === 'BOS' || s.label === 'MSS').length);
        console.log('\nINTRADAY TREND:', internalResult.trend);
        console.log('INTRADAY DEALING RANGE:', internalDealingRange.high, '-', internalDealingRange.low, `(Eq: ${internalDealingRange.equilibrium})`);
        console.log('INTRADAY BOS/MSS (IMSS/IBOS) events count:', internalResult.segments.filter(s => s.label === 'BOS' || s.label === 'MSS').length);
        console.log('\nSUB TREND:', innerZigzagResult.trend);
        console.log('INNER Zig-Zag alternating swings count:', alternatingInnerSwings.length);
        console.log('INNER Zig-Zag segments count:', innerZigzagResult.segments.length);
    }
    catch (err) {
        console.error(err);
    }
}
runTest();

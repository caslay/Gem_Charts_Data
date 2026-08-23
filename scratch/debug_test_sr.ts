import { SweepReclaimEngine } from '../src/lib/quantEngine/SweepReclaimEngine';
import { Candle } from '../src/lib/fvgEngine';

function generateMultiDayTestCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.parse("2026-05-01T00:00:00.000Z");
  const intervalMs = 900000;
  let p = 3000.0;

  for (let i = 0; i < 192; i++) {
    const t = baseTime + i * intervalMs;
    const date = new Date(t);
    const hour = date.getUTCHours();
    const day = date.getUTCDate();

    let o = p;
    let c = p;
    let h = p;
    let l = p;
    let v = 1000;
    let taker_buy_vol = 500;

    if (day === 1) {
      if (hour >= 0 && hour < 7) {
        if (i === 12) {
          o = 2985; c = 2982; h = 2987; l = 2980; v = 1500; taker_buy_vol = 700;
        } else {
          c = 2990 + Math.sin(i) * 5; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
        }
      } else if (hour >= 7 && hour < 12) {
        if (i === 36) {
          o = 3020; c = 3028; h = 3030; l = 3018; v = 2000; taker_buy_vol = 1200;
        } else {
          c = 3010 + Math.sin(i) * 6; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
        }
      } else {
        c = 3005 + Math.sin(i) * 4; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
      }
    } else {
      const day2Index = i - 96;
      if (day2Index === 10) {
        o = 2982; c = 2978; h = 2985; l = 2970; v = 3000; taker_buy_vol = 1200;
      } else if (day2Index === 11) {
        o = 2978; c = 2980; h = 2982; l = 2976; v = 1500; taker_buy_vol = 800;
      } else if (day2Index === 12) {
        o = 2978; c = 2992; h = 2994; l = 2976; v = 4000; taker_buy_vol = 2800;
      } else if (day2Index === 13) {
        o = 2992; c = 2998; h = 3000; l = 2988; v = 2500; taker_buy_vol = 1600;
      } else if (day2Index === 14) {
        o = 2996; c = 2988; h = 2997; l = 2984; v = 1200; taker_buy_vol = 650;
      } else if (day2Index === 15) {
        o = 2988; c = 3003; h = 3005; l = 2987; v = 2000; taker_buy_vol = 1400;
      } else if (day2Index === 16) {
        o = 3003; c = 3012; h = 3015; l = 3004; v = 2200; taker_buy_vol = 1500;
      } else if (day2Index === 17) {
        o = 3012; c = 3038; h = 3040; l = 3010; v = 3500; taker_buy_vol = 2400;
      } else {
        c = 3020 + Math.sin(i) * 5; h = Math.max(o, c) + 2; l = Math.min(o, c) - 2;
      }
    }

    p = c;
    candles.push({
      t,
      o: parseFloat(o.toFixed(2)),
      h: parseFloat(h.toFixed(2)),
      l: parseFloat(l.toFixed(2)),
      c: parseFloat(c.toFixed(2)),
      v,
      taker_buy_vol,
      taker_sell_vol: parseFloat((v - taker_buy_vol).toFixed(2)),
      isClosed: true,
    });
  }
  return candles;
}

const candles = generateMultiDayTestCandles();
const engine = new SweepReclaimEngine({
  volumeExpansionThreshold: 1.50,
  deltaDominanceThreshold: 60.0,
  bodyRatioThreshold: 0.60,
  requireThreePillarDisplacement: true,
  stage1Multiple: 1.0,
  stage2Multiple: 1.5,
  stage3Multiple: 3.0,
  entryMode: 'FVG_CE',
});

const { setups, telemetry } = engine.scanHistoricalSetups(candles);
console.log("Telemetry:", telemetry);
console.log("All setups count:", setups.length);
for (const s of setups) {
  console.log(`- ID: ${s.id} | Type: ${s.anchor_type} @ ${s.anchor_level} | Status: ${s.status} | Phase: ${s.phase} | RetestIdx: ${s.retest_index} | Outcome: ${s.simulated_outcome} | RealizedRR: ${s.realized_rr}`);
}

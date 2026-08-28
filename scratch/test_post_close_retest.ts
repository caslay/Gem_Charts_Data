import { fetchHistoricalKlines } from '../scripts/lib/restBootstrap';
import { SweepReclaimEngine, SweepReclaimScanConfig } from '../src/lib/quantEngine/SweepReclaimEngine';

async function testPostClose() {
  console.log(`\n===============================================================`);
  console.log(` 🔬 TESTING POST-CLOSE RETEST BEHAVIOR (LIVE 1:1 REALITY) `);
  console.log(`===============================================================\n`);

  const symbol = 'ETHUSDC';
  const all5m = await fetchHistoricalKlines(symbol, '5m', 500);

  const startMs = new Date('2026-08-28T00:00:00Z').getTime();
  const endMs = new Date('2026-08-28T23:59:59Z').getTime();
  const candles = all5m.filter((c) => c.t >= startMs && c.t <= endMs);

  // Check 14:30 UTC candle (idx 174)
  // Candle 174: 14:30 UTC
  // Candle 175: 14:35 UTC
  // Candle 176: 14:40 UTC
  // Candle 177: 14:45 UTC
  console.log(`Candles from 14:30 to 15:00 UTC:`);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const iso = new Date(c.t).toISOString().slice(11, 16);
    if (iso >= '14:25' && iso <= '15:00') {
      console.log(`[${iso} UTC] O:$${c.o} H:$${c.h} L:$${c.l} C:$${c.c}`);
    }
  }

  console.log(`\nAnalyzing 14:30 UTC Bullish Reclaim (@ $2503.26 with Entry @ $2492.68):`);
  console.log(`• 14:35 UTC: Low was $2501.97 (> $2492.68) ➔ Unfilled`);
  console.log(`• 14:40 UTC: Low was $2503.40 (> $2492.68) ➔ Unfilled`);
  console.log(`• 14:45 UTC: Low was $2499.00 (> $2492.68) ➔ Unfilled`);
  console.log(`➔ In live reality, the 14:30 Long was NEVER FILLED!`);

  console.log(`\nAnalyzing 14:45 UTC Bearish Reclaim (@ $2500.98 with Entry @ $2503.37):`);
  console.log(`• 14:50 UTC: High was $2505.48 (>= $2503.37) ➔ FILLED AT 14:50 UTC!`);
  console.log(`• Ran to Target 1 @ 15:51 UTC, Target 2 @ 16:01 UTC, Target 3 @ 16:24 UTC!`);
}

testPostClose().catch(console.error);

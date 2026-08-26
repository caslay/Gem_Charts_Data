/**
 * scripts/inspect_2135_candle.ts
 */
import { Candle } from '../src/lib/fvgEngine';

async function main() {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=5m&limit=20`;
  const res = await fetch(url);
  const data = (await res.json()) as any[];

  console.log('Recent 5m candles from Binance (UTC and Cairo):');
  for (const k of data) {
    const t = Number(k[0]);
    const cairoTime = new Date(t + 3 * 3600 * 1000).toISOString().replace('T', ' ').substring(11, 19);
    const utcTime = new Date(t).toISOString().replace('T', ' ').substring(11, 19);
    console.log(`[${utcTime} UTC / ${cairoTime} Cairo] O: ${k[1]} | H: ${k[2]} | L: ${k[3]} | C: ${k[4]} | V: ${k[5]} | TakerBuy: ${k[9]}`);
  }
}

main().catch(console.error);

import { LiveOrderBlockExecutionEngine } from '../src/lib/quantEngine/LiveOrderBlockExecutionEngine';
import { Candle } from '../src/lib/fvgEngine';

async function testMtfExecution() {
  console.log('=== Testing Multi-Timeframe (MTF) Live Execution Engine ===\n');

  // Fetch real candles from Binance API for 5m, 15m, 1h
  const fetchTf = async (tf: string) => {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDC&interval=${tf}&limit=200`);
    const raw = await res.json();
    return raw.map((c: any) => ({
      t: c[0],
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: parseFloat(c[5]),
      taker_buy_vol: parseFloat(c[9]),
      taker_sell_vol: parseFloat(c[5]) - parseFloat(c[9]),
      isClosed: true
    }));
  };

  const [c5m, c15m, c1h] = await Promise.all([
    fetchTf('5m'),
    fetchTf('15m'),
    fetchTf('1h')
  ]);

  console.log(`[DATA INGESTION] Loaded ${c5m.length} 5m bars, ${c15m.length} 15m bars, ${c1h.length} 1h bars.`);

  const engine = new LiveOrderBlockExecutionEngine({
    autoExecute: true,
    maxOpenPositions: 1,
    enforceHtfAlignment: true
  });

  // Track events emitted
  const emittedEvents: string[] = [];
  engine.subscribe((ev) => {
    emittedEvents.push(`[EVENT: ${ev.type}] ${ev.message}`);
    console.log(`  -> ${ev.message}`);
  });

  // Ingest multi-timeframe candles with Bearish Macro Context
  console.log('\n[TEST 1] Ingesting MTF Candles with Macro Bias = BEARISH...');
  engine.onMultiTimeframeCandles(
    {
      '5m': c5m,
      '15m': c15m,
      '1h': c1h
    },
    {
      macroDailyBias: 'BEARISH',
      dolDirection: 'BEARISH',
      bslMagnets: [3400, 3450],
      sslMagnets: [3200, 3150]
    }
  );

  const zonesByTf = engine.getActiveZonesByTimeframe();
  const allZones = engine.getActiveZones();

  console.log(`\n[ZONE REGISTRY] Multi-Timeframe Active Zone Pool:`);
  console.log(`  - 5m Zones: ${zonesByTf['5m']?.length || 0}`);
  console.log(`  - 15m Zones: ${zonesByTf['15m']?.length || 0}`);
  console.log(`  - 1h Zones: ${zonesByTf['1h']?.length || 0}`);
  console.log(`  - Total Unified Zones: ${allZones.length}`);

  // Inspect HTF Alignment tagging on 5m zones
  const m5Zones = zonesByTf['5m'] || [];
  const vetoed5m = m5Zones.filter(z => z.htf_alignment_status === 'VETOED_COUNTER_HTF');
  const aligned5m = m5Zones.filter(z => z.htf_alignment_status === 'HTF_ALIGNED');

  console.log(`\n[HTF ALIGNMENT AUDIT on 5m Zones]:`);
  console.log(`  - 5m HTF Aligned Count: ${aligned5m.length}`);
  console.log(`  - 5m Vetoed Counter-Trend Count: ${vetoed5m.length}`);
  if (vetoed5m.length > 0) {
    console.log(`  - Sample Veto Reason: "${vetoed5m[0].htf_veto_reason}"`);
  }

  // Inspect 1h zones
  const m1hZones = zonesByTf['1h'] || [];
  console.log(`\n[1H MACRO ANCHORS]:`);
  m1hZones.slice(0, 3).forEach(z => {
    console.log(`  - 1h ${z.quality_tier} ${z.type} OB [${z.structural_weight}] @ MT $${z.mean_threshold.toFixed(2)} (${z.htf_alignment_status})`);
  });

  // Test live tick execution on an aligned zone
  const candidateZone = allZones.find(z => z.htf_alignment_status !== 'VETOED_COUNTER_HTF');
  if (candidateZone) {
    console.log(`\n[TEST 2] Testing Live Tick Entry Trigger on ${candidateZone.timeframe.toUpperCase()} ${candidateZone.type} OB...`);
    const triggerPrice = candidateZone.mean_threshold;
    console.log(`  Sending price tick @ $${triggerPrice}...`);
    
    // Send in-zone touch tick
    engine.onPriceTick(triggerPrice, Date.now());
    
    const testStates = engine.getInZoneTestingStates();
    console.log(`  In-Zone Testing States Active: ${testStates.length}`);
  }

  console.log('\n=== MTF Test Run Completed Successfully ===');
}

testMtfExecution().catch(console.error);

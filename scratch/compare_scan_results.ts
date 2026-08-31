import * as fs from 'fs';
import * as path from 'path';

function analyzeComparison() {
  const oldPath = path.join(process.cwd(), 'scratch', 'Old_version_SWEEP_RECLAIM_ETHUSDC_5m_7ea78a23.json');
  const newPath = path.join(process.cwd(), 'scratch', 'Premium-descount-fix-SWEEP_RECLAIM_ETHUSDC_5m_2f34fa77.json');

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  console.log('--- OLD VERSION TOP-LEVEL METRICS ---');
  console.log({
    total_scanned: oldData.total_scanned ?? oldData.setups?.length,
    telemetry: oldData.telemetry,
    trades_count: oldData.trades?.length ?? oldData.retested_setups?.length,
  });

  console.log('\n--- NEW VERSION TOP-LEVEL METRICS ---');
  console.log({
    total_scanned: newData.total_scanned ?? newData.setups?.length,
    telemetry: newData.telemetry,
    trades_count: newData.trades?.length ?? newData.retested_setups?.length,
  });

  // Extract setups
  const oldSetups: any[] = oldData.setups || oldData.detected_setups || [];
  const newSetups: any[] = newData.setups || newData.detected_setups || [];

  // Filter executed/retested trades
  const oldRetested = oldSetups.filter((s: any) => s.is_retested === true || s.simulated_outcome === 'FULL_TP_HIT' || s.simulated_outcome === 'STAGE_1_HIT' || s.simulated_outcome === 'STOPPED_OUT');
  const newRetested = newSetups.filter((s: any) => s.is_retested === true || s.simulated_outcome === 'FULL_TP_HIT' || s.simulated_outcome === 'STAGE_1_HIT' || s.simulated_outcome === 'STOPPED_OUT');

  console.log(`\nOld Setups Total: ${oldSetups.length}, Retested/Traded: ${oldRetested.length}`);
  console.log(`New Setups Total: ${newSetups.length}, Retested/Traded: ${newRetested.length}`);

  // Outcomes breakdown
  function getStats(setupsList: any[]) {
    let wins = 0;
    let losses = 0;
    let scratches = 0;
    let totalR = 0;
    let longWins = 0, longLosses = 0, longTotalR = 0;
    let shortWins = 0, shortLosses = 0, shortTotalR = 0;

    for (const s of setupsList) {
      const r = s.realized_rr || 0;
      totalR += r;
      const isLong = s.type === 'BULLISH';
      if (isLong) longTotalR += r;
      else shortTotalR += r;

      if (s.simulated_outcome === 'FULL_TP_HIT' || s.simulated_outcome === 'STAGE_1_HIT' || s.stage_exit_type === 'FULL_TP2_WIN' || s.stage_exit_type === 'STAGE_2_WIN' || s.stage_exit_type === 'STAGE_1_WIN' || r > 0) {
        wins++;
        if (isLong) longWins++; else shortWins++;
      } else if (s.simulated_outcome === 'STOPPED_OUT' || r < 0) {
        losses++;
        if (isLong) longLosses++; else shortLosses++;
      } else {
        scratches++;
      }
    }
    return {
      total: setupsList.length,
      wins,
      losses,
      scratches,
      winRate: setupsList.length > 0 ? ((wins / setupsList.length) * 100).toFixed(1) + '%' : '0%',
      totalR: totalR.toFixed(2),
      longs: { wins: longWins, losses: longLosses, totalR: longTotalR.toFixed(2) },
      shorts: { wins: shortWins, losses: shortLosses, totalR: shortTotalR.toFixed(2) }
    };
  }

  console.log('\n--- DETAILED OUTCOMES: OLD VERSION ---');
  console.log(getStats(oldRetested));

  console.log('\n--- DETAILED OUTCOMES: NEW VERSION ---');
  console.log(getStats(newRetested));

  // Map setups by ID to find exactly what changed
  const oldMap = new Map<string, any>();
  for (const s of oldSetups) oldMap.set(s.id, s);

  const newMap = new Map<string, any>();
  for (const s of newSetups) newMap.set(s.id, s);

  // 1. Setups that were traded in OLD but VETOED / NOT TRADED in NEW
  const eliminatedInNew: any[] = [];
  // 2. Setups that were traded in BOTH with different outcomes
  const changedOutcome: any[] = [];
  // 3. Setups that are traded in NEW but were not in OLD
  const addedInNew: any[] = [];

  for (const [id, oldS] of oldMap.entries()) {
    const wasOldTraded = oldS.is_retested === true || (oldS.realized_rr !== 0 && oldS.realized_rr !== undefined);
    const newS = newMap.get(id);

    if (wasOldTraded) {
      if (!newS || !newS.is_retested || newS.simulated_outcome === 'INVALIDATED' || newS.is_valuation_aligned === false) {
        eliminatedInNew.push({ old: oldS, new: newS });
      } else if (oldS.simulated_outcome !== newS.simulated_outcome || oldS.realized_rr !== newS.realized_rr) {
        changedOutcome.push({ old: oldS, new: newS });
      }
    }
  }

  for (const [id, newS] of newMap.entries()) {
    const wasNewTraded = newS.is_retested === true || (newS.realized_rr !== 0 && newS.realized_rr !== undefined);
    const oldS = oldMap.get(id);
    if (wasNewTraded && (!oldS || !oldS.is_retested)) {
      addedInNew.push(newS);
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 DELTA ANALYSIS:`);
  console.log(`- Eliminated / Filtered Out Trades: ${eliminatedInNew.length}`);
  console.log(`- Changed Outcome Trades: ${changedOutcome.length}`);
  console.log(`- Newly Added Trades: ${addedInNew.length}`);
  console.log(`======================================================`);

  console.log(`\n🔍 BREAKDOWN OF TRADES ELIMINATED / VETOED IN NEW VERSION:`);
  let eliminatedWins = 0;
  let eliminatedLosses = 0;
  let eliminatedR = 0;

  for (const item of eliminatedInNew) {
    const s = item.old;
    const r = s.realized_rr || 0;
    eliminatedR += r;
    if (r > 0) eliminatedWins++;
    else if (r < 0) eliminatedLosses++;

    console.log(`  ➔ [${s.type}] Anchor: ${s.anchor_name} ($${s.anchor_level}) | Time: ${new Date(s.anchor_time).toISOString()} | Old Outcome: ${s.simulated_outcome || s.stage_exit_type} (R: ${s.realized_rr}) | New Valuation: ${item.new?.is_valuation_aligned} (EQ: ${item.new?.dealing_range_equilibrium})`);
  }

  console.log(`\nTotal R of Eliminated Trades: ${eliminatedR.toFixed(2)}R (Wins avoided: ${eliminatedWins}, Losses avoided: ${eliminatedLosses})`);

  if (changedOutcome.length > 0) {
    console.log(`\n🔍 TRADES WITH CHANGED OUTCOMES:`);
    for (const item of changedOutcome) {
      console.log(`  ➔ [${item.old.type}] Anchor: ${item.old.anchor_name} ($${item.old.anchor_level}) | Old: ${item.old.simulated_outcome} (${item.old.realized_rr}R) -> New: ${item.new.simulated_outcome} (${item.new.realized_rr}R)`);
    }
  }

  if (addedInNew.length > 0) {
    console.log(`\n🔍 TRADES NEWLY ADDED IN NEW VERSION:`);
    for (const s of addedInNew) {
      console.log(`  ➔ [${s.type}] Anchor: ${s.anchor_name} ($${s.anchor_level}) | Outcome: ${s.simulated_outcome} (${s.realized_rr}R)`);
    }
  }
}

analyzeComparison();

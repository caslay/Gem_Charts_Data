import * as fs from 'fs';
import * as path from 'path';

function doubleDeepAudit() {
  const oldPath = path.join(process.cwd(), 'scratch', '1y-old-live-SWEEP_RECLAIM_ETHUSDC_5m_bc8fc99e.json');
  const newPath = path.join(process.cwd(), 'scratch', '1y-dev-new-SWEEP_RECLAIM_ETHUSDC_5m_f0f059ac.json');

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const oldSetups: any[] = oldData.setups || [];
  const newSetups: any[] = newData.setups || [];

  const newRetested = newSetups.filter((s: any) => s.is_retested === true);

  console.log(`===============================================================`);
  console.log(` 🔬 DOUBLE AUDIT: DEEP QUANT EDGE-CASE INVESTIGATION`);
  console.log(`===============================================================\n`);

  // 1. Time-of-Day / Session Distribution Audit
  const sessionStats = {
    ASIAN: { trades: 0, wins: 0, losses: 0, totalR: 0 },
    LONDON: { trades: 0, wins: 0, losses: 0, totalR: 0 },
    NY: { trades: 0, wins: 0, losses: 0, totalR: 0 },
    DEAD_ZONE: { trades: 0, wins: 0, losses: 0, totalR: 0 }
  };

  for (const s of newRetested) {
    const hour = new Date(s.anchor_time).getUTCHours();
    const r = s.realized_rr || 0;
    let sessKey: 'ASIAN' | 'LONDON' | 'NY' | 'DEAD_ZONE' = 'DEAD_ZONE';
    if (hour >= 0 && hour < 7) sessKey = 'ASIAN';
    else if (hour >= 7 && hour < 13) sessKey = 'LONDON';
    else if (hour >= 13 && hour < 21) sessKey = 'NY';

    const obj = sessionStats[sessKey];
    obj.trades++;
    obj.totalR += r;
    if (r > 0) obj.wins++;
    else if (r < 0) obj.losses++;
  }

  console.log('▶ 1. SESSION-OF-DAY PERFORMANCE BREAKDOWN:');
  for (const [sess, obj] of Object.entries(sessionStats)) {
    const winRate = ((obj.wins / obj.trades) * 100).toFixed(1);
    console.log(`  ${sess.padEnd(10)}: ${obj.trades} trades (${obj.wins}W / ${obj.losses}L, Win Rate: ${winRate}%, Realized R: ${obj.totalR.toFixed(1)}R, Avg R: ${(obj.totalR / obj.trades).toFixed(2)}R)`);
  }

  // 2. Bars to Retest Duration Distribution
  console.log('\n▶ 2. BARS TO RETEST DELAY VS WIN RATE:');
  const retestBarsDist = {
    'Immediate (1-2 bars)': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    'Fast (3-5 bars)': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    'Medium (6-10 bars)': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    'Late (11-20 bars)': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    'Stale (>20 bars)': { trades: 0, wins: 0, losses: 0, totalR: 0 }
  };

  for (const s of newRetested) {
    const bars = s.bars_to_retest ?? (s.retest_index && s.reclaim_index ? s.retest_index - s.reclaim_index : 1);
    const r = s.realized_rr || 0;
    let bKey: keyof typeof retestBarsDist = 'Immediate (1-2 bars)';
    if (bars <= 2) bKey = 'Immediate (1-2 bars)';
    else if (bars <= 5) bKey = 'Fast (3-5 bars)';
    else if (bars <= 10) bKey = 'Medium (6-10 bars)';
    else if (bars <= 20) bKey = 'Late (11-20 bars)';
    else bKey = 'Stale (>20 bars)';

    const obj = retestBarsDist[bKey];
    obj.trades++;
    obj.totalR += r;
    if (r > 0) obj.wins++;
    else if (r < 0) obj.losses++;
  }

  for (const [dist, obj] of Object.entries(retestBarsDist)) {
    const winRate = obj.trades > 0 ? ((obj.wins / obj.trades) * 100).toFixed(1) : '0';
    console.log(`  ${dist.padEnd(23)}: ${obj.trades.toString().padEnd(4)} trades (${obj.wins}W / ${obj.losses}L, Win Rate: ${winRate}%, Realized R: ${obj.totalR.toFixed(1)}R)`);
  }

  // 3. Harvest Type Distribution (Full TP2 vs Breakeven Scratch vs Stopped Out)
  console.log('\n▶ 3. HARVEST & STAGE EXIT MECHANICS BREAKDOWN:');
  const stageExits = new Map<string, { count: number; totalR: number }>();
  for (const s of newRetested) {
    const exitType = s.stage_exit_type || s.simulated_outcome || 'UNKNOWN';
    if (!stageExits.has(exitType)) stageExits.set(exitType, { count: 0, totalR: 0 });
    const obj = stageExits.get(exitType)!;
    obj.count++;
    obj.totalR += (s.realized_rr || 0);
  }

  for (const [exitType, obj] of stageExits.entries()) {
    console.log(`  ${exitType.padEnd(20)}: ${obj.count.toString().padEnd(4)} trades (${((obj.count / newRetested.length) * 100).toFixed(1)}%) | Realized R: ${obj.totalR.toFixed(1)}R`);
  }

  // 4. Consecutive Loss Clustering & Drawdown Sequence
  console.log('\n▶ 4. DRAWDOWN STREAKS & CONSECUTIVE LOSS CLUSTERING:');
  let maxConsecLosses = 0;
  let currConsecLosses = 0;
  let maxConsecWins = 0;
  let currConsecWins = 0;

  for (const s of newRetested) {
    const r = s.realized_rr || 0;
    if (r < 0) {
      currConsecLosses++;
      if (currConsecLosses > maxConsecLosses) maxConsecLosses = currConsecLosses;
      currConsecWins = 0;
    } else if (r > 0) {
      currConsecWins++;
      if (currConsecWins > maxConsecWins) maxConsecWins = currConsecWins;
      currConsecLosses = 0;
    }
  }
  console.log(`  Max Consecutive Wins:   ${maxConsecWins}`);
  console.log(`  Max Consecutive Losses: ${maxConsecLosses}`);

  // 5. Macro Displacement Depth vs Retest Success
  console.log('\n▶ 5. THREE-PILLAR DISPLACEMENT STRENGTH CORRELATION:');
  const volMultipliers = {
    '1.35x - 1.50x': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    '1.50x - 2.00x': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    '2.00x - 3.00x': { trades: 0, wins: 0, losses: 0, totalR: 0 },
    '> 3.00x Ultra': { trades: 0, wins: 0, losses: 0, totalR: 0 }
  };

  for (const s of newRetested) {
    const volRatio = s.displacement_vol_ratio ?? 1.35;
    const r = s.realized_rr || 0;
    let vKey: keyof typeof volMultipliers = '1.35x - 1.50x';
    if (volRatio >= 3.0) vKey = '> 3.00x Ultra';
    else if (volRatio >= 2.0) vKey = '2.00x - 3.00x';
    else if (volRatio >= 1.5) vKey = '1.50x - 2.00x';

    const obj = volMultipliers[vKey];
    obj.trades++;
    obj.totalR += r;
    if (r > 0) obj.wins++;
    else if (r < 0) obj.losses++;
  }

  for (const [vKey, obj] of Object.entries(volMultipliers)) {
    const winRate = obj.trades > 0 ? ((obj.wins / obj.trades) * 100).toFixed(1) : '0';
    console.log(`  ${vKey.padEnd(16)}: ${obj.trades.toString().padEnd(4)} trades (${obj.wins}W / ${obj.losses}L, Win Rate: ${winRate}%, Realized R: ${obj.totalR.toFixed(1)}R)`);
  }
}

doubleDeepAudit();

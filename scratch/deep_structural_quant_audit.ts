import * as fs from 'fs';
import * as path from 'path';

function deepStructuralAndQuantAudit() {
  const oldPath = path.join(process.cwd(), 'scratch', '1y-old-live-SWEEP_RECLAIM_ETHUSDC_5m_bc8fc99e.json');
  const newPath = path.join(process.cwd(), 'scratch', '1y-dev-new-SWEEP_RECLAIM_ETHUSDC_5m_f0f059ac.json');

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const oldSetups: any[] = oldData.setups || [];
  const newSetups: any[] = newData.setups || [];

  const oldMap = new Map<string, any>();
  for (const s of oldSetups) oldMap.set(s.id, s);

  const newMap = new Map<string, any>();
  for (const s of newSetups) newMap.set(s.id, s);

  console.log(`\n===============================================================`);
  console.log(` 🔬 SECTION 1: MATHEMATICAL EQUILIBRIUM FORMULA DISSECTION`);
  console.log(`===============================================================`);

  // Calculate EQ differences between old and new across all setups
  let eqDiffSum = 0;
  let eqDiffCount = 0;
  let oldEqHigher = 0;
  let newEqHigher = 0;
  let sameEq = 0;

  const diffDistribution = {
    '< $2': 0,
    '$2 - $5': 0,
    '$5 - $15': 0,
    '$15 - $50': 0,
    '> $50': 0
  };

  for (const s of oldSetups) {
    const n = newMap.get(s.id);
    if (n && s.dealing_range_equilibrium && n.dealing_range_equilibrium) {
      const oldEq = s.dealing_range_equilibrium;
      const newEq = n.dealing_range_equilibrium;
      const diff = Math.abs(newEq - oldEq);
      eqDiffSum += diff;
      eqDiffCount++;

      if (newEq > oldEq + 0.01) newEqHigher++;
      else if (oldEq > newEq + 0.01) oldEqHigher++;
      else sameEq++;

      if (diff < 2) diffDistribution['< $2']++;
      else if (diff < 5) diffDistribution['$2 - $5']++;
      else if (diff < 15) diffDistribution['$5 - $15']++;
      else if (diff < 50) diffDistribution['$15 - $50']++;
      else diffDistribution['> $50']++;
    }
  }

  console.log(`Total Compared Setups with EQ: ${eqDiffCount}`);
  console.log(`Average Absolute EQ Difference: $${(eqDiffSum / eqDiffCount).toFixed(2)}`);
  console.log(`Setups where New EQ > Old EQ: ${newEqHigher} (${((newEqHigher/eqDiffCount)*100).toFixed(1)}%)`);
  console.log(`Setups where Old EQ > New EQ: ${oldEqHigher} (${((oldEqHigher/eqDiffCount)*100).toFixed(1)}%)`);
  console.log(`Setups with Identical EQ: ${sameEq} (${((sameEq/eqDiffCount)*100).toFixed(1)}%)`);
  console.log(`\nEQ Shift Magnitude Distribution:`, diffDistribution);

  console.log(`\n===============================================================`);
  console.log(` 🔬 SECTION 2: SWING GRADE & STRUCTURE DISSECTION`);
  console.log(`===============================================================`);

  // Analyze performance delta by Swing Grade (MAJOR vs INTERNAL vs INNER vs SESSION)
  const gradeMap = new Map<string, {
    oldTrades: number; oldWins: number; oldLosses: number; oldR: number;
    newTrades: number; newWins: number; newLosses: number; newR: number;
  }>();

  function getGrade(s: any): string {
    const name = s.anchor_name || '';
    if (name.includes('MAJOR')) return 'MAJOR_SWING';
    if (name.includes('INTERNAL')) return 'INTERNAL_SWING';
    if (name.includes('INNER')) return 'INNER_SWING';
    if (name.includes('Asian')) return 'ASIAN_SESSION';
    if (name.includes('London')) return 'LONDON_SESSION';
    if (name.includes('Previous Day')) return 'PDH_PDL_DAILY';
    return 'OTHER';
  }

  for (const s of oldSetups.filter((x: any) => x.is_retested)) {
    const grade = getGrade(s);
    if (!gradeMap.has(grade)) gradeMap.set(grade, { oldTrades: 0, oldWins: 0, oldLosses: 0, oldR: 0, newTrades: 0, newWins: 0, newLosses: 0, newR: 0 });
    const g = gradeMap.get(grade)!;
    g.oldTrades++;
    const r = s.realized_rr || 0;
    g.oldR += r;
    if (r > 0) g.oldWins++; else if (r < 0) g.oldLosses++;
  }

  for (const s of newSetups.filter((x: any) => x.is_retested)) {
    const grade = getGrade(s);
    if (!gradeMap.has(grade)) gradeMap.set(grade, { oldTrades: 0, oldWins: 0, oldLosses: 0, oldR: 0, newTrades: 0, newWins: 0, newLosses: 0, newR: 0 });
    const g = gradeMap.get(grade)!;
    g.newTrades++;
    const r = s.realized_rr || 0;
    g.newR += r;
    if (r > 0) g.newWins++; else if (r < 0) g.newLosses++;
  }

  console.log('Grade Category     | Old Trades (W/L) | Old R   | New Trades (W/L) | New R   | R Delta');
  console.log('-------------------+------------------+---------+------------------+---------+---------');
  for (const [grade, g] of gradeMap.entries()) {
    const oldWl = `${g.oldWins}/${g.oldLosses}`.padEnd(7);
    const newWl = `${g.newWins}/${g.newLosses}`.padEnd(7);
    const deltaR = (g.newR - g.oldR).toFixed(1);
    const deltaRStr = `${deltaR > 0 ? '+' : ''}${deltaR}R`;
    console.log(`${grade.padEnd(18)} | ${g.oldTrades.toString().padEnd(3)} (${oldWl}) | ${g.oldR.toFixed(1).padStart(5)}R | ${g.newTrades.toString().padEnd(3)} (${newWl}) | ${g.newR.toFixed(1).padStart(5)}R | ${deltaRStr}`);
  }

  console.log(`\n===============================================================`);
  console.log(` 🔬 SECTION 3: BULLISH VS BEARISH STRUCTURAL ASYMMETRY`);
  console.log(`===============================================================`);

  const bullOld = oldSetups.filter((s: any) => s.is_retested && s.type === 'BULLISH');
  const bullNew = newSetups.filter((s: any) => s.is_retested && s.type === 'BULLISH');
  const bearOld = oldSetups.filter((s: any) => s.is_retested && s.type === 'BEARISH');
  const bearNew = newSetups.filter((s: any) => s.is_retested && s.type === 'BEARISH');

  console.log(`BULLISH TRADES:`);
  console.log(`  Old: ${bullOld.length} trades | Win Rate: ${oldData.telemetry.bullish_win_rate_pct}% | Total R: ${bullOld.reduce((a, s) => a + s.realized_rr, 0).toFixed(2)}R | Avg R: ${oldData.telemetry.bullish_avg_rr}R`);
  console.log(`  New: ${bullNew.length} trades | Win Rate: ${newData.telemetry.bullish_win_rate_pct}% | Total R: ${bullNew.reduce((a, s) => a + s.realized_rr, 0).toFixed(2)}R | Avg R: ${newData.telemetry.bullish_avg_rr}R`);

  console.log(`\nBEARISH TRADES:`);
  console.log(`  Old: ${bearOld.length} trades | Win Rate: ${oldData.telemetry.bearish_win_rate_pct}% | Total R: ${bearOld.reduce((a, s) => a + s.realized_rr, 0).toFixed(2)}R | Avg R: ${oldData.telemetry.bearish_avg_rr}R`);
  console.log(`  New: ${bearNew.length} trades | Win Rate: ${newData.telemetry.bearish_win_rate_pct}% | Total R: ${bearNew.reduce((a, s) => a + s.realized_rr, 0).toFixed(2)}R | Avg R: ${newData.telemetry.bearish_avg_rr}R`);

  console.log(`\n===============================================================`);
  console.log(` 🔬 SECTION 4: MARKET REGIME VOLATILITY & MOMENTUM AUDIT`);
  console.log(`===============================================================`);

  // Trace candle range / ATR dynamics during 2025-11 & 2026-02 vs 2026-05 & 2026-08
  const monthsList = ['2025-11', '2026-02', '2026-05', '2026-08'];
  for (const m of monthsList) {
    const monthOldTrades = oldSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === m);
    const monthNewTrades = newSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === m);

    const oldLongs = monthOldTrades.filter((s: any) => s.type === 'BULLISH');
    const oldShorts = monthOldTrades.filter((s: any) => s.type === 'BEARISH');
    const newLongs = monthNewTrades.filter((s: any) => s.type === 'BULLISH');
    const newShorts = monthNewTrades.filter((s: any) => s.type === 'BEARISH');

    console.log(`\nMonth: ${m}`);
    console.log(`  Old: ${monthOldTrades.length} trades | Longs: ${oldLongs.length} (${oldLongs.filter((s: any) => s.realized_rr > 0).length}W / ${oldLongs.filter((s: any) => s.realized_rr < 0).length}L, ${oldLongs.reduce((a, s) => a + s.realized_rr, 0).toFixed(1)}R) | Shorts: ${oldShorts.length} (${oldShorts.filter((s: any) => s.realized_rr > 0).length}W / ${oldShorts.filter((s: any) => s.realized_rr < 0).length}L, ${oldShorts.reduce((a, s) => a + s.realized_rr, 0).toFixed(1)}R)`);
    console.log(`  New: ${monthNewTrades.length} trades | Longs: ${newLongs.length} (${newLongs.filter((s: any) => s.realized_rr > 0).length}W / ${newLongs.filter((s: any) => s.realized_rr < 0).length}L, ${newLongs.reduce((a, s) => a + s.realized_rr, 0).toFixed(1)}R) | Shorts: ${newShorts.length} (${newShorts.filter((s: any) => s.realized_rr > 0).length}W / ${newShorts.filter((s: any) => s.realized_rr < 0).length}L, ${newShorts.reduce((a, s) => a + s.realized_rr, 0).toFixed(1)}R)`);
  }
}

deepStructuralAndQuantAudit();

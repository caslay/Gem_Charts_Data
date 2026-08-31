import * as fs from 'fs';
import * as path from 'path';

function audit1YearComparison() {
  const oldPath = path.join(process.cwd(), 'scratch', '1y-old-live-SWEEP_RECLAIM_ETHUSDC_5m_bc8fc99e.json');
  const newPath = path.join(process.cwd(), 'scratch', '1y-dev-new-SWEEP_RECLAIM_ETHUSDC_5m_f0f059ac.json');

  console.log('Loading 1-year JSON files...');
  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const tOld = oldData.telemetry || {};
  const tNew = newData.telemetry || {};

  console.log('\n===============================================================');
  console.log(' 📊 1-YEAR FULL TELEMETRY COMPARISON: OLD VS NEW');
  console.log('===============================================================');

  const keys = Array.from(new Set([...Object.keys(tOld), ...Object.keys(tNew)]));
  for (const k of keys) {
    if (typeof tOld[k] === 'object' || typeof tNew[k] === 'object') {
      console.log(`\n--- ${k} ---`);
      console.log('OLD:', JSON.stringify(tOld[k]));
      console.log('NEW:', JSON.stringify(tNew[k]));
    } else {
      const oldVal = tOld[k] !== undefined ? String(tOld[k]) : 'N/A';
      const newVal = tNew[k] !== undefined ? String(tNew[k]) : 'N/A';
      console.log(`${k.padEnd(35)}: OLD = ${oldVal.padEnd(15)} | NEW = ${newVal}`);
    }
  }

  const oldSetups: any[] = oldData.setups || [];
  const newSetups: any[] = newData.setups || [];

  const oldRetested = oldSetups.filter((s: any) => s.is_retested === true);
  const newRetested = newSetups.filter((s: any) => s.is_retested === true);

  const oldTotalR = oldRetested.reduce((acc: number, s: any) => acc + (s.realized_rr || 0), 0);
  const newTotalR = newRetested.reduce((acc: number, s: any) => acc + (s.realized_rr || 0), 0);

  console.log('\n===============================================================');
  console.log(' 💰 1-YEAR AGGREGATE PERFORMANCE SUMMARY');
  console.log('===============================================================');
  console.log(`Old Version Retested Trades: ${oldRetested.length}`);
  console.log(`Old Version Total Realized R: ${oldTotalR.toFixed(2)}R`);
  console.log(`Old Version Win Rate: ${tOld.retest_win_rate_pct}%`);
  console.log(`Old Version Profit Factor: ${tOld.profit_factor}`);
  console.log(`Old Version Expected Value: ${tOld.expected_value_r}R`);

  console.log(`\nNew Version Retested Trades: ${newRetested.length}`);
  console.log(`New Version Total Realized R: ${newTotalR.toFixed(2)}R`);
  console.log(`New Version Win Rate: ${tNew.retest_win_rate_pct}%`);
  console.log(`New Version Profit Factor: ${tNew.profit_factor}`);
  console.log(`New Version Expected Value: ${tNew.expected_value_r}R`);

  console.log(`\nDelta Realized R: ${(newTotalR - oldTotalR).toFixed(2)}R`);
  console.log(`Delta Trades: ${newRetested.length - oldRetested.length}`);

  // Month by Month Breakdown
  const monthsMap = new Map<string, {
    oldTrades: number;
    oldWins: number;
    oldLosses: number;
    oldR: number;
    newTrades: number;
    newWins: number;
    newLosses: number;
    newR: number;
  }>();

  for (const s of oldRetested) {
    const month = new Date(s.anchor_time).toISOString().slice(0, 7);
    if (!monthsMap.has(month)) {
      monthsMap.set(month, { oldTrades: 0, oldWins: 0, oldLosses: 0, oldR: 0, newTrades: 0, newWins: 0, newLosses: 0, newR: 0 });
    }
    const entry = monthsMap.get(month)!;
    entry.oldTrades++;
    const r = s.realized_rr || 0;
    entry.oldR += r;
    if (r > 0) entry.oldWins++;
    else if (r < 0) entry.oldLosses++;
  }

  for (const s of newRetested) {
    const month = new Date(s.anchor_time).toISOString().slice(0, 7);
    if (!monthsMap.has(month)) {
      monthsMap.set(month, { oldTrades: 0, oldWins: 0, oldLosses: 0, oldR: 0, newTrades: 0, newWins: 0, newLosses: 0, newR: 0 });
    }
    const entry = monthsMap.get(month)!;
    entry.newTrades++;
    const r = s.realized_rr || 0;
    entry.newR += r;
    if (r > 0) entry.newWins++;
    else if (r < 0) entry.newLosses++;
  }

  console.log('\n===============================================================');
  console.log(' 📅 MONTH-BY-MONTH REALIZED R & WIN RATE BREAKDOWN');
  console.log('===============================================================');
  console.log('Month   | Old Trades (W/L) | Old R   | New Trades (W/L) | New R   | R Delta');
  console.log('--------+------------------+---------+------------------+---------+---------');

  const sortedMonths = Array.from(monthsMap.keys()).sort();
  for (const m of sortedMonths) {
    const data = monthsMap.get(m)!;
    const oldWl = `${data.oldWins}/${data.oldLosses}`.padEnd(7);
    const newWl = `${data.newWins}/${data.newLosses}`.padEnd(7);
    const oldRStr = `${data.oldR.toFixed(1)}R`.padEnd(7);
    const newRStr = `${data.newR.toFixed(1)}R`.padEnd(7);
    const deltaR = (data.newR - data.oldR).toFixed(1);
    const deltaRStr = `${deltaR > 0 ? '+' : ''}${deltaR}R`;
    console.log(`${m} | ${data.oldTrades.toString().padEnd(3)} (${oldWl}) | ${oldRStr} | ${data.newTrades.toString().padEnd(3)} (${newWl}) | ${newRStr} | ${deltaRStr}`);
  }

  // Deep Trade Diff Analysis
  const oldMap = new Map<string, any>();
  for (const s of oldSetups) oldMap.set(s.id, s);

  const newMap = new Map<string, any>();
  for (const s of newSetups) newMap.set(s.id, s);

  let eliminatedWins = 0;
  let eliminatedLosses = 0;
  let eliminatedScratches = 0;
  let eliminatedR = 0;

  let addedWins = 0;
  let addedLosses = 0;
  let addedScratches = 0;
  let addedR = 0;

  const eliminatedList: any[] = [];
  const addedList: any[] = [];

  for (const [id, oldS] of oldMap.entries()) {
    const wasOldRetested = oldS.is_retested === true;
    const newS = newMap.get(id);
    const isNewRetested = newS && newS.is_retested === true;

    if (wasOldRetested && !isNewRetested) {
      const r = oldS.realized_rr || 0;
      eliminatedR += r;
      if (r > 0) eliminatedWins++;
      else if (r < 0) eliminatedLosses++;
      else eliminatedScratches++;
      eliminatedList.push({ old: oldS, new: newS });
    }
  }

  for (const [id, newS] of newMap.entries()) {
    const wasNewRetested = newS.is_retested === true;
    const oldS = oldMap.get(id);
    const wasOldRetested = oldS && oldS.is_retested === true;

    if (wasNewRetested && !wasOldRetested) {
      const r = newS.realized_rr || 0;
      addedR += r;
      if (r > 0) addedWins++;
      else if (r < 0) addedLosses++;
      else addedScratches++;
      addedList.push(newS);
    }
  }

  console.log('\n===============================================================');
  console.log(' 🔬 DETAILED TRADE-LEVEL DISSECTION');
  console.log('===============================================================');
  console.log(`Trades Filtered Out (Vetoed) in New Version: ${eliminatedList.length}`);
  console.log(`  - Losses Avoided:   ${eliminatedLosses} trades (-${eliminatedLosses}R saved)`);
  console.log(`  - Wins Filtered:     ${eliminatedWins} trades`);
  console.log(`  - Scratches:         ${eliminatedScratches} trades`);
  console.log(`  - Net Filtered R:    ${eliminatedR.toFixed(2)}R`);

  console.log(`\nTrades Newly Unlocked in New Version: ${addedList.length}`);
  console.log(`  - New Wins:          ${addedWins} trades`);
  console.log(`  - New Losses:        ${addedLosses} trades`);
  console.log(`  - New Scratches:     ${addedScratches} trades`);
  console.log(`  - Net Unlocked R:    ${addedR.toFixed(2)}R`);

  // Anchor Type Breakdown
  console.log('\n===============================================================');
  console.log(' ⚓ PERFORMANCE BREAKDOWN BY ANCHOR TYPE');
  console.log('===============================================================');
  const anchorStats = new Map<string, { oldW: number; oldL: number; oldR: number; newW: number; newL: number; newR: number }>();

  for (const s of oldRetested) {
    const type = s.anchor_type;
    if (!anchorStats.has(type)) anchorStats.set(type, { oldW: 0, oldL: 0, oldR: 0, newW: 0, newL: 0, newR: 0 });
    const e = anchorStats.get(type)!;
    const r = s.realized_rr || 0;
    e.oldR += r;
    if (r > 0) e.oldW++; else if (r < 0) e.oldL++;
  }

  for (const s of newRetested) {
    const type = s.anchor_type;
    if (!anchorStats.has(type)) anchorStats.set(type, { oldW: 0, oldL: 0, oldR: 0, newW: 0, newL: 0, newR: 0 });
    const e = anchorStats.get(type)!;
    const r = s.realized_rr || 0;
    e.newR += r;
    if (r > 0) e.newW++; else if (r < 0) e.newL++;
  }

  console.log('Anchor Type   | Old Trades (W/L) | Old R   | New Trades (W/L) | New R   | R Delta');
  console.log('--------------+------------------+---------+------------------+---------+---------');
  for (const [type, data] of anchorStats.entries()) {
    const oldTot = data.oldW + data.oldL;
    const newTot = data.newW + data.newL;
    const oldWl = `${data.oldW}/${data.oldL}`.padEnd(7);
    const newWl = `${data.newW}/${data.newL}`.padEnd(7);
    const oldRStr = `${data.oldR.toFixed(1)}R`.padEnd(7);
    const newRStr = `${data.newR.toFixed(1)}R`.padEnd(7);
    const deltaR = (data.newR - data.oldR).toFixed(1);
    const deltaRStr = `${deltaR > 0 ? '+' : ''}${deltaR}R`;
    console.log(`${type.padEnd(13)} | ${oldTot.toString().padEnd(3)} (${oldWl}) | ${oldRStr} | ${newTot.toString().padEnd(3)} (${newWl}) | ${newRStr} | ${deltaRStr}`);
  }
}

audit1YearComparison();

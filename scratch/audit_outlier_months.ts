import * as fs from 'fs';
import * as path from 'path';

function auditOutlierMonths() {
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

  function inspectMonth(monthStr: string) {
    console.log(`\n===============================================================`);
    console.log(` 🔍 DEEP FORENSIC AUDIT: ${monthStr}`);
    console.log(`===============================================================`);

    const oldMonthTrades = oldSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === monthStr);
    const newMonthTrades = newSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === monthStr);

    console.log(`Old Trades: ${oldMonthTrades.length} | Old Total R: ${oldMonthTrades.reduce((acc, s) => acc + s.realized_rr, 0).toFixed(2)}R`);
    console.log(`New Trades: ${newMonthTrades.length} | New Total R: ${newMonthTrades.reduce((acc, s) => acc + s.realized_rr, 0).toFixed(2)}R`);

    // Trades in old that were eliminated in new
    const eliminated = oldMonthTrades.filter((s: any) => {
      const n = newMap.get(s.id);
      return !n || !n.is_retested;
    });

    // Trades in new that were not in old
    const added = newMonthTrades.filter((s: any) => {
      const o = oldMap.get(s.id);
      return !o || !o.is_retested;
    });

    console.log(`\n--- TRADES ELIMINATED IN ${monthStr} (${eliminated.length}) ---`);
    let elimW = 0, elimL = 0, elimR = 0;
    for (const s of eliminated) {
      const r = s.realized_rr || 0;
      elimR += r;
      if (r > 0) elimW++; else if (r < 0) elimL++;
      const n = newMap.get(s.id);
      console.log(`  [ELIM] ${s.type.padEnd(7)} | Anchor: ${s.anchor_name.padEnd(35)} ($${s.anchor_level}) | Time: ${new Date(s.anchor_time).toISOString()} | Old: ${s.realized_rr}R (${s.simulated_outcome || s.stage_exit_type}) | New EQ: $${n?.dealing_range_equilibrium} | New Aligned: ${n?.is_valuation_aligned}`);
    }
    console.log(`  Eliminated Summary: ${elimW} Wins, ${elimL} Losses, Net R Lost: ${elimR.toFixed(2)}R`);

    console.log(`\n--- TRADES ADDED IN ${monthStr} (${added.length}) ---`);
    let addW = 0, addL = 0, addR = 0;
    for (const s of added) {
      const r = s.realized_rr || 0;
      addR += r;
      if (r > 0) addW++; else if (r < 0) addL++;
      const o = oldMap.get(s.id);
      console.log(`  [ADD]  ${s.type.padEnd(7)} | Anchor: ${s.anchor_name.padEnd(35)} ($${s.anchor_level}) | Time: ${new Date(s.anchor_time).toISOString()} | New: ${s.realized_rr}R (${s.simulated_outcome || s.stage_exit_type}) | Old EQ: $${o?.dealing_range_equilibrium} | Old Aligned: ${o?.is_valuation_aligned}`);
    }
    console.log(`  Added Summary: ${addW} Wins, ${addL} Losses, Net R Gained: ${addR.toFixed(2)}R`);
  }

  inspectMonth('2025-11');
  inspectMonth('2026-02');
  inspectMonth('2026-05');
  inspectMonth('2026-08');
}

auditOutlierMonths();

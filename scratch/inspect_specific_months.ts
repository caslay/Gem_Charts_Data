import * as fs from 'fs';
import * as path from 'path';

function inspectSpecificMonths() {
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

  function analyzeMonthDetails(monthStr: string) {
    console.log(`\n===============================================================`);
    console.log(` 🔎 DETAILED DISSECTION FOR ${monthStr}`);
    console.log(`===============================================================`);

    const oldMonthTrades = oldSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === monthStr);
    const newMonthTrades = newSetups.filter((s: any) => s.is_retested && new Date(s.anchor_time).toISOString().slice(0, 7) === monthStr);

    const eliminated = oldMonthTrades.filter((s: any) => {
      const n = newMap.get(s.id);
      return !n || !n.is_retested;
    });

    const added = newMonthTrades.filter((s: any) => {
      const o = oldMap.get(s.id);
      return !o || !o.is_retested;
    });

    console.log(`Eliminated Trades (${eliminated.length}):`);
    for (const s of eliminated) {
      const n = newMap.get(s.id);
      console.log(`  ELIM [${s.type}] ${s.anchor_name} ($${s.anchor_level}) @ ${new Date(s.anchor_time).toISOString().slice(5, 16)} | Old Outcome: ${s.simulated_outcome} (${s.realized_rr}R) | New EQ: $${n?.dealing_range_equilibrium} vs Entry: $${n?.entry_price}`);
    }

    console.log(`\nAdded Trades (${added.length}):`);
    for (const s of added) {
      const o = oldMap.get(s.id);
      console.log(`  ADD  [${s.type}] ${s.anchor_name} ($${s.anchor_level}) @ ${new Date(s.anchor_time).toISOString().slice(5, 16)} | New Outcome: ${s.simulated_outcome} (${s.realized_rr}R) | Old EQ: $${o?.dealing_range_equilibrium} vs Entry: $${s.entry_price}`);
    }
  }

  analyzeMonthDetails('2025-11');
  analyzeMonthDetails('2026-02');
}

inspectSpecificMonths();

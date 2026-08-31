import * as fs from 'fs';
import * as path from 'path';

function deepDiveMetrics() {
  const oldPath = path.join(process.cwd(), 'scratch', 'Old_version_SWEEP_RECLAIM_ETHUSDC_5m_7ea78a23.json');
  const newPath = path.join(process.cwd(), 'scratch', 'Premium-descount-fix-SWEEP_RECLAIM_ETHUSDC_5m_2f34fa77.json');

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const oldSetups = oldData.setups || [];
  const newSetups = newData.setups || [];

  const oldRetested = oldSetups.filter((s: any) => s.is_retested === true);
  const newRetested = newSetups.filter((s: any) => s.is_retested === true);

  const oldTotalR = oldRetested.reduce((acc: number, s: any) => acc + (s.realized_rr || 0), 0);
  const newTotalR = newRetested.reduce((acc: number, s: any) => acc + (s.realized_rr || 0), 0);

  const oldGrossProfitR = oldRetested.filter((s: any) => (s.realized_rr || 0) > 0).reduce((acc: number, s: any) => acc + s.realized_rr, 0);
  const oldGrossLossR = Math.abs(oldRetested.filter((s: any) => (s.realized_rr || 0) < 0).reduce((acc: number, s: any) => acc + s.realized_rr, 0));

  const newGrossProfitR = newRetested.filter((s: any) => (s.realized_rr || 0) > 0).reduce((acc: number, s: any) => acc + s.realized_rr, 0);
  const newGrossLossR = Math.abs(newRetested.filter((s: any) => (s.realized_rr || 0) < 0).reduce((acc: number, s: any) => acc + s.realized_rr, 0));

  console.log(`\n===============================================================`);
  console.log(` 📈 180-DAY BACKTEST QUANTITATIVE COMPARISON`);
  console.log(`===============================================================`);
  console.log(`Metric                        | Old Engine      | New Dev Version | Delta`);
  console.log(`------------------------------+-----------------+-----------------+-------------------`);
  console.log(`Total Retested Trades         | ${oldRetested.length.toString().padEnd(15)} | ${newRetested.length.toString().padEnd(15)} | +${newRetested.length - oldRetested.length}`);
  console.log(`Winning Trades (Full TP2)     | ${oldData.telemetry.total_winning_trades.toString().padEnd(15)} | ${newData.telemetry.total_winning_trades.toString().padEnd(15)} | +${newData.telemetry.total_winning_trades - oldData.telemetry.total_winning_trades}`);
  console.log(`Losing Trades (Stopped Out)   | ${oldData.telemetry.total_losing_trades.toString().padEnd(15)} | ${newData.telemetry.total_losing_trades.toString().padEnd(15)} | -${oldData.telemetry.total_losing_trades - newData.telemetry.total_losing_trades}`);
  console.log(`Breakeven / Scratches         | ${oldData.telemetry.total_be_scratches.toString().padEnd(15)} | ${newData.telemetry.total_be_scratches.toString().padEnd(15)} | +${newData.telemetry.total_be_scratches - oldData.telemetry.total_be_scratches}`);
  console.log(`Win Rate                      | ${oldData.telemetry.retest_win_rate_pct.toString().padEnd(14)}% | ${newData.telemetry.retest_win_rate_pct.toString().padEnd(14)}% | +${(newData.telemetry.retest_win_rate_pct - oldData.telemetry.retest_win_rate_pct).toFixed(1)}%`);
  console.log(`Profit Factor                 | ${oldData.telemetry.profit_factor.toString().padEnd(15)} | ${newData.telemetry.profit_factor.toString().padEnd(15)} | +${(newData.telemetry.profit_factor - oldData.telemetry.profit_factor).toFixed(2)}`);
  console.log(`Total Realized Return (R)     | ${oldTotalR.toFixed(2).padEnd(14)}R | ${newTotalR.toFixed(2).padEnd(14)}R | +${(newTotalR - oldTotalR).toFixed(2)}R (+${(((newTotalR - oldTotalR) / oldTotalR) * 100).toFixed(1)}%)`);
  console.log(`Gross Profit (R)              | ${oldGrossProfitR.toFixed(2).padEnd(14)}R | ${newGrossProfitR.toFixed(2).padEnd(14)}R | +${(newGrossProfitR - oldGrossProfitR).toFixed(2)}R`);
  console.log(`Gross Loss (R)                | ${oldGrossLossR.toFixed(2).padEnd(14)}R | ${newGrossLossR.toFixed(2).padEnd(14)}R | -${(oldGrossLossR - newGrossLossR).toFixed(2)}R (Saved Loss)`);
  console.log(`Expected Value (EV per trade) | ${oldData.telemetry.expected_value_r.toString().padEnd(14)}R | ${newData.telemetry.expected_value_r.toString().padEnd(14)}R | +${(newData.telemetry.expected_value_r - oldData.telemetry.expected_value_r).toFixed(2)}R`);
  console.log(`Bearish Win Rate              | ${oldData.telemetry.bearish_win_rate_pct.toString().padEnd(14)}% | ${newData.telemetry.bearish_win_rate_pct.toString().padEnd(14)}% | +${(newData.telemetry.bearish_win_rate_pct - oldData.telemetry.bearish_win_rate_pct).toFixed(1)}%`);
  console.log(`Bullish Win Rate              | ${oldData.telemetry.bullish_win_rate_pct.toString().padEnd(14)}% | ${newData.telemetry.bullish_win_rate_pct.toString().padEnd(14)}% | +${(newData.telemetry.bullish_win_rate_pct - oldData.telemetry.bullish_win_rate_pct).toFixed(1)}%`);
  console.log(`Avg Drawdown Heat (MAE)       | ${oldData.telemetry.avg_mae_r.toString().padEnd(14)}R | ${newData.telemetry.avg_mae_r.toString().padEnd(14)}R | -${(oldData.telemetry.avg_mae_r - newData.telemetry.avg_mae_r).toFixed(2)}R`);
  console.log(`===============================================================\n`);
}

deepDiveMetrics();

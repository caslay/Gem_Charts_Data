import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
} catch (e) {}

import { sql } from '@vercel/postgres';

async function main() {
  const scanId = 'c838e282-858d-4ac8-8983-22e4abd0bc2f';
  try {
    const scanRes = await sql`
      SELECT 
        id, scan_name, symbol, timeframe, start_date, end_date,
        total_detected, sweep_rate_pct, reclaim_rate_pct,
        retest_rate_pct, retest_win_rate_pct, avg_realized_rr,
        profit_factor, telemetry_summary, created_at,
        (
          SELECT jsonb_agg(s - 'displacement_candles')
          FROM jsonb_array_elements(setups) s
        ) as setups
      FROM quant_lab_sr_scans
      WHERE id = ${scanId}
      LIMIT 1
    `;

    console.log('Successfully fetched scan:', scanRes.rows[0].id);
    console.log('Setups length:', (scanRes.rows[0].setups as any)?.length);
    console.log('Setups JSON byte size:', Buffer.byteLength(JSON.stringify(scanRes.rows[0].setups)));
  } catch (err: any) {
    console.error('Error fetching scan:', err);
  }
}

main();

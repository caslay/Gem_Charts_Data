import fs from 'fs';
import path from 'path';

// Parse .env.local manually
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
  try {
    const res = await sql`
      SELECT 
        id, scan_name, symbol, timeframe, total_detected,
        pg_column_size(setups) as setups_bytes,
        pg_column_size(telemetry_summary) as telemetry_bytes,
        created_at
      FROM quant_lab_sr_scans
      ORDER BY created_at DESC
      LIMIT 10;
    `;
    console.log('Rows in quant_lab_sr_scans:');
    console.table(res.rows);
  } catch (err: any) {
    console.error('Error querying DB:', err.message);
  }
}

main();

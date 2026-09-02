import * as fs from 'fs';
import * as path from 'path';

// Automatically load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import { sql } from '../src/lib/postgres';

async function main() {
  console.log('🔍 Testing PostgreSQL Database Connection via SSH Tunnel (127.0.0.1:5433)...');
  try {
    const res = await sql.query('SELECT NOW() as server_time, COUNT(*)::int as total_trades FROM trades;');
    console.log('✅ PostgreSQL Database Tunnel Connected Successfully!');
    console.log(`   🕒 Server Time: ${res.rows[0].server_time}`);
    console.log(`   📊 Total Recorded Trades: ${res.rows[0].total_trades}`);
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Database Connection Error:', err.message || err);
    if (err.message && err.message.includes('ECONNREFUSED')) {
      console.error('\n💡 TIP: Ensure the SSH tunnel is running in another terminal:');
      console.error('   npm run tunnel:db\n');
    }
    process.exit(1);
  }
}

main();

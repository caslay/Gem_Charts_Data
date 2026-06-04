import { sql } from '@vercel/postgres';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local manually
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w_]+)\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (match) {
      process.env[match[1]] = match[2];
    }
  }
}

async function run() {
  try {
    const res = await sql`
      SELECT key_value FROM system_settings WHERE key_name = 'SYSTEM_PROMPT' LIMIT 1
    `;
    if (res.rows.length > 0) {
      console.log("=== Database SYSTEM_PROMPT ===");
      console.log(res.rows[0].key_value);
    } else {
      console.log("SYSTEM_PROMPT key not found in system_settings database table.");
    }
  } catch (err: any) {
    console.error("Database connection error:", err.message);
  }
}
run();

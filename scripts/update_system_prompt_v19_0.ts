import { sql } from '../src/lib/postgres';
import { DEFAULT_ETH_SOP_SYSTEM_PROMPT } from '../src/lib/sopPromptBuilder';

async function main() {
  console.log('--- Migrating system_settings to Pure Institutional Pro-Trend BOS Continuation V19.0 Prompt ---');
  try {
    const result = await sql`
      INSERT INTO system_settings (key_name, key_value)
      VALUES ('SYSTEM_PROMPT', ${DEFAULT_ETH_SOP_SYSTEM_PROMPT})
      ON CONFLICT (key_name)
      DO UPDATE SET key_value = EXCLUDED.key_value
      RETURNING key_name, length(key_value) as prompt_len;
    `;
    console.log('✅ Successfully updated system_settings record:', JSON.stringify(result.rows));
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to update system_settings record:', err);
    process.exit(1);
  }
}

main();

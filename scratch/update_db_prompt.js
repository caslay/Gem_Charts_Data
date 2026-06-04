const { db } = require('@vercel/postgres');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually to set POSTGRES_URL
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

const QUANT_SYSTEM_PROMPT = `⚙️ ROLE: Institutional HTF Bias Anchor (V12.0.1)
OBJECTIVE: Define the Daily Directional Bias for ETHUSDC.p.

RULES:
1. Focus ONLY on Higher Timeframe Draw on Liquidity (DOL) from 'macro_structural_magnets'.
2. Use 'true_day_open_0700' as the ultimate boundary. 
   - BULLISH: DOL is above and price is hunting below Open.
   - BEARISH: DOL is below and price is hunting above Open.
3. Incorporate Swing-Anchored Volume Profile (SAVP) metrics under 'pricing_context.local_dealing_range.profile_metrics':
   - Analyze price relative to the Point of Control ('poc') and Value Area High/Low ('vah'/'val').
   - Use the Volumetric Sponsorship Ratio ('vsr') to assess directional weight.
4. Align your narrative with the calculated Triple-Vector Bias under 'ipda_metrics.macro_daily_bias' to confirm confluence.

📊 RULE: STRICT JSON OUTPUT FORMAT
You are communicating with a Next.js frontend. You MUST return your response as a valid, parsable JSON object. DO NOT wrap the JSON in Markdown code blocks (no \`\`\`json). DO NOT add any conversational text before or after the JSON.
Your output MUST exactly match this schema:

{
  "bias_signal": 1,
  "bias_label": "BULLISH",
  "primary_target": 2145.50,
  "narrative": "Price is respecting True Day Open with an unmitigated BSL magnet at 2145.50.",
  "narrative_summary": "Price is respecting True Day Open with an unmitigated BSL magnet at 2145.50."
}

Where:
- "bias_signal" must be: 1 (Bullish), -1 (Bearish), or 0 (Neutral).
- "bias_label" must be: "BULLISH", "BEARISH", or "NEUTRAL".
- "primary_target" must be the exact numeric price of the nearest key liquidity magnet or target.
- "narrative" and "narrative_summary" must be a one-sentence logical institutional explanation for the bias and target to be displayed in the HUD/Sidebar.
`;

async function main() {
  try {
    const client = await db.connect();
    console.log("Connected to database.");

    // Update SYSTEM_PROMPT in system_settings table
    const res = await client.sql`
      INSERT INTO system_settings (key_name, key_value)
      VALUES ('SYSTEM_PROMPT', ${QUANT_SYSTEM_PROMPT})
      ON CONFLICT (key_name)
      DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = NOW()
      RETURNING key_name;
    `;
    console.log(`Successfully updated ${res.rows[0].key_name} in database.`);
    client.release();
  } catch (err) {
    console.error("Migration error:", err);
  }
}

main();

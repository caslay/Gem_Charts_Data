/**
 * audit_readonly_local_isolation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated Verification Suite for Local Dev Sandbox & Database Read-Only Isolation
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Pool } from 'pg';
import { POST as handleSettingsPost } from '../src/app/api/settings/route';
import { POST as handleStrategiesPost } from '../src/app/api/strategies/route';

async function runAudit() {
  console.log(`\n===============================================================`);
  console.log(` 🛡️ QUEGAR QUANT ENGINE — LOCAL READ-ONLY ISOLATION AUDIT`);
  console.log(`===============================================================\n`);

  let allPassed = true;

  // 1. Database Connection & SELECT Assertions (Role: quegar_readonly)
  console.log(`▶ [TEST 1] Database SELECT Privileges (quegar_readonly)...`);
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || 'postgres://quegar_readonly:b83a4b7ddfc45e20151c62713a9d6ced@127.0.0.1:5433/quegar_db',
    connectionTimeoutMillis: 5000,
  });

  try {
    const resSettings = await pool.query('SELECT count(*) as count FROM system_settings;');
    const resTerminal = await pool.query('SELECT count(*) as count FROM terminal_settings;');
    const resStrategies = await pool.query('SELECT count(*) as count FROM custom_strategies;');

    console.log(`   ✅ SELECT system_settings: ${resSettings.rows[0].count} record(s) read.`);
    console.log(`   ✅ SELECT terminal_settings: ${resTerminal.rows[0].count} record(s) read.`);
    console.log(`   ✅ SELECT custom_strategies: ${resStrategies.rows[0].count} record(s) read.`);
    console.log(`   🏆 [PASS] Read-only SELECT access confirmed.\n`);
  } catch (err: any) {
    console.error(`   ❌ [FAIL] SELECT query failed:`, err.message);
    allPassed = false;
  }

  // 2. Database Mutation Invalidation (Asserting Permission Denied on INSERT/UPDATE/DELETE)
  console.log(`▶ [TEST 2] Database Mutation Invalidation (Asserting Permission Denied)...`);

  // 2a. INSERT Test
  try {
    await pool.query("INSERT INTO system_settings (key_name, key_value) VALUES ('audit_test', '{\"test\":1}');");
    console.error(`   ❌ [SECURITY BREACH] INSERT succeeded unexpectedly on read-only user!`);
    allPassed = false;
  } catch (err: any) {
    if (err.code === '42501' || err.message.includes('permission denied')) {
      console.log(`   ✅ [PASS] INSERT blocked by PostgreSQL: "${err.message.trim()}" (Code: ${err.code || '42501'})`);
    } else {
      console.error(`   ❌ [FAIL] Unexpected error during INSERT test:`, err.message);
      allPassed = false;
    }
  }

  // 2b. UPDATE Test
  try {
    await pool.query("UPDATE system_settings SET key_value = '{\"mutated\":true}' WHERE key_name = 'active_symbol';");
    console.error(`   ❌ [SECURITY BREACH] UPDATE succeeded unexpectedly on read-only user!`);
    allPassed = false;
  } catch (err: any) {
    if (err.code === '42501' || err.message.includes('permission denied')) {
      console.log(`   ✅ [PASS] UPDATE blocked by PostgreSQL: "${err.message.trim()}" (Code: ${err.code || '42501'})`);
    } else {
      console.error(`   ❌ [FAIL] Unexpected error during UPDATE test:`, err.message);
      allPassed = false;
    }
  }

  // 2c. DELETE Test
  try {
    await pool.query("DELETE FROM terminal_settings WHERE id = 99999;");
    console.error(`   ❌ [SECURITY BREACH] DELETE succeeded unexpectedly on read-only user!`);
    allPassed = false;
  } catch (err: any) {
    if (err.code === '42501' || err.message.includes('permission denied')) {
      console.log(`   ✅ [PASS] DELETE blocked by PostgreSQL: "${err.message.trim()}" (Code: ${err.code || '42501'})`);
    } else {
      console.error(`   ❌ [FAIL] Unexpected error during DELETE test:`, err.message);
      allPassed = false;
    }
  }

  await pool.end();

  // 3. Application API Route Guard Invalidation (/api/settings & /api/strategies)
  console.log(`\n▶ [TEST 3] Next.js API Route Guard Validation (READ_ONLY_LOCAL=true)...`);

  // Ensure process.env.READ_ONLY_LOCAL is active
  process.env.READ_ONLY_LOCAL = 'true';

  // 3a. Test /api/settings POST
  try {
    const mockReqSettings = new Request('http://localhost:4000/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'test', value: { foo: 'bar' } }),
    });

    const res = await handleSettingsPost(mockReqSettings as any);
    const body = await res.json();

    if (res.status === 403 && body.error === 'FORBIDDEN_READ_ONLY_LOCAL') {
      console.log(`   ✅ [PASS] /api/settings POST intercepted with HTTP 403: "${body.message}"`);
    } else {
      console.error(`   ❌ [FAIL] /api/settings did not return expected 403: Status ${res.status}`, body);
      allPassed = false;
    }
  } catch (err: any) {
    console.error(`   ❌ [FAIL] Error calling /api/settings handler:`, err.message);
    allPassed = false;
  }

  // 3b. Test /api/strategies POST
  try {
    const mockReqStrategies = new Request('http://localhost:4000/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'strat_test', name: 'Test Strat' }),
    });

    const res = await handleStrategiesPost(mockReqStrategies as any);
    const body = await res.json();

    if (res.status === 403 && body.error === 'FORBIDDEN_READ_ONLY_LOCAL') {
      console.log(`   ✅ [PASS] /api/strategies POST intercepted with HTTP 403: "${body.message}"`);
    } else {
      console.error(`   ❌ [FAIL] /api/strategies did not return expected 403: Status ${res.status}`, body);
      allPassed = false;
    }
  } catch (err: any) {
    console.error(`   ❌ [FAIL] Error calling /api/strategies handler:`, err.message);
    allPassed = false;
  }

  console.log(`\n===============================================================`);
  if (allPassed) {
    console.log(` 🏆 ALL AUDIT TESTS PASSED — LOCAL ENVIRONMENT 100% READ-ONLY ISOLATED!`);
  } else {
    console.log(` ❌ AUDIT FAILED — FIX VIOLATIONS BEFORE PROCEEDING!`);
    process.exit(1);
  }
  console.log(`===============================================================\n`);
}

runAudit().catch((err) => {
  console.error('[AUDIT_FATAL_ERROR]', err);
  process.exit(1);
});

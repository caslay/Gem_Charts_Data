/**
 * scripts/test_decision_log_promotion_pipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Test Suite for Architectural Mission:
 *  - Self-Healing Migration for Decision Log & Telegram Promotion Pipeline Audit
 * 
 * Verifies:
 *  1. ensureAgentDecisionTableInitialized() resilience & schema migration (updated_at)
 *  2. Schema & Promotion Test: Inserts mock decision into agent_decision_log,
 *     promotes to PAPER_TRADING, and verifies DB record updates with updated_at populated
 *  3. Error 42703 self-healing retry & resilient fallback
 *  4. Promotion error reporting parity (veto reasons properly reflected in failure messages)
 *  5. Type contract parity for AgentDecisionRecord with 'ARMED' status and updated_at
 *  6. In-memory execution ledger registration & simulated limit order placement
 *  7. Telegram Bot callback user feedback harmonization (Workstream C crisp confirmation)
 *  8. File-based command router fallback contract (daemon_commands.json)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ensureAgentDecisionTableInitialized, resetAgentDecisionTableReady } from '../src/lib/agentEngineHandlers';
import { setDbPool } from '../src/lib/postgres';
import { AutomatedStrategyExecutionEngine } from '../src/lib/quantEngine/AutomatedStrategyExecutionEngine';
import { SparkIngestionDispatcher } from '../src/lib/daemon/sparkIngestionDispatcher';
import { TelegramNotifier } from '../src/lib/notifications/telegramNotifier';
import { TelegramBotService } from '../src/lib/notifications/telegramBotService';
import { DaemonLedger } from './lib/daemonLedger';
import type { AgentDecisionRecord } from '../src/types/agentTypes';

// ── Mock Database Store for In-Memory Schema & Promotion Simulation ─────────────

interface MockRow {
  id: number;
  symbol: string;
  agent_id: string;
  bias_signal: string;
  entry_range_low: number;
  entry_range_high: number;
  limit_entry_price?: number | null;
  invalidation_level: number;
  target_1: number;
  target_2: number;
  target_3?: number | null;
  stage1_ratio?: number;
  stage2_ratio?: number;
  stage3_ratio?: number;
  narrative?: string | null;
  status: string;
  execution_mode: string;
  trigger_timeframe?: string;
  trigger_condition?: string;
  trigger_price?: number;
  poi_zone_low?: number;
  poi_zone_high?: number;
  limit_offset_rule?: string;
  ttl_bars?: number;
  bars_elapsed?: number;
  live_price_at_submission?: number;
  submitted_at: number;
  invalidated_at?: number | null;
  created_at: string;
  updated_at?: string | null;
  [key: string]: any;
}

class MockDbEngine {
  public columns: Set<string> = new Set([
    'id', 'symbol', 'agent_id', 'bias_signal', 'entry_range_low', 'entry_range_high',
    'invalidation_level', 'target_1', 'target_2', 'narrative', 'status',
    'live_price_at_submission', 'submitted_at', 'created_at'
  ]); // Legacy schema intentionally missing 'updated_at' initially
  public rows: Map<number, MockRow> = new Map();
  public queriesExecuted: string[] = [];
  public simulateError42703Once = false;

  public async query(text: string, values: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    this.queriesExecuted.push(text.trim());

    // 1. Table existence check
    if (text.includes("FROM information_schema.tables WHERE table_name = 'agent_decision_log'")) {
      return { rows: [{ '1': 1 }], rowCount: 1 };
    }

    // 2. Migration: ADD COLUMN
    if (text.includes('ALTER TABLE agent_decision_log ADD COLUMN IF NOT EXISTS')) {
      const match = text.match(/ADD COLUMN IF NOT EXISTS\s+(\w+)/i);
      if (match) {
        this.columns.add(match[1].toLowerCase());
      }
      return { rows: [], rowCount: 0 };
    }

    // 3. Index creation
    if (text.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [], rowCount: 0 };
    }

    // 4. INSERT INTO agent_decision_log
    if (text.includes('INSERT INTO agent_decision_log')) {
      const id = values[0] || (this.rows.size + 1);
      const row: MockRow = {
        id,
        symbol: values[0] || 'ETHUSDC',
        agent_id: values[1] || 'mock_agent',
        bias_signal: values[2] || 'CONFIRMED_BULLISH',
        entry_range_low: Number(values[3] || 2450),
        entry_range_high: Number(values[4] || 2460),
        invalidation_level: Number(values[5] || 2420),
        target_1: Number(values[6] || 2500),
        target_2: Number(values[7] || 2550),
        status: 'LOGGED_STANDBY',
        execution_mode: 'STANDBY',
        submitted_at: Date.now(),
        created_at: new Date().toISOString(),
        updated_at: this.columns.has('updated_at') ? new Date().toISOString() : null,
      };
      this.rows.set(id, row);
      return { rows: [row], rowCount: 1 };
    }

    // 5. SELECT FROM agent_decision_log
    if (text.includes('FROM agent_decision_log WHERE id =')) {
      const idVal = Number(values[0]);
      const row = this.rows.get(idVal);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    // 6. UPDATE agent_decision_log
    if (text.includes('UPDATE agent_decision_log')) {
      // Simulate error 42703 if table does not have updated_at or forced simulation
      if (text.includes('updated_at') && (!this.columns.has('updated_at') || this.simulateError42703Once)) {
        if (this.simulateError42703Once) {
          this.simulateError42703Once = false;
        }
        const err: any = new Error("column 'updated_at' of relation 'agent_decision_log' does not exist");
        err.code = '42703';
        throw err;
      }

      // Extract target ID from query or values
      let targetId = values[values.length - 1];
      if (typeof targetId !== 'number' || isNaN(targetId)) {
        const idMatch = text.match(/WHERE id = \$?(\d+)/i) || text.match(/WHERE id = (\d+)/i);
        if (idMatch) targetId = parseInt(idMatch[1], 10);
      }

      const row = this.rows.get(Number(targetId));
      if (row) {
        if (text.includes("execution_mode = 'PAPER_TRADING'") || values.includes('PAPER_TRADING')) {
          row.execution_mode = 'PAPER_TRADING';
        }
        if (text.includes("status = 'ARMED'") || values.includes('ARMED')) {
          row.status = 'ARMED';
        } else if (text.includes("status = 'QUEUED'") || values.includes('QUEUED')) {
          row.status = 'QUEUED';
        } else if (text.includes("status = 'DISMISSED'") || values.includes('DISMISSED')) {
          row.status = 'DISMISSED';
        }

        if (text.includes('updated_at') && this.columns.has('updated_at')) {
          row.updated_at = new Date().toISOString();
        }
        if (text.includes('narrative =')) {
          row.narrative = (row.narrative || '') + ' [UPDATED]';
        }
        return { rows: [{ ...row }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }
}

async function runPromotionPipelineTests() {
  console.log('======================================================================');
  console.log('🧪 TESTING SELF-HEALING DECISION LOG & TELEGRAM PROMOTION PIPELINE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function testAssert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(` ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // Inject mock PostgreSQL database engine
  const mockDb = new MockDbEngine();
  const mockPool = {
    query: (text: string, values?: any[]) => mockDb.query(text, values),
    connect: async () => ({
      query: (text: string, values?: any[]) => mockDb.query(text, values),
      release: () => {},
    }),
    on: () => {},
  } as any;
  setDbPool(mockPool);
  resetAgentDecisionTableReady();

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Defensive Self-Healing Table Initialization & Schema Parity
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 1] Testing ensureAgentDecisionTableInitialized()...');
  testAssert(!mockDb.columns.has('updated_at'), 'Mock database starts with legacy schema missing updated_at');
  
  await ensureAgentDecisionTableInitialized(true);
  testAssert(mockDb.columns.has('updated_at'), 'ensureAgentDecisionTableInitialized adds updated_at column');
  
  const createdIdxQuery = mockDb.queriesExecuted.find((q) => q.includes('idx_agent_decision_created_at'));
  const updatedIdxQuery = mockDb.queriesExecuted.find((q) => q.includes('idx_agent_decision_updated_at'));
  testAssert(createdIdxQuery !== undefined, 'Index idx_agent_decision_created_at is created');
  testAssert(updatedIdxQuery !== undefined, 'Index idx_agent_decision_updated_at is created');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Type Contract Parity (AgentDecisionRecord)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 2] Testing AgentDecisionRecord TypeScript definition parity...');
  const mockRecord: AgentDecisionRecord = {
    id: 18,
    symbol: 'ETHUSDC',
    agent_id: 'gemini_spark_v1',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2450.0,
    entry_range_high: 2460.0,
    limit_entry_price: 2455.0,
    invalidation_level: 2420.0,
    target_1: 2500.0,
    target_2: 2550.0,
    status: 'ARMED', // Verifying 'ARMED' is a valid status
    execution_mode: 'PAPER_TRADING',
    trigger_timeframe: '5m',
    trigger_condition: 'MSS_BODY_CLOSE_ABOVE',
    trigger_price: 2460.0,
    submitted_at: Date.now(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), // Verifying updated_at is recognized
  };
  testAssert(mockRecord.status === 'ARMED', "AgentDecisionRecord accepts status: 'ARMED'");
  testAssert(typeof mockRecord.updated_at === 'string', 'AgentDecisionRecord includes updated_at field');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Schema & Promotion Test (Insert mock decision, promote, verify DB updated_at)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 3] Testing DB Setup Promotion to PAPER_TRADING & updated_at population...');
  
  // Seed mock decision #18 in database in LOGGED_STANDBY status
  mockDb.rows.set(18, {
    id: 18,
    symbol: 'ETHUSDC',
    agent_id: 'trend_continuation_sniper',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2450.0,
    entry_range_high: 2460.0,
    limit_entry_price: 2455.0,
    invalidation_level: 2420.0,
    target_1: 2500.0,
    target_2: 2550.0,
    target_3: 2600.0,
    status: 'LOGGED_STANDBY',
    execution_mode: 'STANDBY',
    submitted_at: Date.now(),
    created_at: new Date(Date.now() - 60000).toISOString(),
    updated_at: null, // initially unpopulated
  });

  const engine = new AutomatedStrategyExecutionEngine({
    symbol: 'ETHUSDC',
    compoundingRiskPct: 2.0,
    timeframe: '5m',
    autoExecute: true,
  });
  const ledger = new DaemonLedger('ETHUSDC', 10000);
  const dispatcher = new SparkIngestionDispatcher({
    engine,
    ledger,
    symbol: 'ETHUSDC',
    pollingIntervalMs: 60000,
    getCurrentPrice: () => 2470.0,
  });

  // Promote setup #18 from DB to PAPER_TRADING
  const promoRes = await dispatcher.promoteStandbyToMode(18, 'PAPER_TRADING');
  testAssert(promoRes.success === true, 'promoteStandbyToMode returns success: true');
  testAssert(promoRes.entryPrice === 2455.0, 'promoteStandbyToMode returns resolved entryPrice');

  // Verify database record was updated with ARMED, PAPER_TRADING, and populated updated_at
  const dbRecord = mockDb.rows.get(18);
  testAssert(dbRecord !== undefined, 'Record #18 exists in database');
  testAssert(dbRecord?.status === 'ARMED', "Record status transitioned to 'ARMED'");
  testAssert(dbRecord?.execution_mode === 'PAPER_TRADING', "Record execution_mode updated to 'PAPER_TRADING'");
  testAssert(typeof dbRecord?.updated_at === 'string' && dbRecord.updated_at.length > 0, "Record updated_at is populated with timestamp");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Verification of Simulated Limit Order in Execution Engine Ledger
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 4] Verifying simulated limit order armed in execution engine...');
  const pendingOrders = engine.getPendingLimitOrders();
  testAssert(pendingOrders.length > 0, 'Engine registers simulated resting limit order in pendingLimitOrders');
  const restingOrder = pendingOrders.find((o) => o.limitEntryPrice === 2455.0);
  testAssert(restingOrder !== undefined, 'Resting limit order has entry at $2455.00');
  testAssert(restingOrder?.executionMode === 'PAPER_TRADING', 'Resting limit order execution mode is PAPER_TRADING');
  testAssert(restingOrder?.direction === 'LONG', 'Resting limit order direction is LONG');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Error 42703 Self-Healing Retry Test
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 5] Verifying error 42703 (undefined column) self-healing retry...');
  // Seed mock decision #20
  mockDb.rows.set(20, {
    id: 20,
    symbol: 'ETHUSDC',
    agent_id: 'trend_continuation_sniper',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2430.0,
    entry_range_high: 2440.0,
    limit_entry_price: 2435.0,
    invalidation_level: 2400.0,
    target_1: 2480.0,
    target_2: 2520.0,
    status: 'LOGGED_STANDBY',
    execution_mode: 'STANDBY',
    submitted_at: Date.now(),
    created_at: new Date(Date.now() - 30000).toISOString(),
    updated_at: null,
  });

  // Temporarily configure mock engine to simulate 42703 on the first UPDATE query
  mockDb.simulateError42703Once = true;
  const promoRes20 = await dispatcher.promoteStandbyToMode(20, 'PAPER_TRADING');
  testAssert(promoRes20.success === true, 'promoteStandbyToMode heals from error 42703 and returns success: true');
  const dbRecord20 = mockDb.rows.get(20);
  testAssert(dbRecord20?.status === 'ARMED', 'Decision #20 successfully promoted to ARMED after 42703 self-heal');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Promotion Rejection Informative Message (Not Masked as Success)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 6] Verifying rejection reporting integrity...');
  // Seed an already-invalidated decision (market price breached stop loss)
  mockDb.rows.set(25, {
    id: 25,
    symbol: 'ETHUSDC',
    agent_id: 'trend_continuation_sniper',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2450.0,
    entry_range_high: 2460.0,
    limit_entry_price: 2455.0,
    invalidation_level: 2480.0, // breached because current price is 2470 (for Long, SL > live price is breached)
    target_1: 2550.0,
    target_2: 2600.0,
    status: 'LOGGED_STANDBY',
    execution_mode: 'STANDBY',
    submitted_at: Date.now(),
    created_at: new Date().toISOString(),
  });

  const rejectedPromo = await dispatcher.promoteStandbyToMode(25, 'PAPER_TRADING');
  testAssert(rejectedPromo.success === false, 'promoteStandbyToMode correctly returns success: false on invalid setup');
  testAssert(!rejectedPromo.message.includes('successfully promoted'), 'Message does NOT claim success on rejection');
  testAssert(rejectedPromo.message.includes('breached') || rejectedPromo.message.includes('rejected') || rejectedPromo.message.includes('Veto'), 'Message contains informative rejection reason');

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Telegram Bot Feedback Harmonization (Workstream C)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 7] Verifying Telegram callback user feedback format...');
  let editedMessages: { text: string; options?: any }[] = [];
  const mockNotifier = new TelegramNotifier({
    enabled: true,
    botToken: 'TEST_BOT_TOKEN',
    chatId: '12345678',
  });
  mockNotifier.editMessageText = async (_chatId: string | number, _msgId: number, text: string, options?: any) => {
    editedMessages.push({ text, options });
    return true;
  };
  mockNotifier.sendRawMessage = async (msg: string, options?: any) => {
    editedMessages.push({ text: msg, options });
    return true;
  };
  mockNotifier.answerCallbackQuery = async () => true;

  // Seed distinct setup #19 in DB
  mockDb.rows.set(19, {
    id: 19,
    symbol: 'ETHUSDC',
    agent_id: 'trend_continuation_sniper',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2440.0,
    entry_range_high: 2450.0,
    limit_entry_price: 2445.0,
    invalidation_level: 2410.0,
    target_1: 2500.0,
    target_2: 2550.0,
    status: 'LOGGED_STANDBY',
    execution_mode: 'STANDBY',
    submitted_at: Date.now(),
    created_at: new Date().toISOString(),
  });

  const botService = new TelegramBotService(
    {
      engine,
      ledger,
      sparkDispatcher: dispatcher,
      symbol: 'ETHUSDC',
      equity: 10000,
      isDryRun: false,
      bootTimestamp: Date.now(),
      wsClient: {
        getLatestPrice: () => 2470.0,
        getStatus: () => 'OPEN',
      } as any,
    },
    mockNotifier
  );

  await (botService as any).processIncomingCallbackQuery({
    id: 'cb_promote_19',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 201, chat: { id: 12345678 } },
    data: 'paper_trade_19',
  });

  const lastEdit = editedMessages[editedMessages.length - 1];
  testAssert(lastEdit !== undefined, 'Telegram response message generated');
  testAssert(
    lastEdit.text.includes('PROMOTED TO PAPER TRADING'),
    "Message contains 'PROMOTED TO PAPER TRADING' header"
  );
  testAssert(
    lastEdit.text.includes('Setup #<code>19</code> is now <b>ARMED</b>'),
    "Message contains 'Setup #19 is now ARMED' affirmation"
  );
  testAssert(
    lastEdit.text.includes('Simulated limit placed at <b>$2445.00</b>'),
    "Message states 'Simulated limit placed at $2445.00'"
  );

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: File-based Fallback Command Routing Contract
  // ──────────────────────────────────────────────────────────────────────────
  console.log('▶ [TEST 8] Verifying file-based command router fallback (daemon_commands.json)...');
  const botServiceStandalone = new TelegramBotService(
    {
      engine,
      ledger,
      symbol: 'ETHUSDC',
      equity: 10000,
      isDryRun: false,
      bootTimestamp: Date.now(),
      wsClient: {
        getLatestPrice: () => 2455.0,
        getStatus: () => 'OPEN',
      } as any,
    },
    mockNotifier
  );

  const fallbackDecisionId = 888;
  mockDb.rows.set(fallbackDecisionId, {
    id: fallbackDecisionId,
    symbol: 'ETHUSDC',
    agent_id: 'spark_bot',
    bias_signal: 'CONFIRMED_BULLISH',
    entry_range_low: 2450.0,
    entry_range_high: 2460.0,
    limit_entry_price: 2455.0,
    invalidation_level: 2420.0,
    target_1: 2500.0,
    target_2: 2550.0,
    status: 'LOGGED_STANDBY',
    execution_mode: 'STANDBY',
    submitted_at: Date.now(),
    created_at: new Date().toISOString(),
  });

  await (botServiceStandalone as any).processIncomingCallbackQuery({
    id: 'cb_promote_888',
    from: { id: 12345678, first_name: 'Trader' },
    message: { message_id: 202, chat: { id: 12345678 } },
    data: `paper_trade_${fallbackDecisionId}`,
  });

  const cmdFilePath = path.join(process.cwd(), 'run_logs', 'daemon_commands.json');
  testAssert(fs.existsSync(cmdFilePath), 'daemon_commands.json exists on disk');
  const commands = JSON.parse(fs.readFileSync(cmdFilePath, 'utf8'));
  const targetCmd = commands.find((c: any) => c.decisionId === fallbackDecisionId && c.action === 'PROMOTE_STANDBY');
  testAssert(targetCmd !== undefined, 'Command for decision #888 queued in file');
  testAssert(targetCmd.targetMode === 'PAPER_TRADING', 'Command targetMode is PAPER_TRADING');

  // Reset db pool to default
  setDbPool(null);

  console.log('\n======================================================================');
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} PROMOTION PIPELINE TESTS PASSED CLEANLY!`);
  } else {
    console.error(`💥 ${failed} TESTS FAILED! (${passed} passed)`);
    process.exit(1);
  }
  console.log('======================================================================');
}

runPromotionPipelineTests().catch((err) => {
  console.error('[TEST_FATAL_ERROR]', err);
  process.exit(1);
});

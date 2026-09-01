import fs from 'fs/promises';
import path from 'path';
import { SweepReclaimSetup, SweepReclaimTelemetrySummary } from '@/lib/quantEngine/SweepReclaimEngine';
import { InstitutionalOrderBlock, OrderBlockTelemetrySummary } from '@/lib/quantEngine/OrderBlockEngine';
import { ScannerPreset } from '@/lib/quantEngine/scannerPresets';

// Base directory for all 100% Local Quant Lab JSON file storage
const BASE_QUANT_LAB_DIR = path.join(process.cwd(), 'data', 'quant_lab');
const SR_SCANS_DIR = path.join(BASE_QUANT_LAB_DIR, 'sr_scans');
const OB_SCANS_DIR = path.join(BASE_QUANT_LAB_DIR, 'ob_scans');
const RUNS_DIR = path.join(BASE_QUANT_LAB_DIR, 'runs');
const PRESETS_DIR = path.join(BASE_QUANT_LAB_DIR, 'presets');

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists or can't be created
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SWEEP & RECLAIM LOCAL SCAN STORE
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalSrScan {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  sweep_rate_pct: number;
  reclaim_rate_pct: number;
  retest_rate_pct: number;
  retest_win_rate_pct: number;
  avg_realized_rr: number;
  profit_factor: number;
  telemetry_summary: SweepReclaimTelemetrySummary;
  setups: SweepReclaimSetup[];
  created_at: string;
}

export interface LocalSrScanSummary {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  sweep_rate_pct: number;
  reclaim_rate_pct: number;
  retest_rate_pct: number;
  retest_win_rate_pct: number;
  avg_realized_rr: number;
  profit_factor: number;
  telemetry_summary: SweepReclaimTelemetrySummary;
  created_at: string;
}

export async function saveLocalSrScan(scan: LocalSrScan): Promise<void> {
  await ensureDir(SR_SCANS_DIR);
  const filePath = path.join(SR_SCANS_DIR, `${scan.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(scan, null, 2), 'utf8');
}

export async function listLocalSrScans(limit = 50, offset = 0): Promise<{ scans: LocalSrScanSummary[]; total: number }> {
  await ensureDir(SR_SCANS_DIR);
  try {
    const files = await fs.readdir(SR_SCANS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'index.json');
    
    const summaries: LocalSrScanSummary[] = [];

    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(SR_SCANS_DIR, f), 'utf8');
        const parsed: LocalSrScan = JSON.parse(content);
        const { setups, ...summary } = parsed;
        summaries.push(summary);
      } catch (err) {
        console.warn(`[LOCAL SCAN STORE] Failed to parse SR scan file ${f}:`, err);
      }
    }

    // Sort descending by created_at
    summaries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = summaries.length;
    const paginated = summaries.slice(offset, offset + limit);

    return { scans: paginated, total };
  } catch (err) {
    console.error('[LOCAL SCAN STORE] Failed to list SR scans:', err);
    return { scans: [], total: 0 };
  }
}

export async function getLocalSrScanById(id: string): Promise<LocalSrScan | null> {
  await ensureDir(SR_SCANS_DIR);
  const filePath = path.join(SR_SCANS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as LocalSrScan;
  } catch {
    return null;
  }
}

export async function deleteLocalSrScan(id: string): Promise<boolean> {
  await ensureDir(SR_SCANS_DIR);
  const filePath = path.join(SR_SCANS_DIR, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ORDER BLOCK LOCAL SCAN STORE
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalObScan {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  validation_rate_pct: number;
  mt_reaction_rate_pct: number;
  mitigation_win_rate_pct: number;
  avg_rr_tp1: number;
  avg_rr_tp2: number;
  telemetry_summary: OrderBlockTelemetrySummary;
  order_blocks: InstitutionalOrderBlock[];
  created_at: string;
}

export interface LocalObScanSummary {
  id: string;
  scan_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_detected: number;
  validation_rate_pct: number;
  mt_reaction_rate_pct: number;
  mitigation_win_rate_pct: number;
  avg_rr_tp1: number;
  avg_rr_tp2: number;
  telemetry_summary: OrderBlockTelemetrySummary;
  created_at: string;
}

export async function saveLocalObScan(scan: LocalObScan): Promise<void> {
  await ensureDir(OB_SCANS_DIR);
  const filePath = path.join(OB_SCANS_DIR, `${scan.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(scan, null, 2), 'utf8');
}

export async function listLocalObScans(limit = 50, offset = 0): Promise<{ scans: LocalObScanSummary[]; total: number }> {
  await ensureDir(OB_SCANS_DIR);
  try {
    const files = await fs.readdir(OB_SCANS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'index.json');
    
    const summaries: LocalObScanSummary[] = [];

    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(OB_SCANS_DIR, f), 'utf8');
        const parsed: LocalObScan = JSON.parse(content);
        const { order_blocks, ...summary } = parsed;
        summaries.push(summary);
      } catch (err) {
        console.warn(`[LOCAL SCAN STORE] Failed to parse OB scan file ${f}:`, err);
      }
    }

    summaries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = summaries.length;
    const paginated = summaries.slice(offset, offset + limit);

    return { scans: paginated, total };
  } catch (err) {
    console.error('[LOCAL SCAN STORE] Failed to list OB scans:', err);
    return { scans: [], total: 0 };
  }
}

export async function getLocalObScanById(id: string): Promise<LocalObScan | null> {
  await ensureDir(OB_SCANS_DIR);
  const filePath = path.join(OB_SCANS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as LocalObScan;
  } catch {
    return null;
  }
}

export async function deleteLocalObScan(id: string): Promise<boolean> {
  await ensureDir(OB_SCANS_DIR);
  const filePath = path.join(OB_SCANS_DIR, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HISTORICAL STRATEGY RUNS LOCAL STORE
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalStrategyRun {
  id: string;
  name: string;
  symbol: string;
  strategy_config: any;
  start_date: string;
  end_date: string;
  initial_balance: number;
  final_balance: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  total_pnl: number;
  trades?: any[];
  created_at: string;
}

export async function saveLocalStrategyRun(run: LocalStrategyRun): Promise<void> {
  await ensureDir(RUNS_DIR);
  const filePath = path.join(RUNS_DIR, `${run.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(run, null, 2), 'utf8');
}

export async function listLocalStrategyRuns(limit = 50, offset = 0): Promise<{ runs: any[]; total: number }> {
  await ensureDir(RUNS_DIR);
  try {
    const files = await fs.readdir(RUNS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    const summaries: any[] = [];

    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(RUNS_DIR, f), 'utf8');
        const parsed: LocalStrategyRun = JSON.parse(content);
        const { trades, strategy_config, ...summary } = parsed;
        summaries.push(summary);
      } catch (err) {
        console.warn(`[LOCAL SCAN STORE] Failed to parse run file ${f}:`, err);
      }
    }

    summaries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = summaries.length;
    const paginated = summaries.slice(offset, offset + limit);

    return { runs: paginated, total };
  } catch (err) {
    console.error('[LOCAL SCAN STORE] Failed to list strategy runs:', err);
    return { runs: [], total: 0 };
  }
}

export async function getLocalStrategyRunById(id: string): Promise<LocalStrategyRun | null> {
  await ensureDir(RUNS_DIR);
  const filePath = path.join(RUNS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as LocalStrategyRun;
  } catch {
    return null;
  }
}

export async function deleteLocalStrategyRun(id: string): Promise<boolean> {
  await ensureDir(RUNS_DIR);
  const filePath = path.join(RUNS_DIR, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SCANNER PRESETS LOCAL STORE
// ─────────────────────────────────────────────────────────────────────────────

export async function saveLocalPreset(preset: ScannerPreset, userId = 'local'): Promise<void> {
  await ensureDir(PRESETS_DIR);
  const userDir = path.join(PRESETS_DIR, userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  await ensureDir(userDir);
  const filePath = path.join(userDir, `${preset.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(preset, null, 2), 'utf8');
}

export async function listLocalPresets(strategyType?: string, userId = 'local'): Promise<ScannerPreset[]> {
  await ensureDir(PRESETS_DIR);
  const userDir = path.join(PRESETS_DIR, userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  await ensureDir(userDir);

  try {
    const files = await fs.readdir(userDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const presets: ScannerPreset[] = [];

    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(userDir, f), 'utf8');
        const p: ScannerPreset = JSON.parse(content);
        if (!strategyType || p.strategyType === strategyType) {
          presets.push(p);
        }
      } catch (err) {
        console.warn(`[LOCAL SCAN STORE] Failed to parse preset file ${f}:`, err);
      }
    }

    presets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return presets;
  } catch (err) {
    return [];
  }
}

export async function deleteLocalPreset(id: string, userId = 'local'): Promise<boolean> {
  await ensureDir(PRESETS_DIR);
  const userDir = path.join(PRESETS_DIR, userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const filePath = path.join(userDir, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

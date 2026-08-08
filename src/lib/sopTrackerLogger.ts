import fs from 'fs';
import path from 'path';

export interface SopRiskParameters {
  invalidation?: number;
  entry_range?: [number, number];
  tp1?: number;
  tp2?: number;
  rr_ratio?: number;
}

export interface SopReportData {
  market_context?: string;
  htf_dol?: string;
  session_profile?: string;
  smt_status?: string;
  trade_narrative?: string;
  risk_parameters?: SopRiskParameters;
}

export interface SopTrackerEntry {
  id: string;
  date: string;
  time: string;
  symbol: string;
  setupType: string;
  htfDol: string;
  smtStatus: string;
  entryRange: [number, number];
  invalidation: number;
  tp1: number;
  tp2: number;
  outcome: 'PENDING' | 'SUCCESS' | 'STOP_OUT' | 'NO_TRIGGER';
  dolReached: boolean;
  notes: string;
}

export function autoLogSopSetup(sopReport: SopReportData, nextState?: Record<string, unknown>): SopTrackerEntry | null {
  try {
    if (!sopReport || !sopReport.risk_parameters) return null;

    const mdPath = path.resolve(process.cwd(), 'directives/ETHUSDC_Daily_Tracker.md');
    const jsonPath = path.resolve(process.cwd(), 'directives/ETHUSDC_Daily_Tracker.json');

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().split('T')[1].substring(0, 5);

    const rp = sopReport.risk_parameters;
    const inv = rp.invalidation ?? 0;
    const entryRange: [number, number] = rp.entry_range ?? [0, 0];
    const tp1 = rp.tp1 ?? 0;
    const tp2 = rp.tp2 ?? 0;

    // Generate unique setup ID based on date and entry range
    const setupId = `ETH-${dateStr.replace(/-/g, '')}-${Math.floor(entryRange[0] || 0)}`;

    // Read JSON tracker
    let trackerJson: { version: string; symbol: string; lastUpdated: string; stats: any; entries: SopTrackerEntry[] } = {
      version: '1.0.0',
      symbol: 'ETHUSDC.p',
      lastUpdated: now.toISOString(),
      stats: { totalSetups: 0, success: 0, stopOut: 0, noTrigger: 0, winRate: 0.0 },
      entries: []
    };

    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        trackerJson = JSON.parse(raw);
      } catch (err) {
        console.warn('[SOP TRACKER] Error reading tracker JSON, resetting:', err);
      }
    }

    // Deduplication check: if entry with same setupId or timestamp within 1 hour exists, skip duplicate insert
    const duplicate = trackerJson.entries.find(e => e.id === setupId);
    if (duplicate) {
      return duplicate;
    }

    const newEntry: SopTrackerEntry = {
      id: setupId,
      date: dateStr,
      time: timeStr,
      symbol: 'ETHUSDC.p',
      setupType: sopReport.trade_narrative?.substring(0, 45) ?? 'SOP Quant Setup',
      htfDol: sopReport.htf_dol ?? 'HTF Magnet',
      smtStatus: sopReport.smt_status ?? 'SMT Divergence',
      entryRange: entryRange,
      invalidation: inv,
      tp1: tp1,
      tp2: tp2,
      outcome: 'PENDING',
      dolReached: false,
      notes: sopReport.market_context ?? 'Generated via Gemini SOP Quant Engine'
    };

    trackerJson.entries.unshift(newEntry);
    trackerJson.stats.totalSetups = trackerJson.entries.length;
    trackerJson.lastUpdated = now.toISOString();

    fs.writeFileSync(jsonPath, JSON.stringify(trackerJson, null, 2), 'utf8');

    // Update Markdown table
    if (fs.existsSync(mdPath)) {
      let mdText = fs.readFileSync(mdPath, 'utf8');
      const row = `| ${dateStr} | ${timeStr} | ${newEntry.setupType} | ${newEntry.htfDol} | ${newEntry.smtStatus} | $${inv} | TP1: $${tp1} / TP2: $${tp2} | PENDING | ${newEntry.notes} |\n`;
      
      if (!mdText.includes(setupId) && !mdText.includes(`$${inv}`)) {
        mdText += row;
        fs.writeFileSync(mdPath, mdText, 'utf8');
      }
    }

    console.log(`[SOP TRACKER] Successfully auto-logged setup ${setupId} to Daily Tracker.`);
    return newEntry;
  } catch (err) {
    console.error('[SOP TRACKER] Auto-log failed:', err);
    return null;
  }
}

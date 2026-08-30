import fs from 'fs';
import path from 'path';

export interface MacroNewsEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time_utc: string; // HH:MM
  timestamp_ms: number;
  category: 'FOMC' | 'CPI' | 'PCE' | 'PPI' | 'NFP' | 'GDP' | 'PMI' | 'RETAIL_SALES';
  event_name: string;
  impact: 'HIGH';
  currency: 'USD';
}

export function generateCuratedMacroCalendar(): MacroNewsEvent[] {
  const events: MacroNewsEvent[] = [];

  function addEvent(
    date: string,
    time_utc: string,
    category: MacroNewsEvent['category'],
    event_name: string
  ) {
    const isoString = `${date}T${time_utc}:00.000Z`;
    const timestamp_ms = new Date(isoString).getTime();
    const id = `${category}_${date.replace(/-/g, '')}_${time_utc.replace(':', '')}`;
    events.push({
      id,
      date,
      time_utc,
      timestamp_ms,
      category,
      event_name,
      impact: 'HIGH',
      currency: 'USD',
    });
  }

  // 1. FOMC Rate Decisions & Press Conferences
  const fomcMeetings = [
    { date: '2024-09-18', time: '18:00', name: 'FOMC Rate Decision (-50 bps cut)' },
    { date: '2024-09-18', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2024-11-07', time: '19:00', name: 'FOMC Rate Decision (-25 bps cut)' },
    { date: '2024-11-07', time: '19:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2024-12-18', time: '19:00', name: 'FOMC Rate Decision (-25 bps cut) & Economic Projections' },
    { date: '2024-12-18', time: '19:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-01-29', time: '19:00', name: 'FOMC Rate Decision' },
    { date: '2025-01-29', time: '19:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-03-19', time: '18:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2025-03-19', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-05-07', time: '18:00', name: 'FOMC Rate Decision' },
    { date: '2025-05-07', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-06-18', time: '18:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2025-06-18', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-07-30', time: '18:00', name: 'FOMC Rate Decision' },
    { date: '2025-07-30', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-09-17', time: '18:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2025-09-17', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-10-29', time: '18:00', name: 'FOMC Rate Decision' },
    { date: '2025-10-29', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2025-12-10', time: '19:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2025-12-10', time: '19:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2026-01-28', time: '19:00', name: 'FOMC Rate Decision' },
    { date: '2026-01-28', time: '19:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2026-03-18', time: '18:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2026-03-18', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2026-05-06', time: '18:00', name: 'FOMC Rate Decision' },
    { date: '2026-05-06', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2026-06-17', time: '18:00', name: 'FOMC Rate Decision & Economic Projections' },
    { date: '2026-06-17', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
    { date: '2026-07-29', time: '18:00', name: 'FOMC Rate Decision' },
    { date: '2026-07-29', time: '18:30', name: 'FOMC Press Conference (Jerome Powell)' },
  ];
  fomcMeetings.forEach((m) => addEvent(m.date, m.time, 'FOMC', m.name));

  // FOMC Minutes
  const fomcMinutes = [
    { date: '2024-10-09', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2024-11-26', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-01-08', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-02-19', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-04-09', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-05-28', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-07-09', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-08-20', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-10-08', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-11-19', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2025-12-30', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2026-02-18', time: '19:00', name: 'FOMC Meeting Minutes' },
    { date: '2026-04-08', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2026-05-27', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2026-07-08', time: '18:00', name: 'FOMC Meeting Minutes' },
    { date: '2026-08-19', time: '18:00', name: 'FOMC Meeting Minutes' },
  ];
  fomcMinutes.forEach((m) => addEvent(m.date, m.time, 'FOMC', m.name));

  // 2. CPI
  const cpiReleases = [
    { date: '2024-09-11', time: '12:30', name: 'US CPI & Core CPI (Aug)' },
    { date: '2024-10-10', time: '12:30', name: 'US CPI & Core CPI (Sep)' },
    { date: '2024-11-13', time: '13:30', name: 'US CPI & Core CPI (Oct)' },
    { date: '2024-12-11', time: '13:30', name: 'US CPI & Core CPI (Nov)' },
    { date: '2025-01-15', time: '13:30', name: 'US CPI & Core CPI (Dec)' },
    { date: '2025-02-12', time: '13:30', name: 'US CPI & Core CPI (Jan)' },
    { date: '2025-03-12', time: '12:30', name: 'US CPI & Core CPI (Feb)' },
    { date: '2025-04-10', time: '12:30', name: 'US CPI & Core CPI (Mar)' },
    { date: '2025-05-13', time: '12:30', name: 'US CPI & Core CPI (Apr)' },
    { date: '2025-06-11', time: '12:30', name: 'US CPI & Core CPI (May)' },
    { date: '2025-07-11', time: '12:30', name: 'US CPI & Core CPI (Jun)' },
    { date: '2025-08-12', time: '12:30', name: 'US CPI & Core CPI (Jul)' },
    { date: '2025-09-10', time: '12:30', name: 'US CPI & Core CPI (Aug)' },
    { date: '2025-10-14', time: '12:30', name: 'US CPI & Core CPI (Sep)' },
    { date: '2025-11-12', time: '13:30', name: 'US CPI & Core CPI (Oct)' },
    { date: '2025-12-10', time: '13:30', name: 'US CPI & Core CPI (Nov)' },
    { date: '2026-01-14', time: '13:30', name: 'US CPI & Core CPI (Dec)' },
    { date: '2026-02-11', time: '13:30', name: 'US CPI & Core CPI (Jan)' },
    { date: '2026-03-11', time: '12:30', name: 'US CPI & Core CPI (Feb)' },
    { date: '2026-04-14', time: '12:30', name: 'US CPI & Core CPI (Mar)' },
    { date: '2026-05-12', time: '12:30', name: 'US CPI & Core CPI (Apr)' },
    { date: '2026-06-10', time: '12:30', name: 'US CPI & Core CPI (May)' },
    { date: '2026-07-14', time: '12:30', name: 'US CPI & Core CPI (Jun)' },
    { date: '2026-08-12', time: '12:30', name: 'US CPI & Core CPI (Jul)' },
  ];
  cpiReleases.forEach((c) => addEvent(c.date, c.time, 'CPI', c.name));

  // 3. PCE
  const pceReleases = [
    { date: '2024-08-30', time: '12:30', name: 'US Core PCE Price Index (Jul)' },
    { date: '2024-09-27', time: '12:30', name: 'US Core PCE Price Index (Aug)' },
    { date: '2024-10-31', time: '12:30', name: 'US Core PCE Price Index (Sep)' },
    { date: '2024-11-27', time: '13:30', name: 'US Core PCE Price Index (Oct)' },
    { date: '2024-12-20', time: '13:30', name: 'US Core PCE Price Index (Nov)' },
    { date: '2025-01-31', time: '13:30', name: 'US Core PCE Price Index (Dec)' },
    { date: '2025-02-28', time: '13:30', name: 'US Core PCE Price Index (Jan)' },
    { date: '2025-03-28', time: '12:30', name: 'US Core PCE Price Index (Feb)' },
    { date: '2025-04-30', time: '12:30', name: 'US Core PCE Price Index (Mar)' },
    { date: '2025-05-30', time: '12:30', name: 'US Core PCE Price Index (Apr)' },
    { date: '2025-06-27', time: '12:30', name: 'US Core PCE Price Index (May)' },
    { date: '2025-07-31', time: '12:30', name: 'US Core PCE Price Index (Jun)' },
    { date: '2025-08-29', time: '12:30', name: 'US Core PCE Price Index (Jul)' },
    { date: '2025-09-26', time: '12:30', name: 'US Core PCE Price Index (Aug)' },
    { date: '2025-10-31', time: '12:30', name: 'US Core PCE Price Index (Sep)' },
    { date: '2025-11-26', time: '13:30', name: 'US Core PCE Price Index (Oct)' },
    { date: '2025-12-23', time: '13:30', name: 'US Core PCE Price Index (Nov)' },
    { date: '2026-01-30', time: '13:30', name: 'US Core PCE Price Index (Dec)' },
    { date: '2026-02-27', time: '13:30', name: 'US Core PCE Price Index (Jan)' },
    { date: '2026-03-27', time: '12:30', name: 'US Core PCE Price Index (Feb)' },
    { date: '2026-04-30', time: '12:30', name: 'US Core PCE Price Index (Mar)' },
    { date: '2026-05-29', time: '12:30', name: 'US Core PCE Price Index (Apr)' },
    { date: '2026-06-26', time: '12:30', name: 'US Core PCE Price Index (May)' },
    { date: '2026-07-31', time: '12:30', name: 'US Core PCE Price Index (Jun)' },
  ];
  pceReleases.forEach((p) => addEvent(p.date, p.time, 'PCE', p.name));

  // 4. PPI
  const ppiReleases = [
    { date: '2024-09-12', time: '12:30', name: 'US PPI & Core PPI (Aug)' },
    { date: '2024-10-11', time: '12:30', name: 'US PPI & Core PPI (Sep)' },
    { date: '2024-11-14', time: '13:30', name: 'US PPI & Core PPI (Oct)' },
    { date: '2024-12-12', time: '13:30', name: 'US PPI & Core PPI (Nov)' },
    { date: '2025-01-14', time: '13:30', name: 'US PPI & Core PPI (Dec)' },
    { date: '2025-02-13', time: '13:30', name: 'US PPI & Core PPI (Jan)' },
    { date: '2025-03-13', time: '12:30', name: 'US PPI & Core PPI (Feb)' },
    { date: '2025-04-11', time: '12:30', name: 'US PPI & Core PPI (Mar)' },
    { date: '2025-05-14', time: '12:30', name: 'US PPI & Core PPI (Apr)' },
    { date: '2025-06-12', time: '12:30', name: 'US PPI & Core PPI (May)' },
    { date: '2025-07-15', time: '12:30', name: 'US PPI & Core PPI (Jun)' },
    { date: '2025-08-13', time: '12:30', name: 'US PPI & Core PPI (Jul)' },
    { date: '2025-09-11', time: '12:30', name: 'US PPI & Core PPI (Aug)' },
    { date: '2025-10-15', time: '12:30', name: 'US PPI & Core PPI (Sep)' },
    { date: '2025-11-13', time: '13:30', name: 'US PPI & Core PPI (Oct)' },
    { date: '2025-12-11', time: '13:30', name: 'US PPI & Core PPI (Nov)' },
    { date: '2026-01-15', time: '13:30', name: 'US PPI & Core PPI (Dec)' },
    { date: '2026-02-12', time: '13:30', name: 'US PPI & Core PPI (Jan)' },
    { date: '2026-03-12', time: '12:30', name: 'US PPI & Core PPI (Feb)' },
    { date: '2026-04-15', time: '12:30', name: 'US PPI & Core PPI (Mar)' },
    { date: '2026-05-13', time: '12:30', name: 'US PPI & Core PPI (Apr)' },
    { date: '2026-06-11', time: '12:30', name: 'US PPI & Core PPI (May)' },
    { date: '2026-07-15', time: '12:30', name: 'US PPI & Core PPI (Jun)' },
    { date: '2026-08-13', time: '12:30', name: 'US PPI & Core PPI (Jul)' },
  ];
  ppiReleases.forEach((p) => addEvent(p.date, p.time, 'PPI', p.name));

  // 5. NFP
  const nfpReleases = [
    { date: '2024-09-06', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Aug)' },
    { date: '2024-10-04', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Sep)' },
    { date: '2024-11-01', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Oct)' },
    { date: '2024-12-06', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Nov)' },
    { date: '2025-01-10', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Dec)' },
    { date: '2025-02-07', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jan)' },
    { date: '2025-03-07', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Feb)' },
    { date: '2025-04-04', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Mar)' },
    { date: '2025-05-02', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Apr)' },
    { date: '2025-06-06', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (May)' },
    { date: '2025-07-03', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jun)' },
    { date: '2025-08-01', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jul)' },
    { date: '2025-09-05', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Aug)' },
    { date: '2025-10-03', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Sep)' },
    { date: '2025-11-07', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Oct)' },
    { date: '2025-12-05', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Nov)' },
    { date: '2026-01-09', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Dec)' },
    { date: '2026-02-06', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jan)' },
    { date: '2026-03-06', time: '13:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Feb)' },
    { date: '2026-04-03', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Mar)' },
    { date: '2026-05-08', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Apr)' },
    { date: '2026-06-05', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (May)' },
    { date: '2026-07-02', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jun)' },
    { date: '2026-08-07', time: '12:30', name: 'US Non-Farm Payrolls & Unemployment Rate (Jul)' },
  ];
  nfpReleases.forEach((n) => addEvent(n.date, n.time, 'NFP', n.name));

  // 6. GDP
  const gdpReleases = [
    { date: '2024-08-29', time: '12:30', name: 'US GDP Prelim (Q2 2024)' },
    { date: '2024-09-26', time: '12:30', name: 'US GDP Final (Q2 2024)' },
    { date: '2024-10-30', time: '12:30', name: 'US GDP Advance (Q3 2024)' },
    { date: '2024-11-27', time: '13:30', name: 'US GDP Prelim (Q3 2024)' },
    { date: '2024-12-19', time: '13:30', name: 'US GDP Final (Q3 2024)' },
    { date: '2025-01-30', time: '13:30', name: 'US GDP Advance (Q4 2024)' },
    { date: '2025-02-27', time: '13:30', name: 'US GDP Prelim (Q4 2024)' },
    { date: '2025-03-27', time: '12:30', name: 'US GDP Final (Q4 2024)' },
    { date: '2025-04-24', time: '12:30', name: 'US GDP Advance (Q1 2025)' },
    { date: '2025-05-29', time: '12:30', name: 'US GDP Prelim (Q1 2025)' },
    { date: '2025-06-26', time: '12:30', name: 'US GDP Final (Q1 2025)' },
    { date: '2025-07-24', time: '12:30', name: 'US GDP Advance (Q2 2025)' },
    { date: '2025-08-28', time: '12:30', name: 'US GDP Prelim (Q2 2025)' },
    { date: '2025-09-25', time: '12:30', name: 'US GDP Final (Q2 2025)' },
    { date: '2025-10-30', time: '12:30', name: 'US GDP Advance (Q3 2025)' },
    { date: '2025-11-26', time: '13:30', name: 'US GDP Prelim (Q3 2025)' },
    { date: '2025-12-18', time: '13:30', name: 'US GDP Final (Q3 2025)' },
    { date: '2026-01-29', time: '13:30', name: 'US GDP Advance (Q4 2025)' },
    { date: '2026-02-26', time: '13:30', name: 'US GDP Prelim (Q4 2025)' },
    { date: '2026-03-26', time: '12:30', name: 'US GDP Final (Q4 2025)' },
    { date: '2026-04-30', time: '12:30', name: 'US GDP Advance (Q1 2026)' },
    { date: '2026-05-28', time: '12:30', name: 'US GDP Prelim (Q1 2026)' },
    { date: '2026-06-25', time: '12:30', name: 'US GDP Final (Q1 2026)' },
    { date: '2026-07-30', time: '12:30', name: 'US GDP Advance (Q2 2026)' },
  ];
  gdpReleases.forEach((g) => addEvent(g.date, g.time, 'GDP', g.name));

  // 7. PMI
  const pmiReleases = [
    { date: '2024-09-03', time: '14:00', name: 'US ISM Manufacturing PMI (Aug)' },
    { date: '2024-09-05', time: '14:00', name: 'US ISM Services PMI (Aug)' },
    { date: '2024-10-01', time: '14:00', name: 'US ISM Manufacturing PMI (Sep)' },
    { date: '2024-10-03', time: '14:00', name: 'US ISM Services PMI (Sep)' },
    { date: '2024-11-01', time: '14:00', name: 'US ISM Manufacturing PMI (Oct)' },
    { date: '2024-11-05', time: '15:00', name: 'US ISM Services PMI (Oct)' },
    { date: '2024-12-02', time: '15:00', name: 'US ISM Manufacturing PMI (Nov)' },
    { date: '2024-12-04', time: '15:00', name: 'US ISM Services PMI (Nov)' },
    { date: '2025-01-03', time: '15:00', name: 'US ISM Manufacturing PMI (Dec)' },
    { date: '2025-01-07', time: '15:00', name: 'US ISM Services PMI (Dec)' },
    { date: '2025-02-03', time: '15:00', name: 'US ISM Manufacturing PMI (Jan)' },
    { date: '2025-02-05', time: '15:00', name: 'US ISM Services PMI (Jan)' },
    { date: '2025-03-03', time: '15:00', name: 'US ISM Manufacturing PMI (Feb)' },
    { date: '2025-03-05', time: '15:00', name: 'US ISM Services PMI (Feb)' },
    { date: '2025-04-01', time: '14:00', name: 'US ISM Manufacturing PMI (Mar)' },
    { date: '2025-04-03', time: '14:00', name: 'US ISM Services PMI (Mar)' },
    { date: '2025-05-01', time: '14:00', name: 'US ISM Manufacturing PMI (Apr)' },
    { date: '2025-05-05', time: '14:00', name: 'US ISM Services PMI (Apr)' },
    { date: '2025-06-02', time: '14:00', name: 'US ISM Manufacturing PMI (May)' },
    { date: '2025-06-04', time: '14:00', name: 'US ISM Services PMI (May)' },
    { date: '2025-07-01', time: '14:00', name: 'US ISM Manufacturing PMI (Jun)' },
    { date: '2025-07-03', time: '14:00', name: 'US ISM Services PMI (Jun)' },
    { date: '2025-08-01', time: '14:00', name: 'US ISM Manufacturing PMI (Jul)' },
    { date: '2025-08-05', time: '14:00', name: 'US ISM Services PMI (Jul)' },
    { date: '2025-09-02', time: '14:00', name: 'US ISM Manufacturing PMI (Aug)' },
    { date: '2025-09-04', time: '14:00', name: 'US ISM Services PMI (Aug)' },
    { date: '2025-10-01', time: '14:00', name: 'US ISM Manufacturing PMI (Sep)' },
    { date: '2025-10-03', time: '14:00', name: 'US ISM Services PMI (Sep)' },
    { date: '2025-11-03', time: '15:00', name: 'US ISM Manufacturing PMI (Oct)' },
    { date: '2025-11-05', time: '15:00', name: 'US ISM Services PMI (Oct)' },
    { date: '2025-12-01', time: '15:00', name: 'US ISM Manufacturing PMI (Nov)' },
    { date: '2025-12-03', time: '15:00', name: 'US ISM Services PMI (Nov)' },
    { date: '2026-01-02', time: '15:00', name: 'US ISM Manufacturing PMI (Dec)' },
    { date: '2026-01-06', time: '15:00', name: 'US ISM Services PMI (Dec)' },
    { date: '2026-02-02', time: '15:00', name: 'US ISM Manufacturing PMI (Jan)' },
    { date: '2026-02-04', time: '15:00', name: 'US ISM Services PMI (Jan)' },
    { date: '2026-03-02', time: '15:00', name: 'US ISM Manufacturing PMI (Feb)' },
    { date: '2026-03-04', time: '15:00', name: 'US ISM Services PMI (Feb)' },
    { date: '2026-04-01', time: '14:00', name: 'US ISM Manufacturing PMI (Mar)' },
    { date: '2026-04-03', time: '14:00', name: 'US ISM Services PMI (Mar)' },
    { date: '2026-05-01', time: '14:00', name: 'US ISM Manufacturing PMI (Apr)' },
    { date: '2026-05-05', time: '14:00', name: 'US ISM Services PMI (Apr)' },
    { date: '2026-06-01', time: '14:00', name: 'US ISM Manufacturing PMI (May)' },
    { date: '2026-06-03', time: '14:00', name: 'US ISM Services PMI (May)' },
    { date: '2026-07-01', time: '14:00', name: 'US ISM Manufacturing PMI (Jun)' },
    { date: '2026-07-06', time: '14:00', name: 'US ISM Services PMI (Jun)' },
    { date: '2026-08-03', time: '14:00', name: 'US ISM Manufacturing PMI (Jul)' },
    { date: '2026-08-05', time: '14:00', name: 'US ISM Services PMI (Jul)' },
  ];
  pmiReleases.forEach((p) => addEvent(p.date, p.time, 'PMI', p.name));

  // 8. Retail Sales
  const retailSales = [
    { date: '2024-09-17', time: '12:30', name: 'US Retail Sales (Aug)' },
    { date: '2024-10-17', time: '12:30', name: 'US Retail Sales (Sep)' },
    { date: '2024-11-15', time: '13:30', name: 'US Retail Sales (Oct)' },
    { date: '2024-12-13', time: '13:30', name: 'US Retail Sales (Nov)' },
    { date: '2025-01-16', time: '13:30', name: 'US Retail Sales (Dec)' },
    { date: '2025-02-14', time: '13:30', name: 'US Retail Sales (Jan)' },
    { date: '2025-03-14', time: '12:30', name: 'US Retail Sales (Feb)' },
    { date: '2025-04-16', time: '12:30', name: 'US Retail Sales (Mar)' },
    { date: '2025-05-15', time: '12:30', name: 'US Retail Sales (Apr)' },
    { date: '2025-06-17', time: '12:30', name: 'US Retail Sales (May)' },
    { date: '2025-07-16', time: '12:30', name: 'US Retail Sales (Jun)' },
    { date: '2025-08-15', time: '12:30', name: 'US Retail Sales (Jul)' },
    { date: '2025-09-16', time: '12:30', name: 'US Retail Sales (Aug)' },
    { date: '2025-10-16', time: '12:30', name: 'US Retail Sales (Sep)' },
    { date: '2025-11-14', time: '13:30', name: 'US Retail Sales (Oct)' },
    { date: '2025-12-12', time: '13:30', name: 'US Retail Sales (Nov)' },
    { date: '2026-01-16', time: '13:30', name: 'US Retail Sales (Dec)' },
    { date: '2026-02-13', time: '13:30', name: 'US Retail Sales (Jan)' },
    { date: '2026-03-13', time: '12:30', name: 'US Retail Sales (Feb)' },
    { date: '2026-04-16', time: '12:30', name: 'US Retail Sales (Mar)' },
    { date: '2026-05-15', time: '12:30', name: 'US Retail Sales (Apr)' },
    { date: '2026-06-16', time: '12:30', name: 'US Retail Sales (May)' },
    { date: '2026-07-16', time: '12:30', name: 'US Retail Sales (Jun)' },
    { date: '2026-08-14', time: '12:30', name: 'US Retail Sales (Jul)' },
  ];
  retailSales.forEach((r) => addEvent(r.date, r.time, 'RETAIL_SALES', r.name));

  events.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  return events;
}

const calendar = generateCuratedMacroCalendar();
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const outPath = path.join(dataDir, 'macro_calendar_2024_2026.json');
fs.writeFileSync(outPath, JSON.stringify(calendar, null, 2), 'utf8');

console.log(`✅ [MACRO CALENDAR] Curated ${calendar.length} high-impact US macro events (Aug 2024 - Aug 2026).`);
console.log(`📁 Saved to: ${outPath}`);

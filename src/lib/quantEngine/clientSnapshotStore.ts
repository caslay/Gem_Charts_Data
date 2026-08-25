/**
 * clientSnapshotStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tier 2 Client-Side Persistent IndexedDB Storage for T-Zero Structural Snapshots.
 * 
 * Provides 0ms asynchronous client retrieval that survives hard refreshes,
 * browser restarts, and Neon PostgreSQL quota suspensions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { StructuralBootstrapContext } from './types';

const DB_NAME = 'flow_state_quant_snapshots_db';
const DB_VERSION = 1;
const STORE_NAME = 'structural_snapshots';

export interface IndexedDBSnapshotRecord {
  id: string; // `${symbol}_${timeframe}_${YYYY-MM-DD}`
  symbol: string;
  timeframe: string;
  snapshotDate: string; // YYYY-MM-DD or ISO string
  stateJson: StructuralBootstrapContext;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_symbol_tf', ['symbol', 'timeframe'], { unique: false });
        store.createIndex('by_date', 'snapshotDate', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a snapshot from IndexedDB by (symbol, timeframe, dateStr)
 */
export async function getClientSnapshot(
  symbol: string,
  timeframe: string,
  dateStr: string
): Promise<StructuralBootstrapContext | null> {
  if (typeof window === 'undefined') return null;

  try {
    const db = await openDatabase();
    const cleanDate = dateStr.slice(0, 10);
    const key = `${symbol.toUpperCase()}_${timeframe.toLowerCase()}_${cleanDate}`;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const record = req.result as IndexedDBSnapshotRecord | undefined;
        resolve(record ? record.stateJson : null);
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[clientSnapshotStore] Failed to retrieve snapshot from IndexedDB:', err);
    return null;
  }
}

/**
 * Saves a structural snapshot into IndexedDB
 */
export async function saveClientSnapshot(
  symbol: string,
  timeframe: string,
  dateStr: string,
  stateJson: StructuralBootstrapContext
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const db = await openDatabase();
    const cleanDate = dateStr.slice(0, 10);
    const key = `${symbol.toUpperCase()}_${timeframe.toLowerCase()}_${cleanDate}`;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record: IndexedDBSnapshotRecord = {
        id: key,
        symbol: symbol.toUpperCase(),
        timeframe: timeframe.toLowerCase(),
        snapshotDate: cleanDate,
        stateJson,
        updatedAt: Date.now(),
      };

      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[clientSnapshotStore] Failed to save snapshot to IndexedDB:', err);
    return false;
  }
}

/**
 * Clears all cached snapshots from IndexedDB
 */
export async function clearClientSnapshots(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
